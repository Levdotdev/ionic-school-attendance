// @vitest-environment node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { cleanupAttendancePhotos } from '../supabase/functions/dispatch-class-reminders/attendancePhotoCleanup'

const uuid = (value: number) => `00000000-0000-0000-0000-${String(value).padStart(12, '0')}`
const token = uuid(999)
const photo = (value: number) => ({ id: uuid(value), object_path: `${uuid(10)}/${uuid(20)}/selfie-${value}.jpg`, lease_token: token })

function clientFor(rows: unknown = [photo(1), photo(2)]) {
  const remove = vi.fn().mockResolvedValue({ data: [], error: null })
  const rpc = vi.fn().mockImplementation(async (name: string, args: Record<string, unknown>) => name === 'claim_attendance_photo_deletions'
    ? { data: rows, error: null }
    : { data: (args.p_ids as string[]).length, error: null })
  const from = vi.fn().mockReturnValue({ remove })
  return { client: { rpc, storage: { from } }, rpc, from, remove }
}

describe('attendance photo deletion worker', () => {
  it('claims a bounded batch and does nothing to Storage when it is empty', async () => {
    const fixture = clientFor([])
    expect(await cleanupAttendancePhotos(fixture.client)).toEqual({ claimed: 0, deleted: 0, failed: 0, error: false })
    expect(fixture.rpc).toHaveBeenCalledExactlyOnceWith('claim_attendance_photo_deletions', { p_limit: 100 })
    expect(fixture.from).not.toHaveBeenCalled()
  })

  it('removes only the private attendance bucket and acknowledges only after Storage succeeds', async () => {
    const fixture = clientFor()
    let finishRemoval!: () => void
    fixture.remove.mockImplementation(() => new Promise(resolveRemoval => { finishRemoval = () => resolveRemoval({ data: [], error: null }) }))
    const work = cleanupAttendancePhotos(fixture.client)
    await vi.waitFor(() => expect(fixture.remove).toHaveBeenCalled())
    expect(fixture.rpc).toHaveBeenCalledTimes(1)
    expect(fixture.from).toHaveBeenCalledExactlyOnceWith('attendance-selfies')
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith([photo(1).object_path, photo(2).object_path])
    finishRemoval()
    expect(await work).toEqual({ claimed: 2, deleted: 2, failed: 0, error: false })
    expect(fixture.rpc).toHaveBeenLastCalledWith('complete_attendance_photo_deletions', { p_ids: [uuid(1), uuid(2)], p_lease_token: token, p_deleted: true })
  })

  it.each(['returned error', 'thrown error'])('releases a failed Storage batch for retry without exposing its %s', async kind => {
    const fixture = clientFor()
    const privateError = `PRIVATE PROVIDER CREDENTIAL ${photo(1).object_path}`
    if (kind === 'returned error') fixture.remove.mockResolvedValue({ error: { message: privateError } })
    else fixture.remove.mockRejectedValue(new Error(privateError))
    const result = await cleanupAttendancePhotos(fixture.client)
    expect(result).toEqual({ claimed: 2, deleted: 0, failed: 2, error: true })
    expect(JSON.stringify(result)).not.toContain(privateError)
    expect(fixture.rpc).toHaveBeenLastCalledWith('complete_attendance_photo_deletions', { p_ids: [uuid(1), uuid(2)], p_lease_token: token, p_deleted: false })
    expect(fixture.rpc.mock.calls.some(([, args]) => args.p_deleted === true)).toBe(false)
  })

  it('keeps failures contained when both successful-removal acknowledgement and lease release fail', async () => {
    const fixture = clientFor()
    fixture.rpc.mockImplementation(async (name: string) => {
      if (name === 'claim_attendance_photo_deletions') return { data: [photo(1)], error: null }
      throw new Error('temporary database failure')
    })
    expect(await cleanupAttendancePhotos(fixture.client)).toEqual({ claimed: 1, deleted: 0, failed: 1, error: true })
    expect(fixture.rpc.mock.calls.filter(([name]) => name === 'complete_attendance_photo_deletions').map(([, args]) => args.p_deleted)).toEqual([true, false])
  })

  it('does not count stale lease acknowledgements as completed deletion requests', async () => {
    const fixture = clientFor([photo(1)])
    fixture.rpc.mockImplementation(async (name: string) => name === 'claim_attendance_photo_deletions' ? { data: [photo(1)], error: null } : { data: 0, error: null })
    expect(await cleanupAttendancePhotos(fixture.client)).toEqual({ claimed: 1, deleted: 0, failed: 1, error: true })
    expect(fixture.rpc).toHaveBeenLastCalledWith('complete_attendance_photo_deletions', expect.objectContaining({ p_lease_token: token, p_deleted: false }))
  })

  it.each([
    `${uuid(10)}/${uuid(20)}/../secret.jpg`, `${uuid(10)}/${uuid(20)}/%2e%2e.jpg`,
    `${uuid(10)}\\${uuid(20)}\\photo.jpg`, `https://example.test/${photo(1).object_path}`,
    `${uuid(10)}/${uuid(20)}/nested/photo.jpg`,
  ])('rejects an unsafe claimed object path before privileged Storage access: %s', async object_path => {
    const fixture = clientFor([{ ...photo(1), object_path }])
    expect(await cleanupAttendancePhotos(fixture.client)).toEqual({ claimed: 1, deleted: 0, failed: 1, error: true })
    expect(fixture.from).not.toHaveBeenCalled()
    expect(fixture.rpc).toHaveBeenLastCalledWith('complete_attendance_photo_deletions', expect.objectContaining({ p_deleted: false }))
  })

  it('rejects mixed lease tokens and oversized claims without a Storage call', async () => {
    const mixed = clientFor([photo(1), { ...photo(2), lease_token: uuid(998) }])
    expect((await cleanupAttendancePhotos(mixed.client)).error).toBe(true)
    expect(mixed.from).not.toHaveBeenCalled()
    expect(mixed.rpc).toHaveBeenCalledTimes(1)
    const oversized = clientFor(Array.from({ length: 101 }, (_, index) => photo(index + 1)))
    expect((await cleanupAttendancePhotos(oversized.client)).error).toBe(true)
    expect(oversized.from).not.toHaveBeenCalled()
  })

  it('contains claim errors without attempting deletion', async () => {
    const fixture = clientFor()
    fixture.rpc.mockRejectedValue(new Error('private database detail'))
    expect(await cleanupAttendancePhotos(fixture.client)).toEqual({ claimed: 0, deleted: 0, failed: 0, error: true })
    expect(fixture.from).not.toHaveBeenCalled()
  })
})

/** Execute the real Edge entry point with a local Deno/service boundary. */
function dispatcher(client: ReturnType<typeof clientFor>['client'], firebase = false) {
  let handler!: (request: Request) => Promise<Response>
  const values: Record<string, string> = {
    REMINDER_DISPATCH_SECRET: 'local-test-dispatch-secret', SUPABASE_URL: 'https://database.example.test', SUPABASE_SERVICE_ROLE_KEY: 'local-test-service-key',
  }
  if (firebase) values.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'test-project', client_email: 'local@example.test', private_key: '-----BEGIN PRIVATE KEY-----AA==-----END PRIVATE KEY-----' })
  const env = vi.fn((name: string) => values[name])
  const createClient = vi.fn(() => client)
  const warn = vi.fn(), error = vi.fn()
  const fetch = vi.fn(async (url: string) => Response.json(url.includes('oauth2') ? { access_token: 'local-test-access-token', expires_in: 3600 } : { name: 'projects/test/messages/one' }))
  const source = readFileSync(resolve(process.cwd(), 'supabase/functions/dispatch-class-reminders/index.ts'), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  runInNewContext(output, {
    exports: {}, require: (name: string) => {
      if (name === 'npm:@supabase/supabase-js@2.117.2') return { createClient }
      if (name === './attendancePhotoCleanup.ts') return { cleanupAttendancePhotos }
      throw new Error('Unexpected Edge dependency')
    },
    Deno: { env: { get: env }, serve: (callback: typeof handler) => { handler = callback } },
    Response, TextEncoder, URLSearchParams, btoa, atob, fetch, console: { warn, error },
    crypto: { randomUUID: () => uuid(500), subtle: { importKey: async () => ({}), sign: async () => new Uint8Array([1, 2]).buffer } },
  })
  return { handler, env, createClient, warn, error, fetch }
}
const request = (secret = 'local-test-dispatch-secret') => new Request('https://worker.example.test', { method: 'POST', headers: { 'x-reminder-secret': secret } })

describe('photo cleanup in the protected reminder dispatcher', () => {
  it('runs cleanup before claiming reminders even without Firebase or due deliveries', async () => {
    const fixture = clientFor([photo(1)])
    fixture.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_attendance_photo_deletions' ? [photo(1)] : name === 'complete_attendance_photo_deletions' ? 1 : [], error: null }))
    const worker = dispatcher(fixture.client)
    const response = await worker.handler(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ claimed: 0, sent: 0, failed: 0, photo_cleanup: { claimed: 1, deleted: 1, failed: 0, error: false } })
    expect(fixture.rpc.mock.calls.map(([name]) => name)).toEqual(['claim_attendance_photo_deletions', 'complete_attendance_photo_deletions', 'claim_due_class_notification_deliveries'])
    expect(worker.env).not.toHaveBeenCalledWith('FIREBASE_SERVICE_ACCOUNT_JSON')
  })

  it('still sends due reminders after photo cleanup fails, logging only aggregate cleanup counts', async () => {
    const fixture = clientFor()
    fixture.rpc.mockImplementation(async (name: string) => ({ data: name === 'claim_due_class_notification_deliveries' ? [{
      delivery_id: uuid(1), push_token_id: uuid(2), token: 'local-device-token', platform: 'android', provider: 'fcm',
      meeting_id: uuid(3), class_id: uuid(4), user_id: uuid(5), audience: 'teacher', reminder_offset_minutes: 0,
      starts_at: '2026-10-25T02:00:00Z', class_name: 'SYSTEM INTEGRATION', class_section: null, class_timezone: 'Asia/Manila',
    }] : [], error: name === 'claim_attendance_photo_deletions' ? { message: `PRIVATE ${photo(1).object_path}` } : null }))
    const worker = dispatcher(fixture.client, true)
    const response = await worker.handler(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ claimed: 1, sent: 1, failed: 0, photo_cleanup: { claimed: 0, deleted: 0, failed: 0, error: true } })
    expect(worker.fetch).toHaveBeenCalledTimes(2)
    expect(fixture.rpc).toHaveBeenLastCalledWith('mark_class_notification_delivery', expect.objectContaining({ p_succeeded: true }))
    expect(worker.warn).toHaveBeenCalledExactlyOnceWith('Attendance photo cleanup will retry', { claimed: 0, failed: 0 })
    expect(JSON.stringify(worker.warn.mock.calls)).not.toContain(photo(1).object_path)
  })

  it('rejects unauthorized requests before creating a service client or claiming private cleanup data', async () => {
    const fixture = clientFor()
    const worker = dispatcher(fixture.client)
    expect((await worker.handler(request('wrong-secret'))).status).toBe(401)
    expect(worker.createClient).not.toHaveBeenCalled()
    expect(fixture.rpc).not.toHaveBeenCalled()
    expect(fixture.from).not.toHaveBeenCalled()
  })
})
