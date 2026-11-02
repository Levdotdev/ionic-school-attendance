import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import BarcodeRetakeModal from '@/components/BarcodeRetakeModal.vue'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), scan: vi.fn(), getUser: vi.fn(),
  user: { value: { id: 'student-1' } as { id: string } | null },
  profile: { value: { id: 'student-1', role: 'student' } as { id: string; role: string } | null },
}))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, auth: { getUser: mocks.getUser } } }))
vi.mock('@/services/barcode', () => ({ scanStudentBarcode: mocks.scan }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ user: mocks.user, profile: mocks.profile }) }))
vi.mock('@ionic/vue', () => ({
  IonButton: defineComponent({ props: ['disabled'], setup: (props, { slots }) => () => h('button', { disabled: props.disabled }, slots.default?.()) }),
  IonIcon: defineComponent({ setup: () => () => h('span') }),
  IonSpinner: defineComponent({ setup: () => () => h('span') }),
}))
vi.mock('@/components/AppModal.vue', () => ({ default: defineComponent({
  props: ['open', 'busy', 'title'],
  setup: (props, { slots }) => () => props.open ? h('section', [h('h2', props.title), slots.default?.(), slots.actions?.()]) : null,
}) }))

function access(canRetake: boolean) { return { data: [{ is_registered: true, can_retake: canRetake, registered_at: '2026-10-01', granted_at: null }], error: null } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function button(wrapper: ReturnType<typeof mount>, text: string) { return wrapper.findAll('button').find(candidate => candidate.text() === text)! }
async function render(approved = true) {
  mocks.rpc.mockImplementation(async (name: string) => name === 'my_barcode_registration_access' ? access(approved) : { data: null, error: null })
  const wrapper = mount(BarcodeRetakeModal, { props: { open: true } })
  await flushPromises()
  return wrapper
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = ref({ id: 'student-1' })
  mocks.profile = ref({ id: 'student-1', role: 'student' })
  mocks.getUser.mockImplementation(async () => ({ data: { user: mocks.user.value }, error: null }))
  mocks.scan.mockResolvedValue('MiNsU-001 Ab')
})

describe('admin-approved camera-only ID barcode retakes', () => {
  it('keeps a registered student locked without admin approval', async () => {
    const wrapper = await render(false)
    expect(wrapper.text()).toContain('Ask an administrator to approve a retake')
    expect(wrapper.findAll('input')).toHaveLength(0)
    expect(wrapper.findAll('button').map(candidate => candidate.text())).toEqual(['Cancel'])
    expect(mocks.scan).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('my_barcode_registration_access')
    wrapper.unmount()
  })

  it('captures only through the camera, hides the value, and saves its exact case for the original student', async () => {
    const wrapper = await render()
    expect(button(wrapper, 'Save new school ID').attributes('disabled')).toBeDefined()
    await button(wrapper, 'Scan barcode with camera').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('New school ID captured')
    expect(wrapper.text()).not.toContain('MiNsU-001 Ab')
    expect(wrapper.findAll('input')).toHaveLength(0)
    await button(wrapper, 'Save new school ID').trigger('click'); await flushPromises()
    expect(mocks.getUser).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('replace_student_barcode', { p_raw_barcode: 'MiNsU-001 Ab', p_expected_student_id: 'student-1' })
    expect(wrapper.emitted('saved')).toHaveLength(1)
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('New school ID captured')
    wrapper.unmount()
  })

  it('keeps the captured scan and allows retry when the server rejects a duplicate ID', async () => {
    const wrapper = await render()
    mocks.rpc.mockImplementation(async (name: string) => name === 'replace_student_barcode'
      ? { data: null, error: { message: 'This school ID is already registered to another student.' } } : access(true))
    await button(wrapper, 'Scan barcode with camera').trigger('click'); await flushPromises()
    await button(wrapper, 'Save new school ID').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('already registered')
    expect(wrapper.text()).toContain('New school ID captured')
    expect(wrapper.emitted('saved')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await button(wrapper, 'Save new school ID').trigger('click'); await flushPromises()
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not save when the scanner is canceled or cannot capture an ID', async () => {
    const wrapper = await render()
    mocks.scan.mockRejectedValue(new Error('Camera scan canceled.'))
    await button(wrapper, 'Scan barcode with camera').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Camera scan canceled')
    expect(button(wrapper, 'Save new school ID').attributes('disabled')).toBeDefined()
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'replace_student_barcode')).toBe(false)
    wrapper.unmount()
  })

  it('hides a captured ID echoed by a failed database response', async () => {
    const wrapper = await render()
    await button(wrapper, 'Scan barcode with camera').trigger('click'); await flushPromises()
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Could not save MiNsU-001 Ab' } })
    await button(wrapper, 'Save new school ID').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Unable to confirm')
    expect(wrapper.html()).not.toContain('MiNsU-001 Ab')
    wrapper.unmount()
  })

  it('locks the modal when the server reports that retake approval is no longer available', async () => {
    const wrapper = await render()
    await button(wrapper, 'Scan barcode with camera').trigger('click'); await flushPromises()
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'An administrator must approve another retake.' } })
    await button(wrapper, 'Save new school ID').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('approve another retake')
    expect(wrapper.text()).not.toContain('New school ID captured')
    expect(wrapper.text()).not.toContain('Save new school ID')
    expect(wrapper.text()).not.toContain('Scan barcode with camera')
    wrapper.unmount()
  })

  it('discards a scan that completes after the signed-in account changes', async () => {
    const wrapper = await render()
    const pending = deferred<string>()
    mocks.scan.mockReturnValue(pending.promise)
    await button(wrapper, 'Scan barcode with camera').trigger('click')
    mocks.user.value = { id: 'student-2' }
    await flushPromises()
    pending.resolve('OLD-STUDENT-ID')
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('New school ID captured')
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'replace_student_barcode')).toBe(false)
    wrapper.unmount()
  })

  it('does not send the scan when the fresh authenticated user differs from the modal owner', async () => {
    const wrapper = await render()
    await button(wrapper, 'Scan barcode with camera').trigger('click'); await flushPromises()
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'student-2' } }, error: null })
    await button(wrapper, 'Save new school ID').trigger('click'); await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Your account changed')
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'replace_student_barcode')).toBe(false)
    wrapper.unmount()
  })

  it('ignores an authentication check which returns after sign-out', async () => {
    const wrapper = await render()
    await button(wrapper, 'Scan barcode with camera').trigger('click'); await flushPromises()
    const pending = deferred<{ data: { user: { id: string } }; error: null }>()
    mocks.getUser.mockReturnValue(pending.promise)
    await button(wrapper, 'Save new school ID').trigger('click')
    mocks.user.value = null
    pending.resolve({ data: { user: { id: 'student-1' } }, error: null })
    await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'replace_student_barcode')).toBe(false)
    wrapper.unmount()
  })

  it('clears the captured credential when canceled and requires a new scan after reopening', async () => {
    const wrapper = await render()
    await button(wrapper, 'Scan barcode with camera').trigger('click'); await flushPromises()
    await button(wrapper, 'Cancel').trigger('click')
    await wrapper.setProps({ open: false }); await wrapper.setProps({ open: true }); await flushPromises()
    expect(wrapper.text()).not.toContain('New school ID captured')
    expect(button(wrapper, 'Save new school ID').attributes('disabled')).toBeDefined()
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'replace_student_barcode')).toBe(false)
    wrapper.unmount()
  })

  it('does not let an obsolete approval response unlock a reopened dialog for a different account', async () => {
    const pending = deferred<ReturnType<typeof access>>()
    mocks.rpc.mockReturnValueOnce(pending.promise).mockResolvedValue(access(false))
    const wrapper = mount(BarcodeRetakeModal, { props: { open: true } })
    await wrapper.setProps({ open: false })
    mocks.user.value = { id: 'student-2' }
    mocks.profile.value = { id: 'student-2', role: 'student' }
    await wrapper.setProps({ open: true }); await flushPromises()
    pending.resolve(access(true)); await flushPromises()
    expect(wrapper.text()).toContain('Your school ID is locked')
    expect(wrapper.text()).not.toContain('Scan barcode with camera')
    expect(mocks.scan).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
