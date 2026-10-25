import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ update: vi.fn(), single: vi.fn(), refresh: vi.fn(), refreshAuth: vi.fn(), native: false, notificationStatus: vi.fn(), capture: vi.fn(), release: vi.fn() }))
const profile = ref({ id: 'user-1', role: 'student', full_name: 'JUAN DE LA CRUZ', first_name: 'JUAN DE LA', last_name: 'CRUZ', name_review_required: true, avatar_path: null, email: 'user@example.com' })
vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    IonButton: defineComponent({ props: ['disabled', 'type'], setup: (props, { slots }) => () => h('button', { type: props.type || 'button', disabled: props.disabled }, slots.default?.()) }),
    IonInput: defineComponent({ props: ['modelValue', 'label'], emits: ['update:modelValue'], setup: (props, { emit }) => () => h('input', { 'aria-label': props.label, value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) }) }),
  }
})
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mocks.native, getPlatform: () => mocks.native ? 'android' : 'web' } }))
vi.mock('@capacitor/camera', () => ({ Camera: {}, CameraResultType: {}, CameraSource: {} }))
vi.mock('@/components/AppModal.vue', async () => { const { defineComponent, h } = await import('vue'); return { default: defineComponent({ props: ['open'], setup: (props, { slots }) => () => props.open ? h('section', slots.default?.()) : null }) } })
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ profile, refreshProfile: mocks.refresh, refreshAuthUser: mocks.refreshAuth }) }))
vi.mock('@/composables/useProfileAvatar', () => ({ useProfileAvatar: () => ({ avatarUrl: ref(''), initials: ref('JC'), onAvatarError: vi.fn() }) }))
vi.mock('@/services/account', () => ({ removeAvatar: vi.fn(), uploadAvatar: vi.fn(), validateAvatar: vi.fn() }))
vi.mock('@/services/notifications', () => ({ getDeviceNotificationStatus: mocks.notificationStatus }))
vi.mock('@/services/selfie', () => ({ captureSelfie: mocks.capture, releaseSelfiePreview: mocks.release }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ update: mocks.update }) } }))
import AccountSettingsModal from '@/components/AccountSettingsModal.vue'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.native = false
  mocks.notificationStatus.mockResolvedValue(false)
  profile.value = { id: 'user-1', role: 'student', full_name: 'JUAN DE LA CRUZ', first_name: 'JUAN DE LA', last_name: 'CRUZ', name_review_required: true, avatar_path: null, email: 'user@example.com' }
  mocks.single.mockResolvedValue({ data: { id: 'user-1' }, error: null })
  mocks.update.mockImplementation(() => ({ eq: () => ({ select: () => ({ single: mocks.single }) }) }))
  mocks.refresh.mockResolvedValue(profile.value); mocks.refreshAuth.mockResolvedValue(null)
})
describe('structured uppercase profile names', () => {
  it('allows an automatically split name to be explicitly confirmed without changing it', async () => {
    const wrapper = mount(AccountSettingsModal, { props: { open: false } })
    await wrapper.setProps({ open: true }); await flushPromises()
    expect(wrapper.get('form.name-form button').attributes('disabled')).toBeUndefined()
    await wrapper.get('form.name-form').trigger('submit'); await flushPromises()
    expect(mocks.update).toHaveBeenCalledWith({ first_name: 'JUAN DE LA', last_name: 'CRUZ' })
    wrapper.unmount()
  })
  it('lets the owner correct compound surnames and saves only structured uppercase name fields', async () => {
    const wrapper = mount(AccountSettingsModal, { props: { open: false } })
    await wrapper.setProps({ open: true }); await flushPromises()
    expect(wrapper.text()).toContain('compound last name may need correction')
    await wrapper.get('input[aria-label="First name"]').setValue('  Juan  ')
    await wrapper.get('input[aria-label="Last name"]').setValue('  de   la cruz ')
    await wrapper.get('form.name-form').trigger('submit'); await flushPromises()
    expect(mocks.update).toHaveBeenCalledWith({ first_name: 'JUAN', last_name: 'DE LA CRUZ' })
    expect(mocks.refresh).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('requires both names before submitting and keeps other case-sensitive fields unchanged', async () => {
    const wrapper = mount(AccountSettingsModal, { props: { open: false } })
    await wrapper.setProps({ open: true }); await wrapper.get('input[aria-label="Last name"]').setValue('')
    await wrapper.get('form.name-form').trigger('submit'); await flushPromises()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Enter your first and last name')
    expect(profile.value.email).toBe('user@example.com')
    wrapper.unmount()
  })
  it.each([true, false])('shows notification permission/registration as a read-only %s status', async enabled => {
    mocks.native = true
    mocks.notificationStatus.mockResolvedValue(enabled)
    const wrapper = mount(AccountSettingsModal, { props: { open: false } })
    await wrapper.setProps({ open: true }); await flushPromises()
    expect(wrapper.get('.notification-status').text()).toBe(enabled ? 'Enabled' : 'Disabled')
    expect(wrapper.findAll('.notification-settings button')).toHaveLength(0)
    expect(mocks.notificationStatus).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
})
