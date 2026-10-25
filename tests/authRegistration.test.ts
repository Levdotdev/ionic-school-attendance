import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signUp: vi.fn(), signIn: vi.fn(), resetPassword: vi.fn(), replace: vi.fn(),
  refreshProfile: vi.fn(), completeAuthentication: vi.fn(), beginSocialSignIn: vi.fn(), profile: { value: null },
}))

vi.mock('/minsu-logo.png', () => ({ default: '/minsu-logo.png' }))

vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  const shell = (name: string) => defineComponent({ name, setup: (_, { slots }) => () => h('div', slots.default?.()) })
  return {
    IonPage: shell('IonPage'), IonContent: shell('IonContent'), IonHeader: shell('IonHeader'),
    IonToolbar: shell('IonToolbar'), IonTitle: shell('IonTitle'), IonButtons: shell('IonButtons'),
    IonLabel: shell('IonLabel'), IonSegmentButton: shell('IonSegmentButton'), IonSpinner: shell('IonSpinner'),
    IonIcon: defineComponent({ name: 'IonIcon', props: ['icon'], render: () => null }),
    IonModal: defineComponent({ name: 'IonModal', props: ['isOpen'], setup: (props, { slots }) => () => props.isOpen ? h('div', slots.default?.()) : null }),
    IonSegment: defineComponent({ name: 'IonSegment', props: ['modelValue', 'disabled'], emits: ['update:modelValue'], setup: (_, { slots }) => () => h('div', slots.default?.()) }),
    IonButton: defineComponent({ name: 'IonButton', props: ['type', 'disabled'], setup: (props, { slots }) => () => h('button', { type: props.type || 'button', disabled: props.disabled }, slots.default?.()) }),
    IonInput: defineComponent({ name: 'IonInput', props: ['modelValue', 'label', 'type', 'disabled'], emits: ['update:modelValue'], setup: (props, { emit }) => () => h('label', [props.label, h('input', { value: props.modelValue, type: props.type, disabled: props.disabled, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value) })]) }),
  }
})
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@/composables/useSession', () => ({
  useSession: () => ({ initializeSession: async () => undefined, completeAuthentication: mocks.completeAuthentication, refreshProfile: mocks.refreshProfile, profile: mocks.profile }),
  accountPathForProfile: (profile: { role: string; onboarding_completed_at: string | null }) => profile.onboarding_completed_at ? `/${profile.role}` : '/account/setup',
}))
vi.mock('@/composables/useTheme', () => ({ useTheme: () => ({ isDark: false, toggleTheme: vi.fn() }) }))
vi.mock('@/components/AppModal.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ props: ['open', 'title'], setup: (props, { slots }) => () => props.open ? h('section', [h('h2', String(props.title)), slots.default?.()]) : null }) }
})
vi.mock('@/lib/supabase', () => ({ supabase: { auth: {
  signUp: mocks.signUp, signInWithPassword: mocks.signIn, resetPasswordForEmail: mocks.resetPassword,
} } }))
vi.mock('@/services/oauth', () => ({
  beginSocialSignIn: mocks.beginSocialSignIn,
  initializeNativeOAuthCallback: async () => undefined,
  oauthRedirectUrl: () => 'https://ionic-school-attendance.vercel.app/auth/callback',
}))

import LoginPage from '@/views/LoginPage.vue'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.signUp.mockResolvedValue({ data: { session: null }, error: null })
  mocks.signIn.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null })
  mocks.resetPassword.mockResolvedValue({ error: null })
  mocks.refreshProfile.mockResolvedValue({ role: 'student', onboarding_completed_at: null })
  mocks.completeAuthentication.mockResolvedValue({ role: 'student', onboarding_completed_at: null })
  mocks.beginSocialSignIn.mockResolvedValue(undefined)
})

async function signupForm() {
  const wrapper = mount(LoginPage)
  await flushPromises()
  wrapper.findComponent({ name: 'IonSegment' }).vm.$emit('update:modelValue', 'signup')
  await flushPromises()
  const inputs = wrapper.findAll('input')
  await inputs[0].setValue('  Test@Example.com  ')
  await inputs[1].setValue('A-secure-password')
  await inputs[2].setValue('A-secure-password')
  return wrapper
}

describe('shared email and social registration', () => {
  it.each(['student', 'teacher', 'parent', 'admin'])('navigates a %s password login from the returned session without a page refresh', async role => {
    const signedIn = { user: { id: 'user-1' } }
    mocks.signIn.mockResolvedValue({ data: { session: signedIn }, error: null })
    mocks.completeAuthentication.mockResolvedValue({ role, onboarding_completed_at: '2026-10-25' })
    const wrapper = mount(LoginPage)
    await flushPromises()
    await wrapper.findAll('input')[0].setValue('person@example.com')
    await wrapper.findAll('input')[1].setValue('A-secure-password')
    await wrapper.find('form').trigger('submit'); await flushPromises()
    expect(mocks.completeAuthentication).toHaveBeenCalledWith(signedIn)
    expect(mocks.replace).toHaveBeenCalledWith(`/${role}`)
    expect(wrapper.text()).not.toContain('account profile is not ready')
    wrapper.unmount()
  })
  it('registers using email/password without name or account-type metadata', async () => {
    const wrapper = await signupForm()
    expect(wrapper.findAll('label').map((label) => label.text())).toEqual(['Email address', 'Password', 'Confirm password'])
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: 'test@example.com', password: 'A-secure-password',
      options: { emailRedirectTo: 'https://ionic-school-attendance.vercel.app/auth/callback' },
    })
    expect(wrapper.text()).toContain('Registration request accepted')
    expect(wrapper.text()).toContain('If you already registered or use Google or Facebook')
    expect(mocks.replace).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('requires matching passwords before creating an email account', async () => {
    const wrapper = await signupForm()
    await wrapper.findAll('input')[2].setValue('Something-else')
    await wrapper.find('form').trigger('submit')
    expect(mocks.signUp).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('The passwords do not match.')
    wrapper.unmount()
  })

  it('takes immediately authenticated email accounts to the same setup used by social accounts', async () => {
    mocks.signUp.mockResolvedValue({ data: { session: { user: { id: 'new-user' } } }, error: null })
    const wrapper = await signupForm()
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(mocks.replace).toHaveBeenCalledWith('/account/setup')
    wrapper.unmount()
  })

  it.each(['Google', 'Facebook'])('offers %s registration without choosing a student role first', async (provider) => {
    const wrapper = await signupForm()
    await wrapper.findAll('button').find((button) => button.text() === provider)!.trigger('click')
    await flushPromises()
    expect(mocks.beginSocialSignIn).toHaveBeenCalledWith(provider.toLowerCase())
    wrapper.unmount()
  })

  it('sends recovery links through the existing allowlisted auth callback', async () => {
    const wrapper = mount(LoginPage)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === 'Forgot password?')!.trigger('click')
    const form = wrapper.findAll('form')[1]
    await form.find('input').setValue('teacher@example.com')
    await form.trigger('submit')
    await flushPromises()
    expect(mocks.resetPassword).toHaveBeenCalledWith('teacher@example.com', { redirectTo: 'https://ionic-school-attendance.vercel.app/auth/callback' })
    expect(wrapper.text()).toContain('Reset request accepted. If an account uses this email')
    expect(wrapper.text()).toContain('does not confirm email delivery')
    wrapper.unmount()
  })

  it('shows email rate-limit errors without claiming that a reset link was delivered', async () => {
    mocks.resetPassword.mockResolvedValue({ error: { code: 'over_email_send_rate_limit', message: 'Email rate limit exceeded' } })
    const wrapper = mount(LoginPage)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === 'Forgot password?')!.trigger('click')
    const form = wrapper.findAll('form')[1]
    await form.find('input').setValue('teacher@example.com')
    await form.trigger('submit'); await flushPromises()
    expect(wrapper.text()).toContain('email service has reached its sending limit')
    expect(wrapper.text()).not.toContain('Reset request accepted')
    wrapper.unmount()
  })

  it('prevents repeated reset requests during the send cooldown', async () => {
    const wrapper = mount(LoginPage)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === 'Forgot password?')!.trigger('click')
    const form = wrapper.findAll('form')[1]
    await form.find('input').setValue('teacher@example.com')
    await form.trigger('submit'); await flushPromises()
    await form.trigger('submit'); await flushPromises()
    expect(mocks.resetPassword).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('Request again in 60s')
    wrapper.unmount()
  })
})
