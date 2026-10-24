import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ updateUser: vi.fn(), resetPasswordForEmail: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: mocks } }))
vi.mock('@/services/oauth', () => ({ oauthRedirectUrl: () => 'https://ionic-school-attendance.vercel.app/auth/callback' }))
import { accountInitials, authActionError, avatarCrop, changeAccountEmail, changeAccountPassword, linkedAuthMethods, MAX_AVATAR_BYTES, requestPasswordReset, validateAvatar } from '@/services/account'

beforeEach(() => { vi.clearAllMocks(); mocks.updateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }); mocks.resetPasswordForEmail.mockResolvedValue({ error: null }) })

describe('account security actions', () => {
  it('uses verified identity providers, deduplicates them and does not infer email sign-in', () => {
    expect(linkedAuthMethods({ identities: [{ provider: 'google' }, { provider: 'facebook' }, { provider: 'google' }] })).toEqual(['Google', 'Facebook'])
    expect(linkedAuthMethods({ identities: [] })).toEqual([])
    expect(linkedAuthMethods(null)).toEqual([])
  })
  it('normalizes email changes and keeps the approved confirmation callback', async () => {
    await changeAccountEmail(' New@Example.com ')
    expect(mocks.updateUser).toHaveBeenCalledWith({ email: 'new@example.com' }, { emailRedirectTo: 'https://ionic-school-attendance.vercel.app/auth/callback' })
  })
  it('does not submit malformed email changes', async () => {
    await expect(changeAccountEmail('someone')).rejects.toThrow('Enter a valid email')
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
  it('uses a nonce only when secure password change requires it', async () => {
    await changeAccountPassword('New-password-1!')
    await changeAccountPassword('New-password-2!', ' 123456 ')
    expect(mocks.updateUser).toHaveBeenNthCalledWith(1, { password: 'New-password-1!' })
    expect(mocks.updateUser).toHaveBeenNthCalledWith(2, { password: 'New-password-2!', nonce: '123456' })
  })
  it('propagates reauthentication and provider errors instead of showing success', async () => {
    const error = { code: 'reauthentication_needed', message: 'Reauthentication required' }
    mocks.updateUser.mockResolvedValue({ data: {}, error })
    await expect(changeAccountPassword('New-password-1!')).rejects.toEqual(error)
    expect(authActionError(error)).toContain('Confirm your identity')
    expect(authActionError({ code: 'email_address_not_authorized' })).toContain('Email delivery is not configured')
    expect(authActionError({ code: 'over_email_send_rate_limit' })).toContain('sending limit')
  })
  it('requests recovery through the existing callback without modifying password or metadata', async () => {
    await requestPasswordReset(' Person@Example.com ')
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', { redirectTo: 'https://ionic-school-attendance.vercel.app/auth/callback' })
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
})

describe('profile pictures', () => {
  it('centers and zooms a square crop without going outside the source image', () => {
    expect(avatarCrop(1200, 800)).toEqual({ x: 200, y: 0, size: 800 })
    expect(avatarCrop(800, 1200, 2)).toEqual({ x: 200, y: 400, size: 400 })
    expect(avatarCrop(1200, 800, 0)).toEqual(avatarCrop(1200, 800, 1))
    expect(avatarCrop(1200, 800, 100)).toEqual(avatarCrop(1200, 800, 3))
  })
  it('rejects unsupported, oversized, and empty pictures before upload', () => {
    expect(() => validateAvatar(new Blob(['x'], { type: 'image/svg+xml' }))).toThrow('JPG, PNG, or WebP')
    expect(() => validateAvatar(new Blob([new Uint8Array(MAX_AVATAR_BYTES + 1)], { type: 'image/png' }))).toThrow('smaller than 5 MB')
    expect(() => validateAvatar(new Blob([], { type: 'image/jpeg' }))).toThrow('empty')
    expect(() => validateAvatar(new Blob(['image'], { type: 'image/jpeg' }))).not.toThrow()
  })
  it('uses name initials when a person has no picture', () => {
    expect(accountInitials(' Lance Brito ')).toBe('LB')
    expect(accountInitials('')).toBe('ME')
  })
})
