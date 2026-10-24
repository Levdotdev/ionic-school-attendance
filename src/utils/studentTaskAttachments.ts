import type { StudentTaskFile } from '@/types/studentTasks'

export const MAX_TASK_FILE_BYTES = 5 * 1024 * 1024
export const MAX_TASK_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  pdf: 'application/pdf', txt: 'text/plain', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
const ACCEPTED_TYPES = new Set(Object.values(MIME_BY_EXTENSION))

export function studentTaskFileType(file: File): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  return MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? file.type
}

export function validateStudentTaskFiles(
  files: File[], existing: StudentTaskFile[] = [], removedIds: string[] = [],
): void {
  for (const file of files) {
    if (!file.size || file.size > MAX_TASK_FILE_BYTES) throw new Error(`${file.name} must be non-empty and no larger than 5 MB.`)
    if (!ACCEPTED_TYPES.has(studentTaskFileType(file))) throw new Error(`${file.name} is not a supported file type.`)
  }
  const keptBytes = existing.filter(file => !removedIds.includes(file.id)).reduce((sum, file) => sum + file.size_bytes, 0)
  if (keptBytes + files.reduce((sum, file) => sum + file.size, 0) > MAX_TASK_ATTACHMENT_BYTES) {
    throw new Error('Keep task files and photos under 10 MB in total.')
  }
}
