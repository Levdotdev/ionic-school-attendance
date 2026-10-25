import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ addListener: vi.fn(), remove: vi.fn() }))
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.addListener } }))
import { captureFrontCameraPhoto } from '@/services/frontCamera'

let stop: ReturnType<typeof vi.fn>
let media: ReturnType<typeof vi.fn>
let stream: MediaStream
beforeEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
  stop = vi.fn()
  stream = { getTracks: () => [{ stop }], getVideoTracks: () => [{ getSettings: () => ({ facingMode: 'user' }) }] } as unknown as MediaStream
  media = vi.fn().mockResolvedValue(stream)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: media } })
  mocks.addListener.mockResolvedValue({ remove: mocks.remove })
  mocks.remove.mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1920)
  vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1080)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['photo'], { type: 'image/jpeg' })))
})
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = '' })
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)!

describe('Android in-app front camera', () => {
  it('requests the front lens, captures a bounded JPEG, and releases the camera and overlay', async () => {
    const pending = captureFrontCameraPhoto(); await flushPromises()
    expect(media).toHaveBeenCalledWith({ audio: false, video: { facingMode: { exact: 'user' }, width: { ideal: 1280 }, height: { ideal: 1280 } } })
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    expect(button('Take photo').disabled).toBe(false)
    button('Take photo').click()
    const photo = await pending
    expect(photo.blob.type).toBe('image/jpeg')
    expect(Number.isNaN(Date.parse(photo.capturedAt))).toBe(false)
    expect(stop).toHaveBeenCalledOnce()
    expect(mocks.remove).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('cancels while permission is pending and stops a stream that arrives later', async () => {
    let resolve!: (value: MediaStream) => void
    media.mockImplementation(() => new Promise<MediaStream>(finish => { resolve = finish }))
    const pending = captureFrontCameraPhoto(); await flushPromises()
    const rejected = expect(pending).rejects.toThrow('cancelled')
    button('Cancel').click()
    await rejected
    resolve(stream); await flushPromises()
    expect(stop).toHaveBeenCalledOnce()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('handles the Android back button without leaving a live camera behind', async () => {
    const pending = captureFrontCameraPhoto(); await flushPromises()
    const rejected = expect(pending).rejects.toThrow('cancelled')
    expect(mocks.addListener.mock.calls[0][0]).toBe('backButton')
    const register = vi.fn()
    document.dispatchEvent(new CustomEvent('ionBackButton', { detail: { register } }))
    expect(register.mock.calls[0][0]).toBeGreaterThan(100)
    register.mock.calls[0][1]()
    await rejected
    expect(stop).toHaveBeenCalledOnce()
  })
  it('does not silently substitute a rear camera when a device ignores the front constraint', async () => {
    media.mockResolvedValue({ getTracks: () => [{ stop }], getVideoTracks: () => [{ getSettings: () => ({ facingMode: 'environment' }) }] })
    await expect(captureFrontCameraPhoto()).rejects.toThrow('front camera is unavailable')
    expect(stop).toHaveBeenCalledOnce()
    expect(document.querySelector('video')).toBeNull()
  })
  it('cleans up after denied permissions and allows another attempt', async () => {
    media.mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
    await expect(captureFrontCameraPhoto()).rejects.toThrow('Allow camera access')
    const pending = captureFrontCameraPhoto(); await flushPromises()
    const rejected = expect(pending).rejects.toThrow('cancelled')
    button('Cancel').click(); await rejected
    expect(media).toHaveBeenCalledTimes(2)
  })
})
