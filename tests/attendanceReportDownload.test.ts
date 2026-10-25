import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadAttendanceBlob } from '@/services/classAttendanceReport'

const mocks = vi.hoisted(() => ({ native: vi.fn(), write: vi.fn(), remove: vi.fn(), rmdir: vi.fn(), share: vi.fn(), createUrl: vi.fn(), revokeUrl: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native } }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: { writeFile: mocks.write, deleteFile: mocks.remove, rmdir: mocks.rmdir }, Directory: { Cache: 'CACHE' } }))
vi.mock('@capacitor/share', () => ({ Share: { share: mocks.share } }))
const filename = 'minsu-attendance-INTEGRATION-2026-10-25.pdf'
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers()
  mocks.native.mockReturnValue(false); mocks.write.mockResolvedValue({ uri: 'file:///app-private-cache/report.pdf' })
  mocks.remove.mockResolvedValue(undefined); mocks.rmdir.mockResolvedValue(undefined); mocks.share.mockResolvedValue({ activityType: '' })
  mocks.createUrl.mockReturnValue('blob:local-report')
  vi.stubGlobal('URL', { createObjectURL: mocks.createUrl, revokeObjectURL: mocks.revokeUrl })
  vi.stubGlobal('FileReader', class {
    result = 'data:application/pdf;base64,AQID'
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    readAsDataURL() { this.onload?.() }
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('attendance report downloads', () => {
  it('downloads locally in browsers and releases the temporary object URL', async () => {
    expect(await downloadAttendanceBlob(new Blob(['report']), filename)).toBe('download')
    expect(mocks.createUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce()
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.share).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.revokeUrl).toHaveBeenCalledWith('blob:local-report')
  })
  it('uses only app cache and a user-chosen native save/share sheet', async () => {
    mocks.native.mockReturnValue(true)
    expect(await downloadAttendanceBlob(new Blob(['report']), filename)).toBe('share')
    const options = mocks.write.mock.calls[0][0]
    expect(options).toMatchObject({ directory: 'CACHE', recursive: true, data: 'AQID' })
    expect(options.path).toMatch(/^attendance-reports\/[0-9a-f-]+\/minsu-attendance-INTEGRATION-2026-10-25\.pdf$/)
    expect(mocks.share).toHaveBeenCalledExactlyOnceWith({ title: 'MinSU class attendance report', dialogTitle: 'Save or share attendance report', files: ['file:///app-private-cache/report.pdf'] })
    expect(mocks.createUrl).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(mocks.remove).toHaveBeenCalledWith({ path: options.path, directory: 'CACHE' })
    expect(mocks.rmdir).toHaveBeenCalledWith({ path: options.path.slice(0, options.path.lastIndexOf('/')), directory: 'CACHE' })
  })
  it('removes its own temporary cache copy when sharing fails', async () => {
    mocks.native.mockReturnValue(true); mocks.share.mockRejectedValue(new Error('Sharing cancelled'))
    await expect(downloadAttendanceBlob(new Blob(['report']), filename)).rejects.toThrow('Sharing cancelled')
    expect(mocks.remove).toHaveBeenCalledOnce(); expect(mocks.rmdir).toHaveBeenCalledOnce()
  })
  it('blocks path manipulation and stops before exposing a file when the account changes', async () => {
    await expect(downloadAttendanceBlob(new Blob(['report']), '../../private.pdf')).rejects.toThrow('filename')
    mocks.native.mockReturnValue(true)
    let finish!: (value: { uri: string }) => void
    mocks.write.mockReturnValue(new Promise(resolve => { finish = resolve }))
    let current = true
    const exporting = downloadAttendanceBlob(new Blob(['report']), filename, () => current)
    await flushPromises(); current = false; finish({ uri: 'file:///private/report.pdf' })
    await expect(exporting).rejects.toThrow('account changed')
    expect(mocks.share).not.toHaveBeenCalled(); expect(mocks.remove).toHaveBeenCalledOnce()
  })
})
