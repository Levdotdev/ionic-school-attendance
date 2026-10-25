import type { Session } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  maybeSingle: vi.fn(),
  unregister: vi.fn(),
  cancelReminders: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: mocks.getSession, getUser: mocks.getUser, onAuthStateChange: mocks.onAuthStateChange, signOut: mocks.signOut },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
} }))
vi.mock('@/services/notifications', () => ({ unregisterFromClassNotifications: mocks.unregister }))
vi.mock('@/services/studentTaskReminders', () => ({ cancelStudentTaskReminders: mocks.cancelReminders }))

function session(id = 'user-1'): Session {
  return { user: { id, email: `${id}@example.com` } } as Session
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  window.sessionStorage.clear()
  mocks.getSession.mockResolvedValue({ data: { session: session() }, error: null })
  mocks.getUser.mockResolvedValue({ data: { user: session().user }, error: null })
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.maybeSingle.mockResolvedValue({ data: {
    id: 'user-1', role: 'teacher', full_name: 'Sample Teacher', email: 'user-1@example.com',
    teacher_approval_status: 'pending', onboarding_completed_at: '2026-10-24T00:00:00Z',
  }, error: null })
  mocks.unregister.mockResolvedValue(undefined)
  mocks.cancelReminders.mockResolvedValue(undefined)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

describe('account destinations', () => {
  it.each(['student', 'teacher', 'parent', 'admin'] as const)('sends completed %s accounts to their own portal', async (role) => {
    const { accountPathForProfile } = await import('@/composables/useSession')
    expect(accountPathForProfile({ role, onboarding_completed_at: '2026-10-24T00:00:00Z' })).toBe(`/${role}`)
  })

  it('sends an unfinished account to shared setup regardless of its authentication provider', async () => {
    const { accountPathForProfile } = await import('@/composables/useSession')
    expect(accountPathForProfile({ role: 'student', onboarding_completed_at: null })).toBe('/account/setup')
  })
})

describe('session recovery and cleanup', () => {
  it('finishes the current profile when the SDK initial-session event races initialization', async () => {
    vi.useFakeTimers()
    const restored = deferred<unknown>()
    mocks.getSession.mockReturnValueOnce(restored.promise)
    const state = await import('@/composables/useSession')
    const ready = state.initializeSession()
    mocks.onAuthStateChange.mock.calls[0][0]('INITIAL_SESSION', session())
    restored.resolve({ data: { session: session() }, error: null })
    await ready
    expect(state.useSession().user.value?.id).toBe('user-1')
    expect(state.useSession().profile.value?.id).toBe('user-1')
  })
  it.each(['google', 'facebook', 'email'])('does not restore a removed %s method from stale token or cross-tab events', async provider => {
    vi.useFakeTimers()
    const cached = { ...session(), user: { ...session().user, identities: [{ provider }, { provider: 'another-method' }] } }
    mocks.getSession.mockResolvedValue({ data: { session: cached }, error: null })
    mocks.getUser.mockResolvedValue({ data: { user: { ...cached.user, identities: [{ provider: 'another-method' }] } }, error: null })
    const state = await import('@/composables/useSession')
    await state.initializeSession()
    const listener = mocks.onAuthStateChange.mock.calls[0][0]
    listener('TOKEN_REFRESHED', cached)
    expect(state.useSession().user.value?.identities?.some(identity => identity.provider === provider)).toBe(false)
    listener('SIGNED_IN', cached)
    expect(state.useSession().user.value?.identities?.some(identity => identity.provider === provider)).toBe(false)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.useSession().user.value?.identities?.some(identity => identity.provider === provider)).toBe(false)
  })
  it('uses the authoritative current email and does not restore the old email from a token event', async () => {
    vi.useFakeTimers()
    mocks.getUser.mockResolvedValue({ data: { user: { ...session().user, email: 'new@example.com' } }, error: null })
    const state = await import('@/composables/useSession')
    await state.initializeSession()
    mocks.onAuthStateChange.mock.calls[0][0]('TOKEN_REFRESHED', session())
    expect(state.useSession().user.value?.email).toBe('new@example.com')
    expect(state.useSession().profile.value?.email).toBe('new@example.com')
    await vi.advanceTimersByTimeAsync(0)
    expect(state.useSession().profile.value?.email).toBe('new@example.com')
  })
  it('rejects out-of-order Auth responses after a more recent identity update', async () => {
    const state = await import('@/composables/useSession')
    await state.initializeSession()
    const old = deferred<unknown>(), latest = deferred<unknown>()
    mocks.getUser.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise)
    const first = state.refreshAuthUser(), second = state.refreshAuthUser({ force: true })
    latest.resolve({ data: { user: { ...session().user, identities: [] } }, error: null })
    await second
    old.resolve({ data: { user: { ...session().user, identities: [{ provider: 'google' }] } }, error: null })
    await first
    expect(state.useSession().user.value?.identities).toEqual([])
  })
  it('shares a pending profile read instead of returning a false missing-profile result', async () => {
    const state = await import('@/composables/useSession')
    await state.initializeSession()
    const response = deferred<unknown>()
    mocks.maybeSingle.mockReturnValueOnce(response.promise)
    const first = state.refreshProfile(), background = state.refreshProfile()
    expect(first).toBe(background)
    response.resolve({ data: { id: 'user-1', role: 'teacher', full_name: 'Teacher One', onboarding_completed_at: '2026-10-25' }, error: null })
    expect((await first)?.role).toBe('teacher')
    expect((await background)?.role).toBe('teacher')
  })
  it('lets an earlier caller await a newer post-save profile rather than reporting null', async () => {
    const state = await import('@/composables/useSession')
    await state.initializeSession()
    const old = deferred<unknown>(), updated = deferred<unknown>()
    mocks.maybeSingle.mockReturnValueOnce(old.promise).mockReturnValueOnce(updated.promise)
    const entering = state.refreshProfile(), saved = state.refreshProfile({ force: true })
    old.resolve({ data: { id: 'user-1', role: 'student', full_name: 'Old Setup', onboarding_completed_at: null }, error: null })
    updated.resolve({ data: { id: 'user-1', role: 'parent', full_name: 'Parent One', onboarding_completed_at: '2026-10-25' }, error: null })
    expect((await entering)?.role).toBe('parent')
    expect((await saved)?.onboarding_completed_at).toBe('2026-10-25')
  })
  it.each(['student', 'teacher', 'parent', 'admin'])('completes a %s login after an anonymous initialization without relying on an Auth event', async role => {
    mocks.getSession.mockResolvedValueOnce({ data: { session: null }, error: null })
    const state = await import('@/composables/useSession')
    await state.initializeSession()
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'user-1', role, full_name: 'Account One', onboarding_completed_at: '2026-10-25' }, error: null })
    expect((await state.completeAuthentication(session()))?.role).toBe(role)
    expect(state.useSession().user.value?.id).toBe('user-1')
    expect(state.useSession().session.value?.user.id).toBe('user-1')
  })
  it('does not restore a signed-out session from an unfinished initialization or profile fetch', async () => {
    const cached = deferred<unknown>()
    mocks.getSession.mockReturnValueOnce(cached.promise)
    const state = await import('@/composables/useSession')
    const pending = state.initializeSession()
    await state.signOut()
    cached.resolve({ data: { session: session() }, error: null })
    await pending
    expect(state.useSession().user.value).toBeNull()
    expect(state.useSession().profile.value).toBeNull()
    mocks.getSession.mockResolvedValue({ data: { session: session() }, error: null })
    await state.initializeSession()
    const profile = deferred<unknown>()
    mocks.maybeSingle.mockReturnValueOnce(profile.promise)
    const loading = state.refreshProfile()
    await state.signOut()
    profile.resolve({ data: { id: 'user-1', role: 'student', full_name: 'Old account' }, error: null })
    await loading
    expect(state.useSession().user.value).toBeNull()
    expect(state.useSession().profile.value).toBeNull()
  })
  it('reinitializes the next incomplete account after signing out instead of reusing the old initialization', async () => {
    const state = await import('@/composables/useSession')
    await state.initializeSession(); await state.signOut()
    mocks.getSession.mockResolvedValue({ data: { session: session('user-2') }, error: null })
    mocks.getUser.mockResolvedValue({ data: { user: session('user-2').user }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'user-2', role: 'student', full_name: 'New Person', onboarding_completed_at: null }, error: null })
    await state.initializeSession()
    expect(state.useSession().user.value?.id).toBe('user-2')
    expect(state.useSession().profile.value?.id).toBe('user-2')
    expect(state.useSession().profile.value?.onboarding_completed_at).toBeNull()
  })
  it('supports existing profiles until the onboarding migration has been deployed', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column profiles.onboarding_completed_at does not exist' } })
    mocks.maybeSingle.mockResolvedValueOnce({ data: { id: 'user-1', role: 'teacher', created_at: '2026-10-01' }, error: null })
    const { readAccountProfile } = await import('@/composables/useSession')
    const result = await readAccountProfile('user-1')
    expect(result.data?.onboarding_completed_at).toBe('2026-10-01')
    expect(mocks.maybeSingle).toHaveBeenCalledTimes(2)
  })

  it('does not bypass unrelated profile errors with the legacy fallback', async () => {
    mocks.maybeSingle.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } })
    const { readAccountProfile } = await import('@/composables/useSession')
    const result = await readAccountProfile('user-1')
    expect(result.error?.code).toBe('42501')
    expect(mocks.maybeSingle).toHaveBeenCalledOnce()
  })

  it('keeps password recovery active after reload and clears it when finished', async () => {
    let state = await import('@/composables/useSession')
    const listener = mocks.onAuthStateChange.mock.calls[0][0]
    listener('PASSWORD_RECOVERY', session())
    expect(state.useSession().passwordRecovery.value).toBe(true)
    await state.initializeSession()
    vi.resetModules()
    state = await import('@/composables/useSession')
    await state.initializeSession()
    expect(state.useSession().passwordRecovery.value).toBe(true)
    state.useSession().finishPasswordRecovery()
    expect(state.useSession().passwordRecovery.value).toBe(false)
    expect(window.sessionStorage.getItem('minsu-password-recovery-user')).toBeNull()
  })

  it('does not carry recovery or the previous profile into another account', async () => {
    const state = await import('@/composables/useSession')
    await state.initializeSession()
    const listener = mocks.onAuthStateChange.mock.calls[0][0]
    listener('PASSWORD_RECOVERY', session())
    listener('SIGNED_IN', session('user-2'))
    expect(state.useSession().passwordRecovery.value).toBe(false)
    expect(state.useSession().profile.value).toBeNull()
  })

  it('removes class token and local task reminders before clearing the session', async () => {
    const { initializeSession, signOut, useSession } = await import('@/composables/useSession')
    await initializeSession()
    await signOut()
    expect(mocks.unregister).toHaveBeenCalledOnce()
    expect(mocks.cancelReminders).toHaveBeenCalledOnce()
    expect(mocks.cancelReminders.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0])
    expect(useSession().session.value).toBeNull()
    expect(useSession().profile.value).toBeNull()
  })

  it('still signs out if native notification cleanup is unavailable', async () => {
    mocks.cancelReminders.mockRejectedValue(new Error('Notifications unavailable'))
    const { signOut } = await import('@/composables/useSession')
    await expect(signOut()).resolves.toBeUndefined()
    expect(mocks.signOut).toHaveBeenCalledOnce()
  })
  it('does not trap logout on a notification task that never settles', async () => {
    vi.useFakeTimers()
    mocks.unregister.mockReturnValue(new Promise(() => undefined))
    const state = await import('@/composables/useSession')
    await state.initializeSession()
    const first = state.signOut(), duplicate = state.signOut()
    expect(first).toBe(duplicate)
    await vi.advanceTimersByTimeAsync(2000)
    await first
    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(state.useSession().user.value).toBeNull()
    expect(state.useSession().signOutNotice.value).toContain('Some device reminders could not be cleared')
    mocks.unregister.mockResolvedValue(undefined)
  })

  it('clears stale local credentials when the server session is already gone', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: { code: 'session_not_found', status: 403 } }).mockResolvedValueOnce({ error: null })
    const { initializeSession, signOut, useSession } = await import('@/composables/useSession')
    await initializeSession(); await signOut()
    expect(mocks.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' })
    expect(useSession().session.value).toBeNull()
  })

  it('leaves setup after clearing this device even if global sign-out fails, with honest device-only notice', async () => {
    const error = { code: 'unexpected_failure', message: 'Network failure' }
    mocks.signOut.mockResolvedValueOnce({ error })
    const { initializeSession, signOut, useSession } = await import('@/composables/useSession')
    await initializeSession()
    await expect(signOut()).resolves.toBeUndefined()
    expect(mocks.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' })
    expect(useSession().session.value).toBeNull()
    expect(useSession().signOutNotice.value).toContain('Signed out on this device')
  })
})
