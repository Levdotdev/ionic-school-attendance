import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ updateUser: vi.fn(), resetPasswordForEmail: vi.fn(), getUser: vi.fn(), getUserIdentities: vi.fn(), unlinkIdentity: vi.fn(), rpc: vi.fn(), verifyPassword: vi.fn(), endVerification: vi.fn(), createClient: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: mocks, rpc: mocks.rpc } }))
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/services/oauth', () => ({ emailRedirectUrl: () => 'https://ionic-school-attendance.vercel.app/auth/callback' }))
import { accountInitials, authActionError, avatarCrop, changeAccountEmail, changeAccountPassword, linkedAuthMethods, MAX_AVATAR_BYTES, readAccountSecurity, requestPasswordReset, resetAccountPassword, unlinkAccountIdentity, validateAvatar } from '@/services/account'

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'public-test-key')
  mocks.updateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }); mocks.resetPasswordForEmail.mockResolvedValue({ error: null })
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'current@example.com' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: [{ has_password: true }], error: null })
  mocks.verifyPassword.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }); mocks.endVerification.mockResolvedValue({ error: null })
  mocks.createClient.mockReturnValue({ auth: { signInWithPassword: mocks.verifyPassword, signOut: mocks.endVerification } })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('account security actions', () => {
  it('uses verified identity providers, deduplicates them and does not infer email sign-in', () => {
    expect(linkedAuthMethods({ identities: [{ provider: 'google' }, { provider: 'facebook' }, { provider: 'google' }] })).toEqual(['Google', 'Facebook'])
    expect(linkedAuthMethods({ identities: [] })).toEqual([])
    expect(linkedAuthMethods(null)).toEqual([])
  })
  it('normalizes email changes and keeps the approved confirmation callback', async () => {
    await changeAccountEmail(' New@Example.com ', 'Current-password!', 'user-1')
    expect(mocks.updateUser).toHaveBeenCalledWith({ email: 'new@example.com' }, { emailRedirectTo: 'https://ionic-school-attendance.vercel.app/auth/callback' })
    expect(mocks.verifyPassword).toHaveBeenCalledWith({ email: 'current@example.com', password: 'Current-password!' })
    expect(mocks.createClient).toHaveBeenCalledWith('https://example.supabase.co', 'public-test-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: expect.stringMatching(/^minsu-password-check-/) } })
    expect(mocks.endVerification).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('does not submit malformed email changes', async () => {
    await expect(changeAccountEmail('someone')).rejects.toThrow('Enter a valid email')
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
  it('uses a nonce only when secure password change requires it', async () => {
    await changeAccountPassword('New-password-1!', undefined, 'Current-password!', 'user-1')
    await changeAccountPassword('New-password-2!', ' 123456 ', 'Current-password!', 'user-1')
    expect(mocks.updateUser).toHaveBeenNthCalledWith(1, { password: 'New-password-1!', current_password: 'Current-password!' })
    expect(mocks.updateUser).toHaveBeenNthCalledWith(2, { password: 'New-password-2!', current_password: 'Current-password!', nonce: '123456' })
  })
  it('propagates reauthentication and provider errors instead of showing success', async () => {
    const error = { code: 'reauthentication_needed', message: 'Reauthentication required' }
    mocks.updateUser.mockResolvedValue({ data: {}, error })
    await expect(changeAccountPassword('New-password-1!', undefined, 'Current-password!')).rejects.toEqual(error)
    expect(authActionError(error)).toContain('Confirm your identity')
    expect(authActionError({ code: 'email_address_not_authorized' })).toContain('Email delivery is not configured')
    expect(authActionError({ code: 'over_email_send_rate_limit' })).toContain('sending limit')
  })
  it('uses only server-stamped password capability to show Email for a social-first account', () => {
    expect(linkedAuthMethods({ identities: [{provider:'google'}], app_metadata:{has_email_password:true} })).toEqual(['Email','Google'])
    expect(linkedAuthMethods({ identities: [{provider:'google'}], app_metadata:{has_email_password:false} })).toEqual(['Google'])
  })
  it.each(['email','password'])('requires a verified current password for %s changes and does not switch the active session', async kind => {
    const change = () => kind === 'email' ? changeAccountEmail('new@example.com') : changeAccountPassword('New-password!')
    await expect(change()).rejects.toThrow('Enter your current password')
    expect(mocks.updateUser).not.toHaveBeenCalled()
    mocks.verifyPassword.mockResolvedValue({ data:{user:null},error:{message:'Invalid login credentials'} })
    const invalid = () => kind === 'email' ? changeAccountEmail('new@example.com','Wrong!') : changeAccountPassword('New-password!',undefined,'Wrong!')
    await expect(invalid()).rejects.toMatchObject({message:'Invalid login credentials'})
    expect(mocks.updateUser).not.toHaveBeenCalled()
    expect(mocks.endVerification).toHaveBeenCalledWith({scope:'local'})
  })
  it('rejects account switches during verification instead of changing the new actor', async () => {
    mocks.getUser.mockResolvedValueOnce({data:{user:{id:'user-1',email:'current@example.com'}},error:null}).mockResolvedValueOnce({data:{user:{id:'another-user',email:'other@example.com'}},error:null})
    await expect(changeAccountEmail('new@example.com','Current-password!','user-1')).rejects.toThrow('account changed')
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
  it('supports an initial social-account password after email reauthentication without demanding an old password', async () => {
    mocks.rpc.mockResolvedValue({data:[{has_password:false}],error:null})
    await expect(changeAccountPassword('New-password!')).rejects.toThrow('verification code')
    await changeAccountPassword('New-password!','123456',undefined,'user-1')
    expect(mocks.updateUser).toHaveBeenCalledExactlyOnceWith({password:'New-password!',nonce:'123456'})
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
    await expect(changeAccountEmail('new@example.com','Not-an-existing-password')).rejects.toThrow('Set an email sign-in password')
  })
  it('fails closed when actual password capability cannot be read', async () => {
    mocks.rpc.mockResolvedValue({data:[],error:null})
    await expect(readAccountSecurity()).rejects.toThrow('could not be verified')
    await expect(changeAccountEmail('new@example.com','Current!')).rejects.toThrow('could not be verified')
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
  it('keeps a verified recovery link able to replace a forgotten password', async () => {
    await resetAccountPassword('Recovered-password!')
    expect(mocks.updateUser).toHaveBeenCalledWith({password:'Recovered-password!'})
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('requests recovery through the existing callback without modifying password or metadata', async () => {
    await requestPasswordReset(' Person@Example.com ')
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('person@example.com', { redirectTo: 'https://ionic-school-attendance.vercel.app/auth/callback' })
    expect(mocks.updateUser).not.toHaveBeenCalled()
  })
  it('unlinks only an identity confirmed for the currently signed-in user', async () => {
    const identity = { id: 'google-id', provider: 'google' }
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.getUserIdentities.mockResolvedValue({ data: { identities: [{ id: 'email-id', provider: 'email' }, identity] }, error: null })
    mocks.unlinkIdentity.mockResolvedValue({ error: null })
    await unlinkAccountIdentity('google', 'user-1')
    expect(mocks.unlinkIdentity).toHaveBeenCalledWith(identity)
  })
  it('does not remove the last method or act on a different account', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mocks.getUserIdentities.mockResolvedValue({ data: { identities: [{ id: 'google-id', provider: 'google' }] }, error: null })
    await expect(unlinkAccountIdentity('google', 'user-1')).rejects.toThrow('Keep at least one')
    expect(mocks.unlinkIdentity).not.toHaveBeenCalled()
    await expect(unlinkAccountIdentity('google', 'another-user')).rejects.toThrow('account changed')
    expect(mocks.unlinkIdentity).not.toHaveBeenCalled()
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
