import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(), maybeSingle: vi.fn(), beforeEach: vi.fn(),
  initializeSession: vi.fn(), passwordRecovery: { value: false },
}))
vi.mock('@ionic/vue-router', () => ({
  createWebHistory: vi.fn(),
  createRouter: () => ({ beforeEach: mocks.beforeEach }),
}))
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: mocks.getSession },
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }) }),
} }))
vi.mock('@/composables/useSession', () => ({
  readAccountProfile: () => mocks.maybeSingle(),
  useSession: () => ({ initializeSession: mocks.initializeSession, passwordRecovery: mocks.passwordRecovery }),
}))

let guard: (to: { path: string; meta: Record<string, unknown> }) => Promise<unknown>
beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  mocks.passwordRecovery.value = false
  mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } })
  mocks.initializeSession.mockResolvedValue(undefined)
  mocks.maybeSingle.mockResolvedValue({ data: { role: 'student', onboarding_completed_at: '2026-10-24' }, error: null })
  await import('@/router')
  guard = mocks.beforeEach.mock.calls[0][0]
})

describe('provider-neutral role routing', () => {
  it.each(['/privacy-policy', '/data-deletion'])('keeps %s accessible without Auth, profile, onboarding, or recovery checks', async path => {
    mocks.passwordRecovery.value = true
    mocks.getSession.mockRejectedValue(new Error('Auth unavailable'))
    expect(await guard({ path, meta: { public: true } })).toBe(true)
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.initializeSession).not.toHaveBeenCalled()
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })
  it('leaves the auth callback free to finish exchanging its code', async () => {
    expect(await guard({ path: '/auth/callback', meta: { public: true } })).toBe(true)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('protects portal pages from signed-out visitors', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } })
    expect(await guard({ path: '/teacher', meta: { roles: ['teacher'] } })).toBe('/login')
    expect(await guard({ path: '/login', meta: { public: true } })).toBe(true)
  })

  it('requires shared onboarding for unfinished email and social accounts', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'student', onboarding_completed_at: null }, error: null })
    expect(await guard({ path: '/student', meta: { roles: ['student'] } })).toBe('/account/setup')
    expect(await guard({ path: '/account/setup', meta: {} })).toBe(true)
  })

  it.each(['student', 'teacher', 'parent', 'admin'] as const)('routes a completed %s account to its own portal', async (role) => {
    mocks.maybeSingle.mockResolvedValue({ data: { role, onboarding_completed_at: '2026-10-24' }, error: null })
    expect(await guard({ path: '/login', meta: { public: true } })).toBe(`/${role}`)
    expect(await guard({ path: `/${role}`, meta: { roles: [role] } })).toBe(true)
  })

  it('redirects a user away from another role’s portal', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { role: 'parent', onboarding_completed_at: '2026-10-24' }, error: null })
    expect(await guard({ path: '/admin', meta: { roles: ['admin'] } })).toBe('/parent')
  })

  it('keeps password recovery ahead of onboarding and role redirects', async () => {
    mocks.passwordRecovery.value = true
    expect(await guard({ path: '/login', meta: { public: true } })).toBe('/account/recover')
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
    expect(await guard({ path: '/account/recover', meta: {} })).toBe(true)
  })

  it('does not invent a student role when profile loading fails', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'Network failed' } })
    expect(await guard({ path: '/teacher', meta: { roles: ['teacher'] } })).toBe('/account/setup')
  })
})
