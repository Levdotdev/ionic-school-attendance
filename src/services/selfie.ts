import { Camera, CameraDirection, EncodingType } from '@capacitor/camera'

import { supabase } from '@/lib/supabase'

const SELFIE_BUCKET = 'attendance-selfies'

export interface CapturedSelfie {
  blob: Blob
  previewUrl: string
  extension: 'jpg' | 'png'
  contentType: 'image/jpeg' | 'image/png'
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
