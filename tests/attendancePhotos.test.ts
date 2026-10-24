import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import AttendancePhoto from '@/components/AttendancePhoto.vue'
import { attendancePhotoUrl, clearAttendancePhotos, setAttendancePhotoOwner } from '@/services/attendancePhotos'

const mocks = vi.hoisted(() => ({ signed: vi.fn(), owner: undefined as unknown as ReturnType<typeof ref<{ id: string } | null>> }))
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ createSignedUrl: mocks.signed }) } } }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ user: mocks.owner }) }))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const photoResult = (url = 'https://storage.test/signed') => ({ data: { signedUrl: url }, error: null })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T00:00:00Z'))
  mocks.owner = ref({ id: 'parent-1' })
  mocks.signed.mockReset().mockResolvedValue(photoResult())
  clearAttendancePhotos()
})
afterEach(() => { clearAttendancePhotos(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('protected attendance thumbnails', () => {
  it('does not request a photo until it approaches the viewport', async () => {
    let reveal!: IntersectionObserverCallback
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class { constructor(callback: IntersectionObserverCallback) { reveal = callback } observe() {} disconnect = disconnect })
    const wrapper = mount(AttendancePhoto, { props: { path: 'student/meeting/selfie.jpg', alt: 'Student check-in' } })
    await flushPromises()
    expect(mocks.signed).not.toHaveBeenCalled()
    reveal([{ isIntersecting: true }] as IntersectionObserverEntry[], {} as IntersectionObserver)
    await flushPromises()
    expect(mocks.signed).toHaveBeenCalledWith('student/meeting/selfie.jpg', 900)
    expect(wrapper.get('img').attributes('alt')).toBe('Student check-in')
    expect(disconnect).toHaveBeenCalled()
    wrapper.unmount()
  })

  it('deduplicates a visible photo and reuses it for fourteen minutes', async () => {
    const first = deferred<ReturnType<typeof photoResult>>()
    mocks.signed.mockReturnValueOnce(first.promise)
    const one = attendancePhotoUrl('parent-1', 'student/photo.jpg')
    const two = attendancePhotoUrl('parent-1', 'student/photo.jpg')
    expect(mocks.signed).toHaveBeenCalledTimes(1)
    first.resolve(photoResult())
    expect(await one).toBe(await two)
    expect(await attendancePhotoUrl('parent-1', 'student/photo.jpg')).toBe('https://storage.test/signed')
    expect(mocks.signed).toHaveBeenCalledTimes(1)
    vi.setSystemTime(new Date('2026-10-24T00:14:01Z'))
    await attendancePhotoUrl('parent-1', 'student/photo.jpg')
    expect(mocks.signed).toHaveBeenCalledTimes(2)
  })

  it('does not display a previous account’s photo when its request completes late', async () => {
    const first = deferred<ReturnType<typeof photoResult>>()
    mocks.signed.mockReturnValueOnce(first.promise)
    const wrapper = mount(AttendancePhoto, { props: { path: 'student/photo.jpg' } })
    await flushPromises()
    mocks.owner.value = { id: 'parent-2' }
    await flushPromises()
    first.resolve(photoResult('https://storage.test/old-owner'))
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('https://storage.test/signed')
    wrapper.unmount()
  })

  it('does not flush another thumbnail’s new-account request during account changes', async () => {
    setAttendancePhotoOwner('parent-1')
    setAttendancePhotoOwner('parent-2')
    const one = attendancePhotoUrl('parent-2', 'student/photo.jpg')
    setAttendancePhotoOwner('parent-2')
    const two = attendancePhotoUrl('parent-2', 'student/photo.jpg')
    expect(await one).toBe(await two)
    expect(mocks.signed).toHaveBeenCalledTimes(1)
  })

  it('limits signing requests to four at a time', async () => {
    const calls = Array.from({ length: 6 }, () => deferred<ReturnType<typeof photoResult>>())
    let current = 0
    mocks.signed.mockImplementation(() => calls[current++].promise)
    const photos = Array.from({ length: 6 }, (_, index) => attendancePhotoUrl('parent-1', `student/${index}.jpg`))
    expect(mocks.signed).toHaveBeenCalledTimes(4)
    calls[0].resolve(photoResult())
    await flushPromises()
    expect(mocks.signed).toHaveBeenCalledTimes(5)
    calls[1].resolve(photoResult())
    await flushPromises()
    expect(mocks.signed).toHaveBeenCalledTimes(6)
    for (const call of calls) call.resolve(photoResult())
    expect(await Promise.all(photos)).toHaveLength(6)
  })
})
