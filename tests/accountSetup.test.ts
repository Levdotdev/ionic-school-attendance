import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

interface SetupProfile { id: string; email: string; role: string; full_name: string; onboarding_completed_at: string | null }
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), initialize: vi.fn(), refresh: vi.fn(), signOut: vi.fn(), replace: vi.fn(), viewEnter: [] as Array<() => Promise<void>> }))
const profile = ref<SetupProfile | null>(null)
const user = ref<{ id: string; email: string; user_metadata: Record<string, unknown> } | null>(null)

vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  const container = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  return {
    IonPage: container, IonContent: container, IonModal: container, IonHeader: container,
    IonToolbar: container, IonTitle: container, IonButtons: container,
    IonIcon: defineComponent({ render: () => null }), IonSpinner: defineComponent({ render: () => null }),
    IonButton: defineComponent({ props: ['disabled', 'type'], setup: (props, { slots }) => () => h('button', { type: props.type || 'button', disabled: props.disabled }, slots.default?.()) }),
    IonInput: defineComponent({ props: ['modelValue', 'disabled', 'label'], emits: ['update:modelValue'], setup: (props, { emit }) => () => h('input', { value: props.modelValue, disabled: props.disabled, 'aria-label': props.label, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) }) }),
    onIonViewWillEnter: (callback: () => Promise<void>) => { mocks.viewEnter.push(callback) },
  }
})
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('/minsu-logo.png', () => ({ default: '/minsu-logo.png' }))
vi.mock('@/composables/useSession', () => ({
  useSession: () => ({ profile, user, initializeSession: mocks.initialize, refreshProfile: mocks.refresh, signOut: mocks.signOut }),
  accountPathForProfile: (current: SetupProfile) => `/${current.role}`,
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
import AccountSetupPage from '@/views/AccountSetupPage.vue'

function state(wrapper: ReturnType<typeof mount>) { return (wrapper.vm as unknown as { $: { setupState: Record<string, any> } }).$.setupState }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks(); mocks.viewEnter.length = 0
  profile.value = { id: 'new-account', email: 'parent@example.com', role: 'student', full_name: 'New account', onboarding_completed_at: null }
  user.value = { id: 'new-account', email: 'parent@example.com', user_metadata: {} }
  mocks.initialize.mockResolvedValue(undefined)
  mocks.refresh.mockImplementation(async () => profile.value)
  mocks.signOut.mockResolvedValue(undefined)
  mocks.replace.mockResolvedValue(undefined)
  mocks.rpc.mockResolvedValue({ data: false, error: null })
})

describe('provider-neutral account setup', () => {
  it('does not enable setup when the profile itself cannot be loaded', async () => {
    mocks.refresh.mockResolvedValue(null)
    const wrapper = mount(AccountSetupPage)
    await mocks.viewEnter[0](); await flushPromises()
    expect(state(wrapper).invitationChecked).toBe(false)
    expect(wrapper.text()).toContain('profile could not be loaded')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    expect(mocks.rpc).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('checks the server invitation before allowing any setup submission', async () => {
    const lookup = deferred<{ data: boolean; error: null }>()
    mocks.rpc.mockReturnValueOnce(lookup.promise)
    const wrapper = mount(AccountSetupPage)
    const setup = state(wrapper)
    setup.role = 'teacher'; setup.firstName = 'New'; setup.lastName = 'Teacher'
    await setup.submit()
    expect(setup.errorMessage).toContain('invitation is checked')
    expect(mocks.rpc).not.toHaveBeenCalled()
    const entering = mocks.viewEnter[0]()
    await flushPromises()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('my_parent_invitation')
    expect(setup.invitationChecked).toBe(false)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    lookup.resolve({ data: false, error: null })
    await entering
    expect(setup.invitationChecked).toBe(true)
    expect(setup.invitedParent).toBe(false)
    wrapper.unmount()
  })

  it('fails closed when the invitation lookup fails, without accepting a chosen role', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Invitation check is temporarily unavailable.' } })
    const wrapper = mount(AccountSetupPage)
    await mocks.viewEnter[0](); await flushPromises()
    const setup = state(wrapper)
    expect(setup.invitationChecked).toBe(false)
    expect(wrapper.text()).toContain('Invitation check is temporarily unavailable.')
    setup.firstName = 'Parent'; setup.lastName = 'One'; setup.role = 'parent'
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).not.toHaveBeenCalledWith('complete_account_setup', expect.anything())
    expect(mocks.replace).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows only Parent for a trusted invitation and rejects a forged different role', async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null })
    const wrapper = mount(AccountSetupPage)
    await mocks.viewEnter[0](); await flushPromises()
    const setup = state(wrapper)
    expect(setup.role).toBe('parent')
    expect(wrapper.findAll('input[type="radio"]').map(input => input.attributes('value'))).toEqual(['parent'])
    expect(wrapper.text()).toContain('explicit approval')
    setup.firstName = 'Parent'; setup.lastName = 'One'; setup.role = 'teacher'
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(setup.errorMessage).toContain('requires a parent / guardian account')
    expect(mocks.rpc).not.toHaveBeenCalledWith('complete_account_setup', expect.anything())
    wrapper.unmount()
  })

  it('offers all three roles for ordinary signup and ignores editable metadata roles', async () => {
    user.value!.user_metadata = { role: 'admin', account_type: 'teacher', invitation_kind: 'parent', full_name: 'Suggested Display Name' }
    const wrapper = mount(AccountSetupPage)
    await mocks.viewEnter[0](); await flushPromises()
    const setup = state(wrapper)
    expect(setup.firstName).toBe('SUGGESTED DISPLAY')
    expect(setup.lastName).toBe('NAME')
    expect(setup.role).toBe('')
    expect(setup.invitedParent).toBe(false)
    expect(wrapper.findAll('input[type="radio"]').map(input => input.attributes('value'))).toEqual(['student', 'teacher', 'parent'])
    expect(wrapper.find('input[value="admin"]').exists()).toBe(false)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('saves the invited parent role through the guarded RPC and redirects only after setup completes', async () => {
    user.value!.user_metadata = { name: ' Parent One ', role: 'student' }
    mocks.rpc.mockImplementation(async (name, payload) => {
      if (name === 'my_parent_invitation') return { data: true, error: null }
      if (name === 'complete_account_setup') profile.value = { ...profile.value!, role: payload.p_role, full_name: `${payload.p_first_name} ${payload.p_last_name}`, onboarding_completed_at: '2026-10-24T00:00:00Z' }
      return { data: null, error: null }
    })
    const wrapper = mount(AccountSetupPage)
    await mocks.viewEnter[0](); await flushPromises()
    await wrapper.get('form').trigger('submit'); await flushPromises()
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'my_parent_invitation')
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, 'complete_account_setup', { p_first_name: 'PARENT', p_last_name: 'ONE', p_role: 'parent' })
    expect(mocks.replace).toHaveBeenCalledWith('/parent')
    expect(state(wrapper).open).toBe(false)
    wrapper.unmount()
  })

  it('redirects an already-completed account without checking invitations or rewriting its role', async () => {
    profile.value = { ...profile.value!, role: 'teacher', onboarding_completed_at: '2026-10-23T00:00:00Z' }
    const wrapper = mount(AccountSetupPage)
    await mocks.viewEnter[0](); await flushPromises()
    expect(mocks.replace).toHaveBeenCalledWith('/teacher')
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(state(wrapper).open).toBe(false)
    wrapper.unmount()
  })
  it('keeps sign out usable when the profile is missing and ignores a late lookup after leaving', async () => {
    const lookup = deferred<SetupProfile | null>()
    mocks.refresh.mockReturnValue(lookup.promise)
    const wrapper = mount(AccountSetupPage)
    const entering = mocks.viewEnter[0]()
    await flushPromises()
    const setup = state(wrapper)
    await setup.leave()
    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(setup.open).toBe(false)
    expect(mocks.replace).toHaveBeenCalledWith('/login')
    lookup.resolve(null)
    await entering
    expect(setup.errorMessage).not.toContain('profile could not be loaded')
    expect(setup.open).toBe(false)
    wrapper.unmount()
  })
  it.each(['email', 'google', 'facebook'])('signs an incomplete %s account out after a failed profile load', async provider => {
    user.value!.user_metadata = { provider }
    mocks.refresh.mockResolvedValue(null)
    const wrapper = mount(AccountSetupPage)
    await mocks.viewEnter[0](); await flushPromises()
    expect(wrapper.text()).toContain('profile could not be loaded')
    const leave = wrapper.findAll('button').find(button => button.text() === 'Sign out')!
    expect(leave.attributes('disabled')).toBeUndefined()
    await leave.trigger('click'); await flushPromises()
    expect(mocks.signOut).toHaveBeenCalledOnce()
    expect(state(wrapper).open).toBe(false)
    expect(mocks.replace).toHaveBeenCalledWith('/login')
    wrapper.unmount()
  })
})
