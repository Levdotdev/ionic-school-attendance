import { createClient, type User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { emailRedirectUrl } from '@/services/oauth'
import { toUserFacingErrorMessage } from '@/utils/errors'

export const AVATAR_BUCKET = 'profile-avatars'
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024

/** Display only identities confirmed by Auth, never infer them from a role. */
export function linkedAuthMethods(account: { readonly identities?: readonly { readonly provider: string }[]; readonly app_metadata?: Readonly<Record<string, unknown>> } | null | undefined): string[] {
  const labels: Record<string, string> = { email: 'Email', google: 'Google', facebook: 'Facebook', phone: 'Phone' }
  const providers = (account?.identities ?? []).map(identity => identity.provider)
  // Social-first users can set a password without Auth adding an email identity.
  // This flag is stamped by a protected Auth trigger, never user metadata.
  if (account?.app_metadata?.has_email_password === true) providers.unshift('email')
  return [...new Set(providers)]
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
  if (code === 'manual_linking_disabled') return 'Linking sign-in methods is not enabled for this school yet. Please contact your administrator.'
  if (code === 'identity_already_exists') return 'That provider account is already linked to a different user. Use another account or ask your administrator for help.'
  if (code === 'single_identity_not_deletable') return 'Keep at least one sign-in method linked so you can access your account.'
  if (code === 'weak_password') return 'Choose a stronger password with at least 8 characters, uppercase and lowercase letters, a number, and a symbol.'
  return toUserFacingErrorMessage(error, fallback)
}

export async function unlinkAccountIdentity(provider: 'google' | 'facebook', expectedUserId: string): Promise<void> {
  // Refresh before removing, including the server's last-method safeguard.
  const current = await supabase.auth.getUser()
  if (current.error) throw current.error
  if (!current.data.user || current.data.user.id !== expectedUserId) throw new Error('Your account changed. Reopen Security before removing a sign-in method.')
  const { data, error } = await supabase.auth.getUserIdentities()
  if (error) throw error
  const identities = data.identities ?? []
  const identity = identities.find(item => item.provider === provider)
  if (!identity) throw new Error('This sign-in method is no longer linked.')
  if (identities.length < 2) throw new Error('Keep at least one sign-in method linked so you can access your account.')
  const result = await supabase.auth.unlinkIdentity(identity)
  if (result.error) throw result.error
}

export async function requestPasswordReset(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid email address.')
  const { error } = await supabase.auth.resetPasswordForEmail(normalized, { redirectTo: emailRedirectUrl() })
  if (error) throw error
}

export async function readAccountSecurity(): Promise<{ hasPassword: boolean }> {
  const { data, error } = await supabase.rpc('my_account_security')
  if (error) throw error
  if (!Array.isArray(data) || typeof data[0]?.has_password !== 'boolean') throw new Error('Your security settings could not be verified. Please reopen Security.')
  return { hasPassword: data[0].has_password }
}

async function verifiedAccount(expectedUserId?: string): Promise<User> {
  const current = await supabase.auth.getUser()
  if (current.error) throw current.error
  if (!current.data.user || (expectedUserId && current.data.user.id !== expectedUserId)) throw new Error('Your account changed. Reopen Security and try again.')
  return current.data.user
}

async function verifyCurrentPassword(current: User, password?: string): Promise<void> {
  if (!password) throw new Error('Enter your current password.')
  if (!current.email) throw new Error('Your current email address could not be verified.')
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key) throw new Error('Account verification is not configured.')
  // A separate memory-only session prevents a password check from replacing
  // this app's actor or broadcasting a sign-in to its other open tabs.
  const verifier = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `minsu-password-check-${crypto.randomUUID()}` } })
  try {
    const result = await verifier.auth.signInWithPassword({ email: current.email, password })
    if (result.error) throw result.error
    if (result.data.user?.id !== current.id) throw new Error('Your password did not verify this account.')
    await verifiedAccount(current.id)
  } finally {
    await verifier.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }
}

export async function changeAccountEmail(email: string, currentPassword?: string, expectedUserId?: string): Promise<User> {
  const normalized = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Enter a valid email address.')
  const current = await verifiedAccount(expectedUserId)
  const security = await readAccountSecurity()
  if (!security.hasPassword) throw new Error('Set an email sign-in password in Security before changing your email address.')
  await verifyCurrentPassword(current, currentPassword)
  const { data, error } = await supabase.auth.updateUser({ email: normalized }, { emailRedirectTo: emailRedirectUrl() })
  if (error) throw error
  return data.user
}

export async function changeAccountPassword(password: string, nonce?: string, currentPassword?: string, expectedUserId?: string): Promise<void> {
  if (password.length < 8) throw new Error('Use at least 8 characters for your new password.')
  const current = await verifiedAccount(expectedUserId)
  const security = await readAccountSecurity()
  if (security.hasPassword) await verifyCurrentPassword(current, currentPassword)
  else if (!nonce?.trim()) throw new Error('Request a verification code and enter it before setting your first password.')
  await verifiedAccount(current.id)
  const { error } = await supabase.auth.updateUser({ password, ...(security.hasPassword ? { current_password: currentPassword } : {}), ...(nonce?.trim() ? { nonce: nonce.trim() } : {}) })
  if (error) throw error
}

/** Only called after the recovery callback has verified the single-use link. */
export async function resetAccountPassword(password: string): Promise<void> {
  if (password.length < 8) throw new Error('Use at least 8 characters for your new password.')
  const { error } = await supabase.auth.updateUser({ password })
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
