interface CleanupClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
  storage: { from(bucket: string): { remove(paths: string[]): PromiseLike<{ error: unknown }> } }
}

interface ClaimedPhoto { id: string; object_path: string; lease_token: string }

export interface PhotoCleanupResult {
  claimed: number
  deleted: number
  failed: number
  error: boolean
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PHOTO_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[a-z0-9][a-z0-9._-]{0,254}$/i

/** Called only after dispatcher authentication, with its service-role client. */
export async function cleanupAttendancePhotos(client: CleanupClient): Promise<PhotoCleanupResult> {
  const result: PhotoCleanupResult = { claimed: 0, deleted: 0, failed: 0, error: false }
  let batch: ClaimedPhoto[] = []
  try {
    const claim = await client.rpc('claim_attendance_photo_deletions', { p_limit: 100 })
    if (claim.error || !Array.isArray(claim.data) || claim.data.length > 100) throw new Error('Cleanup claim unavailable')
    result.claimed = claim.data.length
    if (!result.claimed) return result

    // Validate the lease envelope before allowing a service-role Storage call.
    const rows = claim.data as ClaimedPhoto[]
    const token = rows[0]?.lease_token
    if (typeof token !== 'string' || !UUID.test(token) || rows.some(row => !row || typeof row.id !== 'string' || !UUID.test(row.id) || row.lease_token !== token) || new Set(rows.map(row => row.id)).size !== rows.length) {
      throw new Error('Invalid cleanup lease')
    }
    batch = rows
    if (rows.some(row => typeof row.object_path !== 'string' || row.object_path.length > 1024 || row.object_path.includes('..') || !PHOTO_PATH.test(row.object_path))) throw new Error('Invalid cleanup path')

    const removed = await client.storage.from('attendance-selfies').remove([...new Set(rows.map(row => row.object_path))])
    if (removed.error) throw new Error('Cleanup Storage operation unavailable')

    // An already-absent object is safe to retry. Only acknowledge after Storage
    // succeeds; never delete managed storage.objects metadata directly.
    const completion = await client.rpc('complete_attendance_photo_deletions', {
      p_ids: rows.map(row => row.id), p_lease_token: token, p_deleted: true,
    })
    if (completion.error || !Number.isInteger(completion.data) || (completion.data as number) < 0 || (completion.data as number) > rows.length) throw new Error('Cleanup completion unavailable')
    result.deleted = completion.data as number
    if (result.deleted !== result.claimed) throw new Error('Cleanup lease changed before completion')
  } catch {
    result.error = true
    result.failed = result.claimed - result.deleted
    if (batch.length) {
      try {
        // The database enforces token ownership and a bounded retry backoff.
        // If release fails, the five-minute lease expires for a later worker.
        await client.rpc('complete_attendance_photo_deletions', {
          p_ids: batch.map(row => row.id), p_lease_token: batch[0].lease_token, p_deleted: false,
        })
      } catch { /* A later dispatcher invocation can reclaim the expired lease. */ }
    }
  }
  // Do not return or log private object paths, credentials or provider errors.
  return result
}
