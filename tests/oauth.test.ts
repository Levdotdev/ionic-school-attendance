import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), exchange: vi.fn(), signIn: vi.fn(), native: vi.fn(), open: vi.fn(), getUser: vi.fn(), linkIdentity: vi.fn(), verifyOtp: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {
  getSession: mocks.getSession, exchangeCodeForSession: mocks.exchange, signInWithOAuth: mocks.signIn,
  getUser: mocks.getUser, linkIdentity: mocks.linkIdentity, verifyOtp: mocks.verifyOtp,
} } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native } }))
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.open } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), getLaunchUrl: vi.fn() } }))

import { beginIdentityLink, beginSocialSignIn, completeIdentityLink, completeSocialSignIn, oauthRedirectUrl, pendingIdentityLink } from '@/services/oauth'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/auth/callback')
  mocks.native.mockReturnValue(false)
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
})

describe('auth callback grants', () => {
  it('shows expired email-link errors in the URL fragment even with an existing session', async () => {
    window.history.replaceState({}, '', '/auth/callback#error=access_denied&error_description=Email+link+is+invalid+or+has+expired')
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'previous-user' } } }, error: null })
    await expect(completeSocialSignIn()).rejects.toThrow('Email link is invalid or has expired')
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('exchanges a PKCE grant when automatic URL detection has not completed it', async () => {
    window.history.replaceState({}, '', '/auth/callback?code=one-time-code')
    const session = { user: { id: 'new-user' } }
    mocks.exchange.mockResolvedValue({ data: { session }, error: null })
    expect(await completeSocialSignIn()).toEqual(session)
    expect(mocks.exchange).toHaveBeenCalledWith('one-time-code')
  })

  it('uses the existing custom-scheme callback for native authentication', () => {
    mocks.native.mockReturnValue(true)
    expect(oauthRedirectUrl()).toBe('edu.minsu.attendance://auth/callback')
  })

  it('opens native social authentication outside the app webview', async () => {
    mocks.native.mockReturnValue(true)
    mocks.signIn.mockResolvedValue({ data: { url: 'https://accounts.google.com/signin' }, error: null })
    await beginSocialSignIn('google')
    expect(mocks.signIn).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'edu.minsu.attendance://auth/callback', skipBrowserRedirect: true } })
    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://accounts.google.com/signin' }))
  })
  it('verifies a recovery hash before trusting any already signed-in browser session', async () => {
    window.history.replaceState({}, '', '/auth/callback?token_hash=recovery-hash&type=recovery')
    const session = { user: { id: 'reset-user' } }
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'another-user' } } }, error: null })
    mocks.verifyOtp.mockResolvedValue({ data: { session }, error: null })
    expect(await completeSocialSignIn()).toEqual(session)
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'recovery-hash', type: 'recovery' })
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
  it('does not treat an invalid recovery hash as a successful existing session', async () => {
    window.history.replaceState({}, '', '/auth/callback?token_hash=expired&type=recovery')
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: { message: 'Expired recovery' } })
    await expect(completeSocialSignIn()).rejects.toEqual({ message: 'Expired recovery' })
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
  it('verifies a parent invite hash without requiring the sender’s PKCE verifier or assigning a role', async () => {
    window.history.replaceState({}, '', '/auth/callback?token_hash=parent-invite&type=invite')
    const session = { user: { id: 'invited-parent' } }
    mocks.verifyOtp.mockResolvedValue({ data: { session }, error: null })
    expect(await completeSocialSignIn()).toEqual(session)
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'parent-invite', type: 'invite' })
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
  it('links providers to the verified current user without creating a new sign-in attempt', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'parent-1', identities: [{ provider: 'email' }] } }, error: null })
    mocks.linkIdentity.mockResolvedValue({ data: { url: 'https://accounts.google.com/link' }, error: null })
    await beginIdentityLink('google', 'parent-1', '/parent')
    expect(mocks.linkIdentity).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/callback`, skipBrowserRedirect: false } })
    expect(mocks.signIn).not.toHaveBeenCalled()
    expect(pendingIdentityLink()).toEqual(expect.objectContaining({ userId: 'parent-1', returnPath: '/parent', provider: 'google' }))
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'parent-1', identities: [{ provider: 'email' }, { provider: 'google' }] } }, error: null })
    expect(await completeIdentityLink()).toBe('/parent?account=security&linked=google')
    expect(pendingIdentityLink()).toBeNull()
  })
  it('refuses to complete linking for a different signed-in user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'student-1', identities: [{ provider: 'email' }] } }, error: null })
    mocks.linkIdentity.mockResolvedValue({ data: {}, error: null })
    await beginIdentityLink('facebook', 'student-1', '/student')
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'teacher-2', identities: [{ provider: 'facebook' }] } }, error: null })
    await expect(completeIdentityLink()).rejects.toThrow('account changed')
  })
  it('rejects account-link return paths outside role dashboards', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'user-1', identities: [] } }, error: null })
    await expect(beginIdentityLink('google', 'user-1', 'https://attacker.invalid')).rejects.toThrow('account dashboard')
    expect(mocks.linkIdentity).not.toHaveBeenCalled()
  })
})
