import { supabase } from '@/lib/supabase'

const cache = new Map<string, { url: string; expires: number }>()
const pending = new Map<string, Promise<string | null>>()
let cacheOwner = ''
let ownerGeneration = 0
let active = 0
const waiting: Array<() => void> = []

export function clearAttendancePhotos() {
  ownerGeneration++
  cacheOwner = ''
  cache.clear()
  pending.clear()
}
export function setAttendancePhotoOwner(owner: string) {
  if (cacheOwner !== owner) { clearAttendancePhotos(); cacheOwner = owner }
}

/** Signed attendance photos remain private; do not reuse a previous account's URLs. */
export function attendancePhotoUrl(owner: string, path: string, force = false): Promise<string | null> {
  if (!owner || !path) return Promise.resolve(null)
  setAttendancePhotoOwner(owner)
  const generation = ownerGeneration
  const key = `${owner}:${path}`
  const saved = cache.get(key)
  if (!force && saved && saved.expires > Date.now()) return Promise.resolve(saved.url)
  const existing = pending.get(key)
  if (existing) return existing
  const request = (async () => {
    if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve))
    else active++
    try {
      if (cacheOwner !== owner || generation !== ownerGeneration) return null
      const result = await supabase.storage.from('attendance-selfies').createSignedUrl(path, 900)
      if (cacheOwner !== owner || generation !== ownerGeneration || result.error || !result.data?.signedUrl) return null
      cache.set(key, { url: result.data.signedUrl, expires: Date.now() + 14 * 60_000 })
      for (const [savedKey, value] of cache) if (value.expires <= Date.now()) cache.delete(savedKey)
      while (cache.size > 200) cache.delete(cache.keys().next().value!)
      return result.data.signedUrl
    } finally { const next = waiting.shift(); if (next) next(); else active-- }
  })().catch(() => null).finally(() => { if (pending.get(key) === request) pending.delete(key) })
  pending.set(key, request)
  return request
}
