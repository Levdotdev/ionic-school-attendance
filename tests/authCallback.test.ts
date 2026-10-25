import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ replace: vi.fn(), complete: vi.fn(), completeLink: vi.fn(), pending: vi.fn(), clear: vi.fn(), clearLink: vi.fn(), initialize: vi.fn(), refresh: vi.fn(), refreshAuth: vi.fn(), signOut: vi.fn() }))
const recovery = ref(false)
vi.mock('/minsu-logo.png', () => ({ default: '/minsu-logo.png' }))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  const element = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  return { IonPage: element, IonContent: element, IonSpinner: element, IonIcon: element, IonButton: defineComponent({ setup: (_, { slots }) => () => h('button', slots.default?.()) }) }
})
vi.mock('@/composables/useSession', () => ({
  accountPathForProfile: (value: { role: string }) => `/${value.role}`,
  useSession: () => ({ completeAuthentication: mocks.initialize, refreshProfile: mocks.refresh, refreshAuthUser: mocks.refreshAuth, passwordRecovery: recovery, signOut: mocks.signOut }),
}))
vi.mock('@/services/oauth', () => ({ clearOAuthAttempt: mocks.clear, clearIdentityLinkAttempt: mocks.clearLink, completeSocialSignIn: mocks.complete, completeIdentityLink: mocks.completeLink, pendingIdentityLink: mocks.pending }))
import AuthCallbackPage from '@/views/AuthCallbackPage.vue'

beforeEach(() => {
  vi.clearAllMocks(); recovery.value = false
  window.history.replaceState({}, '', '/auth/callback')
  mocks.complete.mockResolvedValue({ user: { id: 'user-1' } }); mocks.initialize.mockResolvedValue(undefined)
  mocks.pending.mockReturnValue(null); mocks.refresh.mockResolvedValue({ role: 'parent' }); mocks.refreshAuth.mockResolvedValue({ id: 'user-1' })
  mocks.completeLink.mockResolvedValue('/parent?account=security&linked=google'); mocks.replace.mockResolvedValue(undefined)
})

describe('authentication callback destinations', () => {
  it('shows partial email-change acceptance without claiming the address changed or hijacking a prior link attempt', async () => {
    window.history.replaceState({}, '', '/auth/callback?token_hash=first-mailbox&type=email_change')
    mocks.pending.mockReturnValue({ userId: 'user-1' })
    mocks.complete.mockResolvedValue({ emailChangeConfirmationPending: true })
    const wrapper = mount(AuthCallbackPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Confirm your other email address')
    expect(wrapper.text()).toContain('Your email has not changed yet')
    expect(wrapper.text()).toContain('30 minutes of the original request')
    expect(mocks.replace).not.toHaveBeenCalled()
    expect(mocks.completeLink).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('does not let a stale provider-link attempt hijack a verified email action', async () => {
    window.history.replaceState({}, '', '/auth/callback?token_hash=confirmed-mailbox&type=email_change')
    mocks.pending.mockReturnValue({ userId: 'user-1' })
    const wrapper = mount(AuthCallbackPage)
    await flushPromises()
    expect(mocks.completeLink).not.toHaveBeenCalled()
    expect(mocks.refresh).toHaveBeenCalledOnce()
    expect(mocks.replace).toHaveBeenCalledWith('/parent')
    wrapper.unmount()
  })
  it('returns successful provider linking to Security instead of starting a new onboarding flow', async () => {
    mocks.pending.mockReturnValue({ userId: 'user-1' })
    const wrapper = mount(AuthCallbackPage)
    await flushPromises()
    expect(mocks.completeLink).toHaveBeenCalledOnce()
    expect(mocks.refreshAuth).toHaveBeenCalledOnce()
    expect(mocks.replace).toHaveBeenCalledWith('/parent?account=security&linked=google')
    expect(mocks.refresh).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('prioritizes a verified recovery event over a previous unfinished linking attempt', async () => {
    mocks.pending.mockReturnValue({ userId: 'user-1' }); recovery.value = true
    const wrapper = mount(AuthCallbackPage)
    await flushPromises()
    expect(mocks.completeLink).not.toHaveBeenCalled()
    expect(mocks.clearLink).toHaveBeenCalledOnce()
    expect(mocks.replace).toHaveBeenCalledWith('/account/recover')
    wrapper.unmount()
  })
  it('shows linking errors without signing out the currently signed-in account', async () => {
    mocks.pending.mockReturnValue({ userId: 'user-1' }); mocks.completeLink.mockRejectedValue(new Error('Provider was not linked'))
    const wrapper = mount(AuthCallbackPage)
    await flushPromises()
    expect(wrapper.text()).toContain('Account was not linked')
    expect(wrapper.text()).toContain('Provider was not linked')
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
