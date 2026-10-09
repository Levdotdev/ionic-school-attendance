import { Camera, CameraDirection, EncodingType } from '@capacitor/camera'

import { supabase } from '@/lib/supabase'

const SELFIE_BUCKET = 'attendance-selfies'

export interface CapturedSelfie {
  blob: Blob
  previewUrl: string
  extension: 'jpg' | 'png'
  contentType: 'image/jpeg' | 'image/png'
  capturedAt: string
  watermarkApplied: boolean
}

export interface AttendancePhotoLocation {
  latitude: number
  longitude: number
  accuracyM: number
}

export interface AttendancePhotoWatermark {
  location: AttendancePhotoLocation | null
  timeZone?: string
}

function base64ToBlob(value: string, contentType: string): Blob {
  const normalized = value.includes(',') ? value.slice(value.indexOf(',') + 1) : value
  const binary = atob(normalized)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: contentType })
}

export function releaseSelfiePreview(selfie: CapturedSelfie | null) {
  if (selfie?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(selfie.previewUrl)
}

export function attendanceWatermarkLines(
  capturedAt: string,
  watermark: AttendancePhotoWatermark,
): string[] {
  const parsedDate = new Date(capturedAt)
  const timestamp = new Intl.DateTimeFormat('en-PH', {
    timeZone: watermark.timeZone ?? 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate)

  const lines = [`Captured: ${timestamp}`]
  if (watermark.location) {
    lines.push(
      `Location: ${watermark.location.latitude.toFixed(6)}, ${watermark.location.longitude.toFixed(6)} (±${Math.round(watermark.location.accuracyM)} m)`,
    )
  }

  return lines
}

async function loadSelfieImage(blob: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob)
  }

  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('The attendance photo could not be prepared. Please take it again.'))
    }
    image.src = url
  })
}

/**
 * Burn the capture time and, for on-site classes, the verified coordinates
 * into the actual photo pixels before upload. The database still stores the
 * original coordinates separately for server-side geofence validation.
 */
export async function watermarkAttendanceSelfie(
  selfie: CapturedSelfie,
  watermark: AttendancePhotoWatermark,
): Promise<CapturedSelfie> {
  if (selfie.watermarkApplied) return selfie

  const image = await loadSelfieImage(selfie.blob)
  const canvas = document.createElement('canvas')
  canvas.width = image.width
  canvas.height = image.height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('The attendance photo could not be prepared on this device.')

  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  if ('close' in image && typeof image.close === 'function') image.close()

  const lines = attendanceWatermarkLines(selfie.capturedAt, watermark)
  const fontSize = Math.max(18, Math.round(canvas.width * 0.026))
  const lineHeight = Math.round(fontSize * 1.35)
  const padding = Math.max(18, Math.round(canvas.width * 0.025))
  const panelHeight = padding * 2 + lineHeight * lines.length

  context.fillStyle = 'rgba(3, 28, 19, 0.78)'
  context.fillRect(0, canvas.height - panelHeight, canvas.width, panelHeight)
  context.font = `600 ${fontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
  context.textBaseline = 'top'
  context.fillStyle = '#ffffff'
  context.shadowColor = 'rgba(0, 0, 0, 0.65)'
  context.shadowBlur = 3

  lines.forEach((line, index) => {
    context.fillText(line, padding, canvas.height - panelHeight + padding + index * lineHeight)
  })

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (result) => {
        if (result) resolve(result)
        else reject(new Error('The attendance photo could not be saved. Please take it again.'))
      },
      'image/jpeg',
      0.88,
    )
  })

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    extension: 'jpg',
    contentType: 'image/jpeg',
    capturedAt: selfie.capturedAt,
    watermarkApplied: true,
  }
}

/** Take a new photo only. Gallery selection is deliberately not offered. */
export async function captureSelfie(): Promise<CapturedSelfie> {
  const photo = await Camera.takePhoto({
    cameraDirection: CameraDirection.Front,
    correctOrientation: true,
    editable: 'no',
    encodingType: EncodingType.JPEG,
    includeMetadata: true,
    quality: 82,
    saveToGallery: false,
    targetWidth: 1280,
    targetHeight: 1280,
  })

  const format = photo.metadata?.format?.toLowerCase()
  const isPng = format === 'png'
  const contentType = isPng ? 'image/png' : 'image/jpeg'
  let blob: Blob | null = null

  if (photo.webPath) {
    try {
      const response = await fetch(photo.webPath)
      if (response.ok) blob = await response.blob()
    } catch {
      // Native devices can still provide the base64 thumbnail fallback below.
    }
  }

  if (!blob && photo.thumbnail) {
    blob = base64ToBlob(photo.thumbnail, contentType)
  }

  if (!blob || blob.size === 0) {
    throw new Error('The selfie could not be read from the camera. Please take it again.')
  }

  return {
    blob,
    previewUrl: photo.webPath || URL.createObjectURL(blob),
    extension: isPng ? 'png' : 'jpg',
    contentType,
    capturedAt: new Date().toISOString(),
    watermarkApplied: false,
  }
}

/**
 * Upload to the private bucket. Storage RLS requires the first path segment to
 * be the signed-in user ID and the second to be the meeting ID.
 */
export async function uploadAttendanceSelfie(
  selfie: CapturedSelfie,
  userId: string,
  meetingId: string,
): Promise<string> {
  const randomPart = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const path = `${userId}/${meetingId}/${randomPart}.${selfie.extension}`
  const bytes = await selfie.blob.arrayBuffer()

  const { data, error } = await supabase.storage.from(SELFIE_BUCKET).upload(path, bytes, {
    cacheControl: '3600',
    contentType: selfie.contentType,
    upsert: false,
  })

  if (error) throw error
  return data.path
}
