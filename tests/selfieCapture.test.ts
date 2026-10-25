import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ platform: 'android', native: true, front: vi.fn(), takePhoto: vi.fn() }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native, getPlatform: () => mocks.platform } }))
vi.mock('@capacitor/camera', () => ({ Camera: { takePhoto: mocks.takePhoto }, CameraDirection: { Front: 'front' }, EncodingType: { JPEG: 'jpeg' } }))
vi.mock('@/services/frontCamera', () => ({ captureFrontCameraPhoto: mocks.front }))
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
import { captureSelfie } from '@/services/selfie'
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('selfie camera platform selection', () => {
  it('uses the actual front-lens capture on Android and preserves its capture timestamp', async () => {
    mocks.native = true; mocks.platform = 'android'
    const blob = new Blob(['photo'], { type: 'image/jpeg' })
    mocks.front.mockResolvedValue({ blob, capturedAt: '2026-10-26T00:00:00.000Z' })
    URL.createObjectURL = vi.fn().mockReturnValue('blob:front-photo')
    const photo = await captureSelfie()
    expect(photo).toMatchObject({ blob, previewUrl: 'blob:front-photo', capturedAt: '2026-10-26T00:00:00.000Z', watermarkApplied: false })
    expect(mocks.takePhoto).not.toHaveBeenCalled()
  })
  it('requests the front direction from Capacitor on other supported platforms', async () => {
    mocks.native = false; mocks.platform = 'web'
    mocks.takePhoto.mockResolvedValue({ webPath: 'https://camera.test/photo.jpg', metadata: { format: 'jpeg' } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(['photo'], { type: 'image/jpeg' }) }))
    const photo = await captureSelfie()
    expect(mocks.takePhoto.mock.calls[0][0]).toMatchObject({ cameraDirection: 'front', saveToGallery: false })
    expect(photo.contentType).toBe('image/jpeg')
    expect(mocks.front).not.toHaveBeenCalled()
  })
})
