import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import StudentPage from '@/views/StudentPage.vue'
import BarcodeRetakeModal from '@/components/BarcodeRetakeModal.vue'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), realtime: vi.fn(),
  user: { value: { id: 'student-1' } as { id: string } | null },
  profile: { value: { id: 'student-1', role: 'student', full_name: 'STUDENT ONE', first_name: 'STUDENT', last_name: 'ONE' } },
}))
vi.mock('@ionic/vue', async original => ({ ...await original<typeof import('@ionic/vue')>(), onIonViewWillEnter: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ user: mocks.user, profile: mocks.profile, initializeSession: async () => {}, refreshProfile: async () => mocks.profile.value, signOut: vi.fn() }) }))
vi.mock('@/composables/useRealtimeRefresh', () => ({ useRealtimeRefresh: mocks.realtime }))
vi.mock('vue-router', () => ({ useRoute: () => ({ query: { section: 'overview' } }), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/PortalHeader.vue', () => ({ default: { template: '<header />' } }))
vi.mock('@/components/FaceEnrollmentModal.vue', () => ({ default: { template: '<aside />' } }))
vi.mock('@/components/BarcodeRetakeModal.vue', () => ({ default: { name: 'BarcodeRetakeModal', props: ['open'], emits: ['close', 'saved'], template: '<aside />' } }))

let canRetake = false
function barcodeAccess() { return { data: [{ is_registered: true, can_retake: canRetake, granted_at: null, registered_at: '2026-10-01' }], error: null } }
function query(table: string) {
  const builder = { select: () => builder, eq: () => builder, order: () => builder, maybeSingle: () => builder,
    then: (resolve: (result: unknown) => void) => Promise.resolve().then(() => resolve({ data: table === 'student_profiles' ? { user_id: 'student-1', registration_completed_at: '2026-10-01', guardian_email: null } : [], error: null })) }
  return builder
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function render() { return shallowMount(StudentPage, { global: { stubs: { IonPage: { template: '<div><slot /></div>' }, IonContent: { template: '<div><slot /></div>' }, IonButton: { props: ['disabled'], template: '<button :disabled="disabled"><slot /></button>' } } } }) }
beforeEach(() => {
  vi.clearAllMocks(); canRetake = false
  mocks.user = ref({ id: 'student-1' })
  mocks.profile = ref({ id: 'student-1', role: 'student', full_name: 'STUDENT ONE', first_name: 'STUDENT', last_name: 'ONE' })
  mocks.from.mockImplementation(query)
  mocks.rpc.mockImplementation(async (name: string) => name === 'my_barcode_registration_access' ? barcodeAccess() : name === 'my_face_enrollment_access' ? { data: [{ is_enrolled: true, can_retake: false }], error: null } : { data: [], error: null })
})

describe('student school ID retake access', () => {
  it('exposes the retake action only after an admin grant arrives through live refresh', async () => {
    const wrapper = render(); await flushPromises()
    const card = () => wrapper.get('[data-school-id-access]')
    expect(card().text()).toContain('registered and locked')
    expect(card().find('button').exists()).toBe(false)
    expect(wrapper.findComponent(BarcodeRetakeModal).props('open')).toBe(false)
    canRetake = true
    await mocks.realtime.mock.calls[0][0].onChange(); await flushPromises()
    expect(card().text()).toContain('An administrator approved one ID barcode retake')
    await card().get('button').trigger('click')
    expect(wrapper.findComponent(BarcodeRetakeModal).props('open')).toBe(true)
    wrapper.unmount()
  })

  it('locks the card again and closes the modal after the replacement is saved', async () => {
    canRetake = true
    const wrapper = render(); await flushPromises()
    await wrapper.get('[data-school-id-access] button').trigger('click')
    canRetake = false
    wrapper.findComponent(BarcodeRetakeModal).vm.$emit('saved')
    await flushPromises()
    expect(wrapper.findComponent(BarcodeRetakeModal).props('open')).toBe(false)
    expect(wrapper.get('[data-school-id-access]').text()).toContain('Your school ID barcode was updated')
    expect(wrapper.get('[data-school-id-access]').find('button').exists()).toBe(false)
    wrapper.unmount()
  })

  it('drops an old account’s delayed approval response and closes an open retake on account change', async () => {
    canRetake = true
    const wrapper = render(); await flushPromises()
    await wrapper.get('[data-school-id-access] button').trigger('click')
    const pending = deferred<ReturnType<typeof barcodeAccess>>()
    mocks.rpc.mockImplementation((name: string) => name === 'my_barcode_registration_access' ? pending.promise : Promise.resolve({ data: [], error: null }))
    const refresh = mocks.realtime.mock.calls[0][0].onChange()
    await flushPromises()
    mocks.user.value = { id: 'student-2' }
    pending.resolve(barcodeAccess())
    await refresh; await flushPromises()
    expect(wrapper.findComponent(BarcodeRetakeModal).props('open')).toBe(false)
    expect(wrapper.get('[data-school-id-access]').find('button').exists()).toBe(false)
    wrapper.unmount()
  })
})
