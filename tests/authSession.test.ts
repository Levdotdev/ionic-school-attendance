import type { Session } from '@supabase/supabase-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  maybeSingle: vi.fn(),
  unregister: vi.fn(),
  cancelReminders: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: mocks.getSession, onAuthStateChange: mocks.onAuthStateChange, signOut: mocks.signOut },
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
  mocks.signOut.mockResolvedValue({ error: null })
  mocks.maybeSingle.mockResolvedValue({ data: {
    id: 'user-1', role: 'teacher', full_name: 'Sample Teacher', email: 'user-1@example.com',
    teacher_approval_status: 'pending', onboarding_completed_at: '2026-10-24T00:00:00Z',
  }, error: null })
  mocks.unregister.mockResolvedValue(undefined)
  mocks.cancelReminders.mockResolvedValue(undefined)
})

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

  it('clears stale local credentials when the server session is already gone', async () => {
    mocks.signOut.mockResolvedValueOnce({ error: { code: 'session_not_found', status: 403 } }).mockResolvedValueOnce({ error: null })
    const { initializeSession, signOut, useSession } = await import('@/composables/useSession')
    await initializeSession(); await signOut()
    expect(mocks.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' })
    expect(useSession().session.value).toBeNull()
  })

  it('does not claim sign-out succeeded when a real network error remains', async () => {
    const error = { code: 'unexpected_failure', message: 'Network failure' }
    mocks.signOut.mockResolvedValueOnce({ error })
    const { initializeSession, signOut, useSession } = await import('@/composables/useSession')
    await initializeSession()
    await expect(signOut()).rejects.toEqual(error)
    expect(useSession().session.value).not.toBeNull()
  })
})
