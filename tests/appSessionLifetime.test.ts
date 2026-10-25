import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ outletMounts: 0, replace: vi.fn(), signOut: vi.fn() }))
const user = ref<{ id: string } | null>(null)
const profile = ref<{ id: string; role: string; onboarding_completed_at: string | null } | null>(null)
const route = reactive({ path: '/login' })
vi.mock('@ionic/vue', async () => {
  const { defineComponent, h, onMounted } = await import('vue')
  return {
    IonApp: defineComponent({ setup: (_, { slots }) => () => h('main', slots.default?.()) }),
    IonRouterOutlet: defineComponent({ setup() { onMounted(() => { mocks.outletMounts++ }); return () => h('div', { 'data-outlet': true }) } }),
  }
})
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn(), replace: mocks.replace }) }))
vi.mock('@/components/AppMenu.vue', () => ({ default: defineComponent({ render: () => h('nav') }) }))
vi.mock('@/composables/useSession', () => ({ accountPathForProfile: (account: { role: string; onboarding_completed_at: string | null }) => account.onboarding_completed_at ? `/${account.role}` : '/account/setup', useSession: () => ({ user, profile, initializeSession: async () => undefined, refreshProfile: vi.fn(), refreshAuthUser: vi.fn(), signOut: mocks.signOut }) }))
vi.mock('@/composables/useNavigation', () => ({ useNavigation: () => ({ collapsed: ref(false) }) }))
vi.mock('@/composables/useRealtimeRefresh', () => ({ useRealtimeRefresh: vi.fn() }))
vi.mock('@/services/studentTasks', () => ({ loadStudentTaskData: vi.fn() }))
vi.mock('@/services/studentTaskReminders', () => ({ isNativeTaskReminders: () => false, listenForStudentTaskReminderActions: async () => vi.fn(), syncStudentTaskReminders: vi.fn() }))
vi.mock('@/services/oauth', () => ({ initializeNativeOAuthCallback: async () => undefined }))
vi.mock('@/services/notifications', () => ({ listenForClassNotificationActions: async () => vi.fn(), registerForClassNotifications: async () => undefined }))
import App from '@/App.vue'

beforeEach(() => {
  mocks.outletMounts = 0; mocks.replace.mockReset(); user.value = null; profile.value = null; route.path = '/login'
  mocks.replace.mockImplementation(async (path: string) => { route.path = path })
  mocks.signOut.mockReset(); mocks.signOut.mockImplementation(async () => { user.value = null })
})
describe('Ionic outlet account lifetime', () => {
  it('keeps sign-out recoverable while the new account profile is unavailable', async () => {
    user.value = { id: 'account-a' }; profile.value = { id: 'account-a', role: 'student', onboarding_completed_at: '2026-10-25' }; route.path = '/student'
    const wrapper = mount(App); await flushPromises()
    user.value = { id: 'account-b' }; profile.value = null; await flushPromises()
    mocks.signOut.mockRejectedValueOnce(new Error('Device sign-out is temporarily unavailable.'))
    await wrapper.get('.account-switch-status button').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Device sign-out is temporarily unavailable')
    expect(wrapper.get('.account-switch-status button').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('#portal-content').attributes('style')).toContain('display: none')
    await wrapper.get('.account-switch-status button').trigger('click'); await flushPromises()
    expect(mocks.signOut).toHaveBeenCalledTimes(2)
    expect(mocks.replace).toHaveBeenCalledWith('/login')
    expect(route.path).toBe('/login')
    expect(wrapper.find('.account-switch-status').exists()).toBe(false)
    wrapper.unmount()
  })
  it('defers an account switch cache reset until its active callback reaches the new portal', async () => {
    user.value = { id: 'account-a' }; profile.value = { id: 'account-a', role: 'student', onboarding_completed_at: '2026-10-25' }; route.path = '/student'
    const wrapper = mount(App); await flushPromises()
    route.path = '/auth/callback'; user.value = { id: 'account-b' }; profile.value = null
    await flushPromises()
    profile.value = { id: 'account-b', role: 'parent', onboarding_completed_at: '2026-10-25' }; await flushPromises()
    expect(mocks.outletMounts).toBe(1)
    expect(mocks.replace).not.toHaveBeenCalled()
    route.path = '/parent'; await flushPromises()
    expect(mocks.outletMounts).toBe(2)
    profile.value = { ...profile.value }; await flushPromises()
    expect(mocks.outletMounts).toBe(2)
    wrapper.unmount()
  })
  it('hides the previous private page while an external account switch loads and routes to its own role', async () => {
    user.value = { id: 'account-a' }; profile.value = { id: 'account-a', role: 'student', onboarding_completed_at: '2026-10-25' }; route.path = '/student'
    const wrapper = mount(App); await flushPromises()
    user.value = { id: 'account-b' }; profile.value = null; await flushPromises()
    expect(wrapper.get('#portal-content').attributes('style')).toContain('display: none')
    expect(wrapper.text()).toContain('Opening your account')
    expect(mocks.outletMounts).toBe(1)
    profile.value = { id: 'account-b', role: 'parent', onboarding_completed_at: '2026-10-25' }; await flushPromises()
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('/parent')
    expect(mocks.outletMounts).toBe(2)
    expect(wrapper.get('#portal-content').attributes('style')).not.toContain('display: none')
    wrapper.unmount()
  })
  it('keeps the outlet alive through Auth events and clears private cached pages after login navigation commits', async () => {
    const wrapper = mount(App)
    await flushPromises()
    expect(mocks.outletMounts).toBe(1)
    user.value = { id: 'first-account' }
    await flushPromises()
    expect(mocks.outletMounts).toBe(1)
    route.path = '/account/setup'; await flushPromises()
    user.value = null; await flushPromises()
    expect(mocks.outletMounts).toBe(1)
    route.path = '/login'; await flushPromises()
    expect(mocks.outletMounts).toBe(2)
    user.value = { id: 'next-account' }; await flushPromises()
    expect(mocks.outletMounts).toBe(2)
    wrapper.unmount()
  })
})
