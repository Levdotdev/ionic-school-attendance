import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), realtime: vi.fn() }))
const profile = ref<{ id: string; role: string } | null>({ id: 'admin-1', role: 'admin' })
const route = reactive({ query: { section: 'verification' } })
vi.mock('@ionic/vue', () => {
  const container = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
  return {
  IonPage: container, IonContent: container, IonIcon: container, IonLabel: container,
  IonSegment: container, IonSegmentButton: container, IonSpinner: container,
  IonButton: defineComponent({ inheritAttrs: false, props: ['disabled', 'type'], setup: (props, { attrs, slots }) => () => h('button', { ...attrs, type: props.type || 'button', disabled: props.disabled }, slots.default?.()) }),
  IonTextarea: defineComponent({ props: ['modelValue', 'label'], emits: ['update:modelValue'], setup: (props, { emit }) => () => h('textarea', { 'aria-label': props.label, value: props.modelValue, onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value) }) }),
  onIonViewWillEnter: vi.fn(),
  }
})
vi.mock('@/components/AppModal.vue', () => ({ default: defineComponent({ props: ['open', 'title'], setup: (props, { slots }) => () => props.open ? h('section', { role: 'dialog', 'aria-label': props.title }, [slots.default?.(), slots.actions?.()]) : null }) }))
vi.mock('@/components/PortalHeader.vue', () => ({ default: { template: '<header />' } }))
vi.mock('@/components/StudentGuardianModal.vue', () => ({ default: { template: '<aside />' } }))
vi.mock('@/components/InviteParentModal.vue', () => ({ default: { template: '<aside />' } }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ profile, initializeSession: async () => {}, signOut: async () => {} }) }))
vi.mock('@/composables/useRealtimeRefresh', () => ({ useRealtimeRefresh: mocks.realtime }))
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
import AdminPage from '@/views/AdminPage.vue'

type Registration = { student_id: string; full_name: string; email: string; is_registered: boolean; can_retake: boolean; registered_at: string | null; granted_at: string | null; barcode_value: string | null }
let rows: Registration[]
beforeEach(() => {
  vi.clearAllMocks()
  profile.value = { id: 'admin-1', role: 'admin' }
  route.query.section = 'verification'
  rows = [
    { student_id: 'student-1', full_name: 'JUAN CRUZ', email: 'juan@example.test', is_registered: true, can_retake: false, registered_at: '2026-11-01T08:00:00Z', granted_at: null, barcode_value: '2026-abC/  10' },
    { student_id: 'student-2', full_name: 'MARIA REYES', email: 'maria@example.test', is_registered: true, can_retake: false, registered_at: '2026-10-20T08:00:00Z', granted_at: null, barcode_value: null },
    { student_id: 'student-3', full_name: 'PEDRO SANTOS', email: 'pedro@example.test', is_registered: false, can_retake: false, registered_at: null, granted_at: null, barcode_value: null },
  ]
  const builder = { select: () => builder, eq: () => builder, order: () => builder, then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) }
  mocks.from.mockReturnValue(builder)
  mocks.rpc.mockImplementation(async (name: string, input?: { p_student_id?: string }) => {
    if (name === 'admin_student_barcode_registrations') return { data: rows.map(row => ({ ...row })), error: null }
    if (name === 'admin_grant_barcode_retake') rows = rows.map(row => row.student_id === input?.p_student_id ? { ...row, can_retake: true } : row)
    return { data: [], error: null }
  })
})
afterEach(() => { vi.useRealTimers() })
async function openBarcodePanel() {
  const wrapper = mount(AdminPage)
  await flushPromises()
  await wrapper.findAll('button').find(button => button.text() === 'School ID barcode')!.trigger('click')
  await flushPromises()
  return wrapper
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }

describe('administrator school ID access and retakes', () => {
  it('loads IDs only when their panel is opened, preserves exact barcode text, and distinguishes legacy values', async () => {
    const wrapper = mount(AdminPage); await flushPromises()
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_student_barcode_registrations')
    await wrapper.findAll('button').find(button => button.text() === 'School ID barcode')!.trigger('click'); await flushPromises()
    expect(wrapper.get('.student-id-value').element.textContent).toBe('2026-abC/  10')
    expect(wrapper.findAll('.barcode-registration-row')).toHaveLength(2)
    expect(wrapper.get('.missing-id-value').text()).toContain('approved camera re-scan')
    await wrapper.get('input[placeholder="Search student name, email or ID"]').setValue('abc/  10')
    expect(wrapper.findAll('.barcode-registration-row')).toHaveLength(1)
    expect(wrapper.get('.barcode-registration-row').text()).toContain('JUAN CRUZ')
    await wrapper.get('input[placeholder="Search student name, email or ID"]').setValue('')
    await wrapper.findAll('button').find(button => button.text().startsWith('Not registered'))!.trigger('click')
    expect(wrapper.get('.barcode-registration-row').text()).toContain('PEDRO SANTOS')
    expect(wrapper.get('.barcode-registration-row').find('button').exists()).toBe(false)
    wrapper.unmount()
  })
  it('requires confirmation before granting one replacement, refreshes the status, and expires feedback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const wrapper = await openBarcodePanel()
    await wrapper.findAll('.barcode-registration-row button')[0].trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('current ID remains active')
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_grant_barcode_retake', expect.anything())
    await wrapper.get('textarea[aria-label="Reason (optional)"]').setValue('  ID replaced  ')
    await wrapper.get('[role="dialog"]').findAll('button').find(button => button.text() === 'Approve ID retake')!.trigger('click'); await flushPromises()
    expect(mocks.rpc).toHaveBeenCalledWith('admin_grant_barcode_retake', { p_student_id: 'student-1', p_note: 'ID replaced' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    const first = wrapper.findAll('.barcode-registration-row')[0]
    expect(first.text()).toContain('ID retake approved')
    expect(first.find('button').exists()).toBe(false)
    expect(wrapper.get('.page-message').text()).toContain('one-time ID barcode retake')
    await vi.advanceTimersByTimeAsync(5001)
    expect(wrapper.find('.page-message').exists()).toBe(false)
    wrapper.unmount()
  })
  it('keeps approval errors inside the modal and allows a retry without losing the reason', async () => {
    const wrapper = await openBarcodePanel()
    const original = mocks.rpc.getMockImplementation()!
    mocks.rpc.mockImplementationOnce(async () => ({ data: null, error: { message: 'Administrator access required' } }))
    await wrapper.findAll('.barcode-registration-row button')[0].trigger('click')
    await wrapper.get('textarea').setValue('Replace damaged card')
    await wrapper.get('[role="dialog"]').findAll('button')[1].trigger('click'); await flushPromises()
    expect(wrapper.get('[role="dialog"] [role="alert"]').text()).toContain('Administrator access required')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('Replace damaged card')
    mocks.rpc.mockImplementation(original)
    await wrapper.get('[role="dialog"]').findAll('button')[1].trigger('click'); await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('uses live updates for saved values and consumed approvals without a refresh button', async () => {
    const wrapper = await openBarcodePanel()
    rows[0] = { ...rows[0], barcode_value: 'New-id-XYZ', can_retake: true }
    await mocks.realtime.mock.calls[0][0].onChange(); await flushPromises()
    expect(wrapper.get('.student-id-value').text()).toBe('New-id-XYZ')
    expect(wrapper.findAll('.barcode-registration-row')[0].text()).toContain('ID retake approved')
    rows[0] = { ...rows[0], can_retake: false }
    await mocks.realtime.mock.calls[0][0].onChange(); await flushPromises()
    expect(wrapper.findAll('.barcode-registration-row')[0].find('button').text()).toBe('Approve ID retake')
    expect(wrapper.findAll('button').some(button => /refresh/i.test(button.text()))).toBe(false)
    wrapper.unmount()
  })
  it.each(['sign-out', 'role-change'])('discards pending ID responses after %s', async reason => {
    const waiting = deferred<{ data: Registration[]; error: null }>()
    mocks.rpc.mockImplementation(async name => name === 'admin_student_barcode_registrations' ? waiting.promise : { data: [], error: null })
    const wrapper = mount(AdminPage); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'School ID barcode')!.trigger('click')
    profile.value = reason === 'sign-out' ? null : { id: 'admin-1', role: 'teacher' }
    await flushPromises()
    waiting.resolve({ data: rows, error: null }); await flushPromises()
    expect(wrapper.find('.student-id-value').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('2026-abC/')
    wrapper.unmount()
  })
  it('does not show one administrator’s pending ID response in the next administrator’s session', async () => {
    const first = deferred<{ data: Registration[]; error: null }>(), second = deferred<{ data: Registration[]; error: null }>()
    let request = 0
    mocks.rpc.mockImplementation(async name => name === 'admin_student_barcode_registrations' ? (++request === 1 ? first.promise : second.promise) : { data: [], error: null })
    const wrapper = mount(AdminPage); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'School ID barcode')!.trigger('click')
    profile.value = { id: 'admin-2', role: 'admin' }; await flushPromises()
    first.resolve({ data: rows, error: null }); await flushPromises()
    expect(wrapper.find('.student-id-value').exists()).toBe(false)
    second.resolve({ data: [], error: null }); await flushPromises()
    expect(wrapper.find('.student-id-value').exists()).toBe(false)
    wrapper.unmount()
  })
  it('ignores approval completion after the current administrator leaves the account', async () => {
    const wrapper = await openBarcodePanel()
    const waiting = deferred<{ data: null; error: null }>()
    mocks.rpc.mockImplementationOnce(() => waiting.promise)
    await wrapper.findAll('.barcode-registration-row button')[0].trigger('click')
    await wrapper.get('[role="dialog"]').findAll('button')[1].trigger('click')
    profile.value = null; await flushPromises()
    waiting.resolve({ data: null, error: null }); await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.find('.page-message').exists()).toBe(false)
    expect(wrapper.find('.student-id-value').exists()).toBe(false)
    wrapper.unmount()
  })
  it('clears already loaded ID values and an open approval when the administrator changes role', async () => {
    const wrapper = await openBarcodePanel()
    await wrapper.findAll('.barcode-registration-row button')[0].trigger('click')
    profile.value = { id: 'admin-1', role: 'student' }; await flushPromises()
    expect(wrapper.find('.student-id-value').exists()).toBe(false)
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('2026-abC/')
    wrapper.unmount()
  })
})
