import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const mocks = vi.hoisted(() => ({ refreshAuthUser: vi.fn(), signOut: vi.fn(), replace: vi.fn(), toggleTheme: vi.fn() }))
const profile = ref({ full_name: 'Lance Brito', role: 'student' })
const user = ref({ id: 'user-1', email: 'lance@example.com', identities: [{ provider: 'email' }, { provider: 'google' }, { provider: 'facebook' }] })
vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    IonButton: defineComponent({ props: ['disabled'], setup: (props, { slots }) => () => h('button', { disabled: props.disabled }, slots.default?.()) }),
    IonIcon: defineComponent({ render: () => null }),
    IonPopover: defineComponent({ props: ['isOpen'], setup: (props, { slots }) => () => props.isOpen ? h('aside', slots.default?.()) : null }),
  }
})
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ user, profile, refreshAuthUser: mocks.refreshAuthUser, signOut: mocks.signOut }) }))
vi.mock('@/composables/useProfileAvatar', async () => { const { ref } = await import('vue'); return { useProfileAvatar: () => ({ avatarUrl: ref(''), initials: ref('LB') }) } })
vi.mock('@/composables/useTheme', async () => { const { ref } = await import('vue'); return { useTheme: () => ({ isDark: ref(false), toggleTheme: mocks.toggleTheme }) } })
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace }), useRoute: () => ({ path: '/student', query: {} }) }))
vi.mock('@/components/AccountSettingsModal.vue', async () => { const { defineComponent, h } = await import('vue'); return { default: defineComponent({ props: ['open'], setup: props => () => props.open ? h('section', 'Account settings dialog') : null }) } })
vi.mock('@/components/SecurityModal.vue', async () => { const { defineComponent, h } = await import('vue'); return { default: defineComponent({ props: ['open'], setup: props => () => props.open ? h('section', 'Security dialog') : null }) } })
vi.mock('@/components/AppModal.vue', async () => { const { defineComponent, h } = await import('vue'); return { default: defineComponent({ props: ['open', 'title'], setup: (props, { slots }) => () => props.open ? h('section', [h('h2', String(props.title)), slots.default?.(), slots.actions?.()]) : null }) } })
vi.mock('@/lib/supabase', () => ({ supabase: {} }))
vi.mock('@/services/oauth', () => ({ oauthRedirectUrl: () => '' }))

import ProfileMenu from '@/components/ProfileMenu.vue'

beforeEach(() => { vi.clearAllMocks(); mocks.refreshAuthUser.mockResolvedValue(user.value); mocks.signOut.mockResolvedValue(undefined); profile.value.role = 'student' })

describe('shared profile menu', () => {
  it.each(['student', 'teacher', 'parent', 'admin'])('shows the %s role and every linked method', async role => {
    profile.value.role = role
    const wrapper = mount(ProfileMenu)
    await wrapper.find('[aria-label="Open your profile menu"]').trigger('click'); await flushPromises()
    expect(mocks.refreshAuthUser).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain(role === 'admin' ? 'Administrator' : role.charAt(0).toUpperCase() + role.slice(1))
    expect(wrapper.text()).toContain('EmailGoogleFacebook')
    expect(wrapper.text()).toContain('Profile')
    expect(wrapper.text()).toContain('Security')
    expect(wrapper.text()).not.toContain('Change email')
    expect(wrapper.text()).not.toContain('Change password')
    wrapper.unmount()
  })
  it('places a working theme toggle beside the profile control', async () => {
    const wrapper = mount(ProfileMenu)
    const controls = wrapper.find('.profile-controls')
    expect(controls.findAll('button')).toHaveLength(2)
    await controls.find('[aria-label="Switch to dark mode"]').trigger('click')
    expect(mocks.toggleTheme).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('opens a matching security dialog from the dropdown', async () => {
    const wrapper = mount(ProfileMenu)
    await wrapper.find('[aria-label="Open your profile menu"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Security')!.trigger('click')
    expect(wrapper.text()).toContain('Security dialog')
    expect(wrapper.find('aside').exists()).toBe(false)
    wrapper.unmount()
  })
  it('uses parent-specific sign-out copy without claiming parents have tasks', async () => {
    profile.value.role = 'parent'
    const wrapper = mount(ProfileMenu)
    await wrapper.find('[aria-label="Open your profile menu"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Sign out')!.trigger('click')
    expect(wrapper.text()).toContain('Your child’s attendance history')
    expect(wrapper.text()).not.toContain('and tasks')
    wrapper.unmount()
  })
  it('confirms sign-out in a dialog, then clears the session before returning to login', async () => {
    const wrapper = mount(ProfileMenu)
    await wrapper.find('[aria-label="Open your profile menu"]').trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Sign out')!.trigger('click')
    expect(mocks.signOut).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Sign out of your account?')
    await wrapper.findAll('button').find(button => button.text() === 'Sign out')!.trigger('click'); await flushPromises()
    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(mocks.replace).toHaveBeenCalledWith('/login')
    wrapper.unmount()
  })
})
