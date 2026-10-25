import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import type { Session } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'

export type SocialProvider = 'google' | 'facebook'

const OAUTH_PROVIDER_KEY = 'minsu-oauth-provider'
const OAUTH_STARTED_AT_KEY = 'minsu-oauth-started-at'
const IDENTITY_LINK_KEY = 'minsu-identity-link-attempt'
const IDENTITY_LINK_WINDOW_MS = 15 * 60 * 1000
const NEW_ACCOUNT_WINDOW_MS = 5 * 60 * 1000
const NATIVE_CALLBACK_URL = 'edu.minsu.attendance://auth/callback'
const NATIVE_EMAIL_PAGE = 'https://ionic-school-attendance.vercel.app/auth/mobile'
const NATIVE_CALLBACK_HISTORY_KEY = 'minsu-native-callback-digests'

let nativeCallbackInstalled = false
let nativeCallbackQueue: Promise<void> = Promise.resolve()

export function oauthRedirectUrl(): string {
  if (Capacitor.isNativePlatform()) return NATIVE_CALLBACK_URL
  return new URL('/auth/callback', window.location.origin).toString()
}

/** HTTPS links remain clickable in Gmail and offer an explicit native handoff. */
export function emailRedirectUrl(): string {
  return Capacitor.isNativePlatform() ? NATIVE_EMAIL_PAGE : new URL('/auth/callback', window.location.origin).toString()
}

export function nativeEmailActionLink(value: string): string | null {
  try {
    const url = new URL(value)
    const token = url.searchParams.get('token_hash')
    const type = url.searchParams.get('type')
    if (!token?.trim() || !['email', 'email_change', 'recovery', 'invite'].includes(type ?? '')) return null
    const result = new URL(NATIVE_CALLBACK_URL)
    result.searchParams.set('token_hash', token)
    result.searchParams.set('type', type!)
    return result.toString()
  } catch { return null }
}

export async function beginSocialSignIn(provider: SocialProvider): Promise<void> {
  clearIdentityLinkAttempt()
  window.localStorage.setItem(OAUTH_PROVIDER_KEY, provider)
  window.localStorage.setItem(OAUTH_STARTED_AT_KEY, Date.now().toString())

  const isNative = Capacitor.isNativePlatform()
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: oauthRedirectUrl(),
      skipBrowserRedirect: isNative,
    },
  })

  if (error) {
    clearOAuthAttempt()
    throw error
  }

  if (isNative) {
    if (!data.url) {
      clearOAuthAttempt()
      throw new Error('The social sign-in page could not be opened. Please try again.')
    }

    await Browser.open({
      url: data.url,
      toolbarColor: '#063f2a',
    })
  }
}

interface IdentityLinkAttempt { userId: string; provider: SocialProvider; returnPath: string; startedAt: number }

export function pendingIdentityLink(): IdentityLinkAttempt | null {
  try {
    const stored = JSON.parse(window.localStorage.getItem(IDENTITY_LINK_KEY) ?? 'null') as IdentityLinkAttempt | null
    if (!stored || !stored.userId || !['google', 'facebook'].includes(stored.provider)
      || !/^\/(student|teacher|parent|admin)$/.test(stored.returnPath)
      || !Number.isFinite(stored.startedAt) || Date.now() < stored.startedAt
      || Date.now() - stored.startedAt > IDENTITY_LINK_WINDOW_MS) return null
    return stored
  } catch { return null }
}

export function clearIdentityLinkAttempt(): void { window.localStorage.removeItem(IDENTITY_LINK_KEY) }

export async function beginIdentityLink(provider: SocialProvider, expectedUserId: string, returnPath: string): Promise<void> {
  const { data: current, error: currentError } = await supabase.auth.getUser()
  if (currentError) throw currentError
  if (!current.user || current.user.id !== expectedUserId) throw new Error('Your account changed. Open Security again before linking a sign-in method.')
  if (current.user.identities?.some(identity => identity.provider === provider)) throw new Error('This sign-in method is already linked.')
  if (!/^\/(student|teacher|parent|admin)$/.test(returnPath)) throw new Error('Return to your account dashboard before linking a sign-in method.')
  window.localStorage.setItem(IDENTITY_LINK_KEY, JSON.stringify({ userId: current.user.id, provider, returnPath, startedAt: Date.now() }))
  const isNative = Capacitor.isNativePlatform()
  try {
    const { data, error } = await supabase.auth.linkIdentity({ provider, options: { redirectTo: oauthRedirectUrl(), skipBrowserRedirect: isNative } })
    if (error) throw error
    if (isNative) {
      if (!data.url) throw new Error('The account-linking page could not be opened. Please try again.')
      await Browser.open({ url: data.url, toolbarColor: '#29483a' })
    }
  } catch (error) { clearIdentityLinkAttempt(); throw error }
}

export async function completeIdentityLink(): Promise<string> {
  const attempt = pendingIdentityLink()
  if (!attempt) throw new Error('This account-linking request expired. Return to Security and try again.')
  const { data, error } = await supabase.auth.getUser()
  if (error) throw error
  if (data.user?.id !== attempt.userId) throw new Error('The sign-in account changed. No account data or role has been merged. Return to your original account and try linking again.')
  if (!data.user.identities?.some(identity => identity.provider === attempt.provider)) throw new Error('The provider was not linked. Return to Security and try again.')
  clearIdentityLinkAttempt()
  return `${attempt.returnPath}?account=security&linked=${attempt.provider}`
}

export function nativeCallbackPath(value: string): string | null {
  try {
    const url = new URL(value)
    const isExpectedCallback = url.protocol === 'edu.minsu.attendance:'
      && url.hostname === 'auth'
      && url.pathname === '/callback'

    return isExpectedCallback ? `/auth/callback${url.search}${url.hash}` : null
  } catch {
    return null
  }
}

/**
 * Routes Android deep links back into the web app so the normal callback page
 * can exchange the PKCE authorization code. The launch URL check also covers
 * the operating system recreating the app while the provider browser is open.
 */
export async function initializeNativeOAuthCallback(navigate: (path: string) => void = path => window.location.assign(path)): Promise<void> {
  if (!Capacitor.isNativePlatform() || nativeCallbackInstalled) return
  nativeCallbackInstalled = true

  const continueInApp = async (value: string, isLaunchReplay: boolean) => {
    const path = nativeCallbackPath(value)
    if (!path) return
    // getLaunchUrl keeps returning the original launch link after a webview
    // reload. Remember only a digest, so a cold launch cannot replay/reload its
    // grant indefinitely or overwrite a later warm-link callback.
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
    const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
    let history: string[] = []
    try {
      const stored: unknown = JSON.parse(window.sessionStorage.getItem(NATIVE_CALLBACK_HISTORY_KEY) ?? '[]')
      if (Array.isArray(stored)) history = stored.filter(item => typeof item === 'string' && /^[a-f0-9]{64}$/.test(item)).slice(-20)
    } catch { /* The in-memory current-URL check still avoids identical reloads. */ }
    // Explicit appUrlOpen intents can retry a link after a temporary failure.
    // Suppress only the launch URL automatically repeated after each reload.
    if (isLaunchReplay && history.includes(digest)) return
    try { window.sessionStorage.setItem(NATIVE_CALLBACK_HISTORY_KEY, JSON.stringify([...history, digest].slice(-20))) } catch { /* Session storage may be disabled. */ }
    await Browser.close().catch(() => undefined)
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== path) navigate(path)
  }
  const enqueue = (url: string, isLaunchReplay: boolean) => { nativeCallbackQueue = nativeCallbackQueue.catch(() => undefined).then(() => continueInApp(url, isLaunchReplay)); return nativeCallbackQueue }
  try {
    await App.addListener('appUrlOpen', ({ url }) => { void enqueue(url, false).catch(() => console.warn('The account link could not be opened. Please open the link again.')) })
    const launchUrl = await App.getLaunchUrl()
    if (launchUrl?.url) await enqueue(launchUrl.url, true)
  } catch (error) { nativeCallbackInstalled = false; throw error }
}

/**
 * The Supabase client automatically detects PKCE grants in the URL. The
 * explicit exchange is a safe fallback for environments where initialization
 * has not processed the callback yet.
 */
export type SocialSignInResult = Session | { emailChangeConfirmationPending: true }
export async function completeSocialSignIn(): Promise<SocialSignInResult> {
  const callbackUrl = new URL(window.location.href)
  if (callbackUrl.searchParams.has('token_hash')) clearIdentityLinkAttempt()
  const hash = new URLSearchParams(callbackUrl.hash.slice(1))
  const providerError = callbackUrl.searchParams.get('error_description')
    ?? callbackUrl.searchParams.get('error')
    ?? callbackUrl.searchParams.get('error_code')
    ?? hash.get('error_description')
    ?? hash.get('error')
    ?? hash.get('error_code')

  if (providerError) {
    if (providerError === 'otp_expired' || providerError === 'flow_state_expired') throw new Error('This email link is invalid or has expired. Request a new link from the app.')
    throw new Error(providerError.replaceAll('+', ' '))
  }

  const tokenHash = callbackUrl.searchParams.get('token_hash')
  if (callbackUrl.searchParams.has('token_hash')) {
    // Verify single-use hashes even if this browser already has a session.
    // Admin invites cannot use PKCE; a token hash avoids an incompatible
    // implicit-grant redirect and works across browsers without a verifier.
    clearIdentityLinkAttempt()
    const type = callbackUrl.searchParams.get('type')
    try {
      if (!tokenHash?.trim() || (type !== 'email' && type !== 'email_change' && type !== 'recovery' && type !== 'invite')) throw new Error('This email action is not supported. Request a new link from the app.')
      const result = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      if (result.error) throw result.error
      // Secure email changes accept the first mailbox confirmation without
      // issuing a session. That is not a completed address change.
      if (type === 'email_change' && !result.data.session && !result.data.user) return { emailChangeConfirmationPending: true }
      if (!result.data.session) throw new Error('This email link could not be completed. Request a new link from the app.')
      return result.data.session
    } finally {
      // Tokens are single-use credentials; remove them from visible/history
      // URLs even when the first email confirmation keeps this page open.
      const clean = new URL(window.location.href)
      clean.searchParams.delete('token_hash'); clean.searchParams.delete('type')
      window.history.replaceState(window.history.state, '', clean.toString())
    }
  }

  if (callbackUrl.searchParams.has('type') && !callbackUrl.searchParams.has('code')) throw new Error('This email link is incomplete. Request a new link from the app.')
  if (callbackUrl.searchParams.has('code') && !callbackUrl.searchParams.get('code')?.trim()) throw new Error('This sign-in link is incomplete. Request a new link from the app.')

  // Initialization reports failed automatic PKCE exchanges even when Auth
  // intentionally keeps an unrelated cached session. Never mistake that
  // retained session for a successful expired email action.
  const initialization = await supabase.auth.initialize()
  if (initialization.error) throw initialization.error
  const code = new URL(window.location.href).searchParams.get('code')
  if (code) {
    const exchangeResult = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeResult.error) throw exchangeResult.error
    if (exchangeResult.data.session) return exchangeResult.data.session
    throw new Error('This sign-in link could not be completed. Request a new link from the app.')
  }

  const sessionResult = await supabase.auth.getSession()
  if (sessionResult.error) throw sessionResult.error
  if (sessionResult.data.session) return sessionResult.data.session

  throw new Error('This sign-in link could not be completed. Open the email link on the same device and browser where you requested it, or return to sign in and request a new link.')
}

export function pendingSocialProvider(): SocialProvider | null {
  const value = window.localStorage.getItem(OAUTH_PROVIDER_KEY)
  return value === 'google' || value === 'facebook' ? value : null
}

export function isRecentlyCreatedSocialAccount(session: Session): boolean {
  const provider = session.user.app_metadata?.provider
  const pendingProvider = pendingSocialProvider()
  const createdAt = Date.parse(session.user.created_at)
  const startedAt = Number(window.localStorage.getItem(OAUTH_STARTED_AT_KEY))
  const now = Date.now()

  return (
    (provider === 'google' || provider === 'facebook')
    && provider === pendingProvider
    && Number.isFinite(createdAt)
    && now - createdAt >= 0
    && now - createdAt <= NEW_ACCOUNT_WINDOW_MS
    && Number.isFinite(startedAt)
    && now - startedAt >= 0
    && now - startedAt <= NEW_ACCOUNT_WINDOW_MS
  )
}

export function clearOAuthAttempt(): void {
  window.localStorage.removeItem(OAUTH_PROVIDER_KEY)
  window.localStorage.removeItem(OAUTH_STARTED_AT_KEY)
}
