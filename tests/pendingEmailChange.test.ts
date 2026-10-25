import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AUTH_EMAIL_LINK_LIFETIME_SECONDS, pendingEmailChange } from '@/utils/pendingEmailChange'

const user = ref<{ id: string; email: string; new_email?: string; email_change_sent_at?: string }>({ id: 'user-1', email: 'current@example.com' })
const mocks = vi.hoisted(() => ({ refreshAuth: vi.fn(), refreshProfile: vi.fn(), changeEmail: vi.fn() }))
vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    IonSpinner: defineComponent({ render: () => null }),
    IonIcon: defineComponent({ render: () => null }),
    IonButton: defineComponent({ props: ['disabled', 'type'], setup: (props, { slots }) => () => h('button', { type: props.type || 'button', disabled: props.disabled }, slots.default?.()) }),
    IonInput: defineComponent({ props: ['modelValue', 'label'], emits: ['update:modelValue'], setup: (props, { emit }) => () => h('input', { 'aria-label': props.label, value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) }) }),
  }
})
vi.mock('@/components/AppModal.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ props: ['open'], setup: (props, { slots }) => () => props.open ? h('section', slots.default?.()) : null }) }
})
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ user, refreshAuthUser: mocks.refreshAuth, refreshProfile: mocks.refreshProfile }) }))
vi.mock('@/services/account', () => ({ authActionError: (error: Error) => error.message, changeAccountEmail: mocks.changeEmail, changeAccountPassword: vi.fn(), readAccountSecurity: async () => ({hasPassword:true}) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { reauthenticate: vi.fn() } } }))
import AccountChangeModal from '@/components/AccountChangeModal.vue'

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T01:00:00Z')); vi.clearAllMocks()
  user.value = { id: 'user-1', email: 'current@example.com' }
  mocks.refreshAuth.mockResolvedValue(user.value); mocks.refreshProfile.mockResolvedValue(null)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('30-minute email-change state', () => {
  it('matches the server lifetime and expires at the exact boundary without changing the current email', () => {
    expect(AUTH_EMAIL_LINK_LIFETIME_SECONDS).toBe(1800)
    const request = { email: 'current@example.com', new_email: 'next@example.com', email_change_sent_at: '2026-10-25T00:30:00Z' }
    expect(pendingEmailChange(request, Date.parse('2026-10-25T00:59:59.999Z')).status).toBe('pending')
    expect(pendingEmailChange(request, Date.parse('2026-10-25T01:00:00Z')).status).toBe('expired')
    expect(request.email).toBe('current@example.com')
  })
  it('does not instruct someone to check inboxes for yesterday’s expired request', async () => {
    user.value = { ...user.value, new_email: 'old-request@example.com', email_change_sent_at: '2026-10-24T01:00:00Z' }
    const wrapper = mount(AccountChangeModal, { props: { open: true, kind: 'email' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Previous email-change link expired. Request a new link.')
    expect(wrapper.text()).toContain('Previous requested address: old-request@example.com')
    expect(wrapper.text()).not.toContain('Check both inboxes')
    expect(user.value.email).toBe('current@example.com')
    wrapper.unmount()
  })
  it('expires a visible request automatically and rechecks after returning to the page', async () => {
    user.value = { ...user.value, new_email: 'next@example.com', email_change_sent_at: '2026-10-25T00:30:01Z' }
    const wrapper = mount(AccountChangeModal, { props: { open: true, kind: 'email' } })
    await flushPromises()
    expect(wrapper.text()).toContain('Check your new inbox')
    await vi.advanceTimersByTimeAsync(1000)
    expect(wrapper.text()).toContain('Previous email-change link expired')
    expect(wrapper.text()).not.toContain('Check your new inbox')
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(wrapper.text()).toContain('Previous email-change link expired')
    wrapper.unmount()
  })
  it('requires a fresh request when timestamps are missing or invalid and ignores already-confirmed addresses', () => {
    expect(pendingEmailChange({ new_email: 'next@example.com' }).status).toBe('unknown')
    expect(pendingEmailChange({ new_email: 'next@example.com', email_change_sent_at: 'invalid' }).status).toBe('unknown')
    expect(pendingEmailChange({ email: 'same@example.com', new_email: 'SAME@example.com' }).status).toBe('none')
  })
  it('requests fresh confirmation after expiry without silently changing or confirming the address', async () => {
    user.value = { ...user.value, new_email: 'old-request@example.com', email_change_sent_at: '2026-10-24T01:00:00Z' }
    mocks.changeEmail.mockImplementation(async email => { user.value = { ...user.value, new_email: email, email_change_sent_at: new Date().toISOString() }; return user.value })
    const wrapper = mount(AccountChangeModal, { props: { open: false, kind: 'email' } })
    await wrapper.setProps({ open: true }); await flushPromises()
    await wrapper.get('input[aria-label="Current password"]').setValue('Current-password!')
    await wrapper.get('input[aria-label="New email address"]').setValue('fresh@example.com')
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(mocks.changeEmail).toHaveBeenCalledWith('fresh@example.com','Current-password!','user-1')
    expect(wrapper.text()).toContain('within 30 minutes')
    expect(wrapper.text()).toContain('Check your new inbox')
    expect(wrapper.text()).not.toContain('both your current and new')
    expect(mocks.refreshAuth).toHaveBeenCalledWith({ force: true })
    expect(mocks.refreshProfile).toHaveBeenCalledWith({ force: true })
    expect(user.value.email).toBe('current@example.com')
    expect(wrapper.text()).not.toContain('Previous email-change link expired')
    wrapper.unmount()
  })
})
