import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), link: vi.fn(), unlink: vi.fn() }))
const user = ref({ id: 'user-1', email: 'user@example.com', new_email: undefined as string | undefined, email_change_sent_at: undefined as string | undefined, identities: [{ id: 'email-id', provider: 'email', identity_data: {} }, { id: 'google-id', provider: 'google', identity_data: { email: 'user@gmail.com' } }] })
const profile = ref({ role: 'student' })
vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    IonButton: defineComponent({ props: ['disabled'], setup: (props, { slots }) => () => h('button', { disabled: props.disabled }, slots.default?.()) }),
    IonIcon: defineComponent({ render: () => null }),
  }
})
vi.mock('@/components/AppModal.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ props: ['open', 'title'], setup: (props, { slots }) => () => props.open ? h('section', { 'data-modal': props.title }, [h('h2', props.title), slots.default?.(), slots.actions?.()]) : null }) }
})
vi.mock('@/components/AccountChangeModal.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ props: ['open', 'kind'], emits: ['close'], setup: (props, { emit }) => () => props.open ? h('section', [`Change ${props.kind} dialog`, h('button', { onClick: () => emit('close') }, 'Back')]) : null }) }
})
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ user, profile, refreshAuthUser: mocks.refresh }) }))
vi.mock('@/services/oauth', () => ({ beginIdentityLink: mocks.link }))
vi.mock('@/services/account', () => ({ linkedAuthMethods: () => ['Email', 'Google'], authActionError: (error: Error) => error.message, unlinkAccountIdentity: mocks.unlink }))
import SecurityModal from '@/components/SecurityModal.vue'

beforeEach(() => { vi.clearAllMocks(); user.value.new_email = undefined; user.value.email_change_sent_at = undefined; mocks.refresh.mockResolvedValue(user.value); mocks.link.mockResolvedValue(undefined); mocks.unlink.mockResolvedValue(undefined) })
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('security dialog navigation', () => {
  it('distinguishes an expired email request from a pending confirmation without prompting for old links', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T01:00:00Z'))
    user.value.new_email = 'previous@example.com'; user.value.email_change_sent_at = '2026-10-24T11:02:31Z'
    const wrapper = mount(SecurityModal, { props: { open: true } })
    await flushPromises()
    expect(wrapper.text()).toContain('Previous requested address: previous@example.com')
    expect(wrapper.text()).toContain('Previous email-change link expired. Request a new link.')
    expect(wrapper.text()).not.toContain('Check both inboxes')
    expect(wrapper.text()).toContain('user@example.com')
    wrapper.unmount()
  })
  it('has separate account, email, and password actions and returns from their matching dialogs', async () => {
    const wrapper = mount(SecurityModal, { props: { open: true } })
    await flushPromises()
    expect(wrapper.find('[data-modal="Security"]').exists()).toBe(true)
    expect(wrapper.findAll('.security-setting')).toHaveLength(3)
    await wrapper.findAll('button').find(button => button.text() === 'Change email')!.trigger('click')
    expect(wrapper.text()).toContain('Change email dialog')
    expect(wrapper.find('[data-modal="Security"]').exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === 'Back')!.trigger('click')
    expect(wrapper.find('[data-modal="Security"]').exists()).toBe(true)
    expect(wrapper.emitted('close')).toBeUndefined()
    wrapper.unmount()
  })
  it('links the selected provider to the current user and never invokes normal social sign-in', async () => {
    const wrapper = mount(SecurityModal, { props: { open: true } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Manage accounts')!.trigger('click')
    expect(wrapper.text()).toContain('user@gmail.com')
    await wrapper.findAll('button').find(button => button.text() === 'Link account')!.trigger('click')
    await flushPromises()
    expect(mocks.link).toHaveBeenCalledWith('facebook', 'user-1', '/student')
    wrapper.unmount()
  })
  it('requires confirmation before removing a provider and returns to linked accounts afterwards', async () => {
    const wrapper = mount(SecurityModal, { props: { open: true } })
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Manage accounts')!.trigger('click')
    await wrapper.findAll('button').find(button => button.text() === 'Remove')!.trigger('click')
    expect(mocks.unlink).not.toHaveBeenCalled()
    expect(wrapper.find('[data-modal="Linked accounts"]').exists()).toBe(false)
    await wrapper.findAll('button').find(button => button.text() === 'Remove method')!.trigger('click')
    await flushPromises()
    expect(mocks.unlink).toHaveBeenCalledWith('google', 'user-1')
    expect(wrapper.find('[data-modal="Linked accounts"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Google was removed')
    wrapper.unmount()
  })
})
