import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StudentTaskFile } from '@/types/studentTasks'
import { MAX_TASK_FILE_BYTES, studentTaskFileType, validateStudentTaskFiles } from '@/utils/studentTaskAttachments'

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(), getPlatform: vi.fn(), isPluginAvailable: vi.fn(), save: vi.fn(),
  download: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: mocks, registerPlugin: () => ({ save: mocks.save }) }))
vi.mock('@/services/studentTasks', () => ({ downloadStudentTaskFile: mocks.download }))
import { saveStudentTaskAttachment } from '@/services/studentTaskAttachments'

function storedFile(overrides: Partial<StudentTaskFile> = {}): StudentTaskFile {
  return { id: 'file', task_id: 'task', file_name: 'rubric.pdf', storage_path: 'student/task/rubric.pdf',
    mime_type: 'application/pdf', size_bytes: 3, position: 0, created_at: '', ...overrides }
}
function selectedFile(name = 'notes.pdf', bytes = 1, type = 'application/pdf') { return new File([new Uint8Array(bytes)], name, { type }) }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.isNativePlatform.mockReturnValue(true); mocks.getPlatform.mockReturnValue('android'); mocks.isPluginAvailable.mockReturnValue(true)
  mocks.download.mockResolvedValue(new Blob(['pdf'], { type: 'application/pdf' })); mocks.save.mockResolvedValue({ saved: true })
})
afterEach(() => { vi.restoreAllMocks() })

describe('task file and camera photo validation', () => {
  it('accepts exactly 5 MB, infers missing document MIME types, and rejects empty/unsupported files', () => {
    expect(() => validateStudentTaskFiles([selectedFile('camera.jpg', MAX_TASK_FILE_BYTES, 'image/jpeg')])).not.toThrow()
    expect(studentTaskFileType(selectedFile('project.DOCX', 1, ''))).toContain('wordprocessingml')
    expect(() => validateStudentTaskFiles([selectedFile('project.DOCX', 1, '')])).not.toThrow()
    expect(() => validateStudentTaskFiles([selectedFile('empty.pdf', 0)])).toThrow(/non-empty/)
    expect(() => validateStudentTaskFiles([selectedFile('camera.jpg', MAX_TASK_FILE_BYTES + 1, 'image/jpeg')])).toThrow(/5 MB/)
    expect(() => validateStudentTaskFiles([selectedFile('run.exe', 1, 'application/x-msdownload')])).toThrow(/supported/)
  })

  it('counts kept files and camera photos together, excluding attachments marked for removal', () => {
    const existing = [storedFile({ size_bytes: MAX_TASK_FILE_BYTES })]
    const photo = selectedFile('camera.jpg', MAX_TASK_FILE_BYTES, 'image/jpeg')
    expect(() => validateStudentTaskFiles([photo], existing)).not.toThrow()
    expect(() => validateStudentTaskFiles([photo, selectedFile()], existing)).toThrow(/10 MB/)
    expect(() => validateStudentTaskFiles([photo, selectedFile()], existing, ['file'])).not.toThrow()
  })
})

describe('private task attachment downloads', () => {
  it('opens Android save picker with authenticated file contents and a safe name', async () => {
    expect(await saveStudentTaskAttachment(storedFile({ file_name: '../rubric.pdf' }))).toBe('saved')
    expect(mocks.download).toHaveBeenCalledWith('student/task/rubric.pdf')
    expect(mocks.save).toHaveBeenCalledWith({ name: '.._rubric.pdf', mimeType: 'application/pdf', data: 'cGRm' })
  })

  it('treats canceled Android saves as cancellation and allows retry after failure', async () => {
    mocks.save.mockResolvedValueOnce({ saved: false })
    expect(await saveStudentTaskAttachment(storedFile())).toBe('canceled')
    mocks.download.mockRejectedValueOnce(new Error('Offline'))
    await expect(saveStudentTaskAttachment(storedFile())).rejects.toThrow('Offline')
    expect(await saveStudentTaskAttachment(storedFile())).toBe('saved')
  })

  it('prevents simultaneous file pickers and gives older Android builds an actionable error', async () => {
    let finish!: (blob: Blob) => void
    mocks.download.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const first = saveStudentTaskAttachment(storedFile())
    await expect(saveStudentTaskAttachment(storedFile())).rejects.toThrow(/current attachment/)
    finish(new Blob(['pdf']))
    await first
    mocks.isPluginAvailable.mockReturnValue(false)
    await expect(saveStudentTaskAttachment(storedFile())).rejects.toThrow(/latest Android app/)
  })

})
