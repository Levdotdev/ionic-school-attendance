import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), exchange: vi.fn(), signIn: vi.fn(), native: vi.fn(), open: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {
  getSession: mocks.getSession, exchangeCodeForSession: mocks.exchange, signInWithOAuth: mocks.signIn,
} } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: mocks.native } }))
vi.mock('@capacitor/browser', () => ({ Browser: { open: mocks.open } }))
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(), getLaunchUrl: vi.fn() } }))

import { beginSocialSignIn, completeSocialSignIn, oauthRedirectUrl } from '@/services/oauth'

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
})
