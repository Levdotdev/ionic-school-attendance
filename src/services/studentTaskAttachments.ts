import { Capacitor, registerPlugin } from '@capacitor/core'
import { Browser } from '@capacitor/browser'
import type { StudentTaskFile } from '@/types/studentTasks'
import { createTaskFileDownloadUrl, downloadStudentTaskFile } from './studentTasks'

interface TaskAttachmentsPlugin {
  save(options: { name: string; mimeType: string; data: string }): Promise<{ saved: boolean }>
}
const TaskAttachments = registerPlugin<TaskAttachmentsPlugin>('TaskAttachments')
let saveInProgress = false

function blobData(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      if (comma < 0) reject(new Error('This attachment could not be read. Please try again.'))
      else resolve(result.slice(comma + 1))
    }
    reader.onerror = () => reject(new Error('This attachment could not be read. Please try again.'))
    reader.readAsDataURL(blob)
  })
}

export async function saveStudentTaskAttachment(file: StudentTaskFile): Promise<'saved' | 'started' | 'canceled'> {
  if (saveInProgress) throw new Error('Finish saving the current attachment first.')
  const android = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  if (android && !Capacitor.isPluginAvailable('TaskAttachments')) throw new Error('Install the latest Android app to download attachments.')
  saveInProgress = true
  try {
    if (Capacitor.isNativePlatform() && !android) {
      await Browser.open({ url: await createTaskFileDownloadUrl(file.storage_path) })
      return 'started'
    }
    const blob = await downloadStudentTaskFile(file.storage_path)
    const name = file.file_name.replace(/[\\/\p{Cc}]/gu, '_').trim() || 'Attachment'
    if (android) {
      const result = await TaskAttachments.save({ name, mimeType: file.mime_type || blob.type || 'application/octet-stream', data: await blobData(blob) })
      return result.saved ? 'saved' : 'canceled'
    }
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = name; document.body.appendChild(anchor)
    try { anchor.click() } finally {
      anchor.remove()
      // Let the browser consume the object URL before releasing it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    }
    return 'started'
  } finally { saveInProgress = false }
}
