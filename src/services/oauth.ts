import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import type { Session } from '@supabase/supabase-js'

import { supabase } from '@/lib/supabase'

export type SocialProvider = 'google' | 'facebook'

const OAUTH_PROVIDER_KEY = 'minsu-oauth-provider'
const OAUTH_STARTED_AT_KEY = 'minsu-oauth-started-at'
const NEW_ACCOUNT_WINDOW_MS = 5 * 60 * 1000
const NATIVE_CALLBACK_URL = 'edu.minsu.attendance://auth/callback'

let nativeCallbackInstalled = false

export function oauthRedirectUrl(): string {
  if (Capacitor.isNativePlatform()) return NATIVE_CALLBACK_URL
  return new URL('/auth/callback', window.location.origin).toString()
}

export async function beginSocialSignIn(provider: SocialProvider): Promise<void> {
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

function nativeCallbackPath(value: string): string | null {
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
export async function initializeNativeOAuthCallback(): Promise<void> {
  if (!Capacitor.isNativePlatform() || nativeCallbackInstalled) return
  nativeCallbackInstalled = true

  const continueInApp = async (value: string) => {
    const path = nativeCallbackPath(value)
    if (!path) return

    await Browser.close().catch(() => undefined)
    window.location.assign(path)
  }

  await App.addListener('appUrlOpen', ({ url }) => {
    void continueInApp(url)
  })

  const launchUrl = await App.getLaunchUrl()
  if (launchUrl?.url) await continueInApp(launchUrl.url)
}

/**
 * The Supabase client automatically detects PKCE grants in the URL. The
 * explicit exchange is a safe fallback for environments where initialization
 * has not processed the callback yet.
 */
export async function completeSocialSignIn(): Promise<Session> {
  const callbackUrl = new URL(window.location.href)
  const providerError = callbackUrl.searchParams.get('error_description')
    ?? callbackUrl.searchParams.get('error')

  if (providerError) {
    throw new Error(providerError.replaceAll('+', ' '))
  }

  const sessionResult = await supabase.auth.getSession()
  if (sessionResult.error) throw sessionResult.error
  if (sessionResult.data.session) return sessionResult.data.session

  const code = callbackUrl.searchParams.get('code')
  if (code) {
    const exchangeResult = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeResult.error) throw exchangeResult.error
    if (exchangeResult.data.session) return exchangeResult.data.session
  }

  throw new Error('The social sign-in could not be completed. Please return to sign in and try again.')
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
