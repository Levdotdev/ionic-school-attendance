import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), initialize: vi.fn(), exchange: vi.fn(), signIn: vi.fn(), native: vi.fn(), open: vi.fn(), close: vi.fn(), addListener: vi.fn(), getLaunchUrl: vi.fn(), getUser: vi.fn(), linkIdentity: vi.fn(), verifyOtp: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {
  getSession: mocks.getSession, exchangeCodeForSession: mocks.exchange, signInWithOAuth: mocks.signIn,
  getUser: mocks.getUser, linkIdentity: mocks.linkIdentity, verifyOtp: mocks.verifyOtp,
  initialize: mocks.initialize,
} } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native } }))
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.open, close: mocks.close } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.addListener, getLaunchUrl: mocks.getLaunchUrl } }))

import { beginIdentityLink, beginSocialSignIn, completeIdentityLink, completeSocialSignIn, emailRedirectUrl, nativeCallbackPath, nativeEmailActionLink, oauthRedirectUrl, pendingIdentityLink } from '@/services/oauth'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.sessionStorage.clear()
  window.history.replaceState({}, '', '/auth/callback')
  mocks.native.mockReturnValue(false)
  mocks.getSession.mockResolvedValue({ data: { session: null }, error: null })
  mocks.initialize.mockResolvedValue({ error: null })
  mocks.close.mockResolvedValue(undefined)
})
afterEach(() => { vi.unstubAllGlobals() })

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
  it('uses clickable HTTPS email links for Android while leaving provider OAuth callbacks unchanged', () => {
    mocks.native.mockReturnValue(true)
    expect(emailRedirectUrl()).toBe('https://ionic-school-attendance.vercel.app/auth/mobile')
    expect(oauthRedirectUrl()).toBe('edu.minsu.attendance://auth/callback')
    mocks.native.mockReturnValue(false)
    expect(emailRedirectUrl()).toBe(`${window.location.origin}/auth/callback`)
  })
  it.each(['email','email_change','recovery','invite'])('preserves a %s hash for the explicit native handoff without consuming it', type => {
    const link = nativeEmailActionLink(`https://ionic-school-attendance.vercel.app/auth/mobile?token_hash=test%2Bhash&type=${type}&next=https://attacker.invalid`)
    expect(link).toBe(`edu.minsu.attendance://auth/callback?token_hash=test%2Bhash&type=${type}`)
    expect(nativeCallbackPath(link!)).toBe(`/auth/callback?token_hash=test%2Bhash&type=${type}`)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })
  it.each(['https://attacker.invalid/auth/callback?code=x','edu.minsu.attendance://evil/callback?code=x','edu.minsu.attendance://auth/callback/evil?code=x'])('rejects untrusted native callback %s', url => {
    expect(nativeCallbackPath(url)).toBeNull()
  })
  it('handles cold and warm Android links once, including a repeated launch URL after webview reload', async () => {
    const { webcrypto } = await import('node:crypto')
    vi.stubGlobal('crypto',webcrypto)
    mocks.native.mockReturnValue(true)
    const cold='edu.minsu.attendance://auth/callback?token_hash=cold-test-hash&type=recovery'
    const warm='edu.minsu.attendance://auth/callback?token_hash=warm-test-hash&type=email_change'
    mocks.getLaunchUrl.mockResolvedValue({url:cold})
    const navigate=vi.fn()
    vi.resetModules()
    const first=await import('@/services/oauth')
    await first.initializeNativeOAuthCallback(navigate)
    expect(navigate).toHaveBeenCalledExactlyOnceWith('/auth/callback?token_hash=cold-test-hash&type=recovery')
    const listener=mocks.addListener.mock.calls.at(-1)![1] as (event:{url:string})=>void
    listener({url:warm})
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(2))
    expect(navigate).toHaveBeenLastCalledWith('/auth/callback?token_hash=warm-test-hash&type=email_change')
    const stored=window.sessionStorage.getItem('minsu-native-callback-digests')!
    expect(stored).not.toContain('cold-test-hash'); expect(stored).not.toContain('warm-test-hash')
    vi.resetModules()
    const reloaded=await import('@/services/oauth')
    await reloaded.initializeNativeOAuthCallback(navigate)
    expect(navigate).toHaveBeenCalledTimes(2)
    // A deliberate new tap may retry a token that failed before verification;
    // it is different from getLaunchUrl replaying the old launch automatically.
    const retryListener=mocks.addListener.mock.calls.at(-1)![1] as (event:{url:string})=>void
    retryListener({url:warm})
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(3))
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
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
  it.each(['email', 'email_change', 'recovery', 'invite'])('rejects expired %s hashes even when another browser account is signed in', async type => {
    window.history.replaceState({}, '', `/auth/callback?token_hash=expired&type=${type}`)
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'existing-account' } } }, error: null })
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: { code: 'otp_expired', message: 'Email link is invalid or has expired' } })
    await expect(completeSocialSignIn()).rejects.toMatchObject({ code: 'otp_expired' })
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
  it.each(['email', 'email_change'])('verifies a %s hash directly without depending on a PKCE verifier', async type => {
    window.history.replaceState({}, '', `/auth/callback?token_hash=valid-hash&type=${type}`)
    const session = { user: { id: 'confirmed-account' } }
    mocks.verifyOtp.mockResolvedValue({ data: { session, user: session.user }, error: null })
    expect(await completeSocialSignIn()).toEqual(session)
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'valid-hash', type })
    expect(mocks.exchange).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(window.location.search).not.toContain('token_hash')
  })
  it('distinguishes the first secure email-change confirmation from a completed change', async () => {
    window.history.replaceState({}, '', '/auth/callback?token_hash=first-mailbox&type=email_change')
    mocks.verifyOtp.mockResolvedValue({ data: { session: null, user: null }, error: null })
    expect(await completeSocialSignIn()).toEqual({ emailChangeConfirmationPending: true })
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(window.location.search).toBe('')
  })
  it.each(['/auth/callback?token_hash=&type=email', '/auth/callback?token_hash=hash', '/auth/callback?type=email', '/auth/callback?token_hash=hash&type=admin', '/auth/callback?code=', '/auth/callback?code=%20&type=email_change'])('rejects malformed or unsupported email action %s before trusting a session', async url => {
    window.history.replaceState({}, '', url)
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'existing-account' } } }, error: null })
    await expect(completeSocialSignIn()).rejects.toThrow(/not supported|incomplete/)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
  it.each(['signup', 'email_change', 'recovery', 'invite'])('does not treat an expired %s PKCE exchange as a successful cached session', async type => {
    window.history.replaceState({}, '', `/auth/callback?code=expired-code&type=${type}`)
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'existing-account' } } }, error: null })
    mocks.exchange.mockResolvedValue({ data: { session: null }, error: { code: 'flow_state_expired', message: 'Flow expired' } })
    await expect(completeSocialSignIn()).rejects.toMatchObject({ code: 'flow_state_expired' })
    expect(mocks.exchange).toHaveBeenCalledWith('expired-code')
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
  it('propagates failed automatic callback initialization instead of trusting an old session', async () => {
    mocks.initialize.mockResolvedValue({ error: { code: 'otp_expired', message: 'Expired email change' } })
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'existing-account' } } }, error: null })
    await expect(completeSocialSignIn()).rejects.toMatchObject({ code: 'otp_expired' })
    expect(mocks.getSession).not.toHaveBeenCalled()
  })
  it('does not exchange a grant twice after the SDK successfully consumed it', async () => {
    window.history.replaceState({}, '', '/auth/callback?code=one-time-code')
    mocks.initialize.mockImplementation(async () => { window.history.replaceState({}, '', '/auth/callback'); return { error: null } })
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'verified-account' } } }, error: null })
    expect(await completeSocialSignIn()).toMatchObject({ user: { id: 'verified-account' } })
    expect(mocks.exchange).not.toHaveBeenCalled()
  })
  it('handles a bare expired error code before looking for a saved session', async () => {
    window.history.replaceState({}, '', '/auth/callback#error_code=otp_expired')
    await expect(completeSocialSignIn()).rejects.toThrow('invalid or has expired')
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
