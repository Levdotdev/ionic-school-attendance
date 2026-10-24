import type { User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { oauthRedirectUrl } from '@/services/oauth'
import { toUserFacingErrorMessage } from '@/utils/errors'

export const AVATAR_BUCKET = 'profile-avatars'
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

/** Display only identities confirmed by Auth, never infer them from a role. */
export function linkedAuthMethods(account: { readonly identities?: readonly { readonly provider: string }[] } | null | undefined): string[] {
  const labels: Record<string, string> = { email: 'Email', google: 'Google', facebook: 'Facebook', phone: 'Phone' }
  return [...new Set((account?.identities ?? []).map(identity => identity.provider))]
    .map(provider => labels[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1))
}

export function accountInitials(name: string): string {
  return name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || 'ME'
}

export function authActionError(error: unknown, fallback?: string): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
  if (code === 'over_email_send_rate_limit') return 'The email service has reached its sending limit. Please try again later. If this continues, contact your administrator.'
  if (code === 'over_request_rate_limit') return 'Too many requests. Wait a moment before trying again.'
  if (code === 'email_address_not_authorized') return 'Email delivery is not configured for this address. Please contact your administrator to enable the school email service.'
  if (code === 'reauthentication_needed') return 'Confirm your identity with a verification code before changing your password.'
  if (code === 'reauthentication_not_valid') return 'That verification code is invalid or expired. Request a new code and try again.'
  if (code === 'same_password') return 'Choose a different password from your current password.'
  if (code === 'weak_password') return 'Choose a stronger password with at least 8 characters, uppercase and lowercase letters, a number, and a symbol.'
  return toUserFacingErrorMessage(error, fallback)
}

export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid email address.')
  const { error } = await supabase.auth.resetPasswordForEmail(normalized, { redirectTo: oauthRedirectUrl() })
  if (error) throw error
}

export async function changeAccountEmail(email: string): Promise<User> {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid email address.')
  const { data, error } = await supabase.auth.updateUser({ email: normalized }, { emailRedirectTo: oauthRedirectUrl() })
  if (error) throw error
  return data.user
}

export async function changeAccountPassword(password: string, nonce?: string): Promise<void> {
  if (password.length < 8) throw new Error('Use at least 8 characters for your new password.')
  const { error } = await supabase.auth.updateUser({ password, ...(nonce?.trim() ? { nonce: nonce.trim() } : {}) })
  if (error) throw error
}

export function validateAvatar(file: Blob): void {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Choose a JPG, PNG, or WebP picture.')
  if (file.size > MAX_AVATAR_BYTES) throw new Error('Choose a picture smaller than 5 MB.')
  if (!file.size) throw new Error('This picture is empty. Please choose another one.')
}

export function avatarCrop(width: number, height: number, zoom = 1) {
  const size = Math.min(width, height) / Math.max(1, Math.min(zoom, 3))
  return { x: (width - size) / 2, y: (height - size) / 2, size }
}

/** Re-encoding strips photo metadata; only the chosen square is uploaded. */
export async function createAvatar(file: Blob, zoom = 1): Promise<Blob> {
  validateAvatar(file)
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('This picture could not be opened. Choose another one.')); image.src = url })
    const canvas = document.createElement('canvas')
    canvas.width = 512; canvas.height = 512
    const context = canvas.getContext('2d')
    if (!context || !image.naturalWidth || !image.naturalHeight) throw new Error('Your device could not process this picture.')
    const crop = avatarCrop(image.naturalWidth, image.naturalHeight, zoom)
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, 512, 512)
    context.drawImage(image, crop.x, crop.y, crop.size, crop.size, 0, 0, 512, 512)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Your picture could not be saved.')), 'image/jpeg', .88))
  } finally { URL.revokeObjectURL(url) }
}

export async function uploadAvatar(userId: string, file: Blob, zoom = 1, previousPath?: string | null): Promise<string> {
  const blob = await createAvatar(file, zoom)
  const path = `${userId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage.from(AVATAR_BUCKET).upload(path, blob, { contentType: 'image/jpeg', cacheControl: '3600', upsert: false })
  if (error) throw error
  try {
    const result = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId).select('id').single()
    if (result.error) throw result.error
    if (!result.data) throw new Error('Your profile could not be updated. Please sign in again.')
  } catch (error) {
    await supabase.storage.from(AVATAR_BUCKET).remove([path]).catch(() => undefined)
    throw error
  }
  if (previousPath && previousPath !== path && previousPath.startsWith(`${userId}/`)) {
    await supabase.storage.from(AVATAR_BUCKET).remove([previousPath]).catch(() => undefined)
  }
  return path
}

export async function removeAvatar(userId: string, previousPath: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', userId).select('id').single()
  if (error) throw error
  if (previousPath.startsWith(`${userId}/`)) await supabase.storage.from(AVATAR_BUCKET).remove([previousPath])
}
