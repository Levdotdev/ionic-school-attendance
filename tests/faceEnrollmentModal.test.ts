import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), capture: vi.fn(), release: vi.fn(), analyze: vi.fn(), validate: vi.fn() }))
vi.mock('/minsu-logo.png', () => ({ default: '/minsu-logo.png' }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
vi.mock('@/services/selfie', () => ({ captureSelfie: mocks.capture, releaseSelfiePreview: mocks.release }))
vi.mock('@/services/faceRecognition', () => ({ analyzeFace: mocks.analyze, validateEnrollmentSamples: mocks.validate, FACE_MODEL_VERSION: 'test-model' }))
vi.mock('@/components/AppModal.vue', async () => { const { defineComponent, h } = await import('vue'); return { default: defineComponent({ props: ['open', 'title', 'busy'], setup: (props, { slots }) => () => props.open ? h('section', [h('h2', String(props.title)), slots.default?.()]) : null }) } })
vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    IonButton: defineComponent({ props: ['disabled'], setup: (props, { slots }) => () => h('button', { disabled: props.disabled }, slots.default?.()) }),
    IonIcon: defineComponent({ render: () => null }), IonSpinner: defineComponent({ render: () => null }),
    IonCheckbox: defineComponent({ props: ['modelValue'], emits: ['update:modelValue'], setup: (props, { emit }) => () => h('input', { type: 'checkbox', checked: props.modelValue, onChange: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).checked) }) }),
  }
})
import FaceEnrollmentModal from '@/components/FaceEnrollmentModal.vue'
function state(wrapper: ReturnType<typeof mount>) { return (wrapper.vm as unknown as { $: { setupState: Record<string, any> } }).$.setupState }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: [{ is_enrolled: false, can_retake: false }], error: null })
  mocks.capture.mockImplementation(async () => ({ blob: new Blob(['photo']), previewUrl: `blob:sample-${mocks.capture.mock.calls.length}` }))
  mocks.analyze.mockResolvedValue({ embedding: [1, 0] })
  mocks.validate.mockResolvedValue([1, 0])
})

describe('one-time face enrollment access', () => {
  it('checks server access when opened and prevents recapturing an enrolled face without authorization', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ is_enrolled: true, can_retake: false }], error: null })
    const wrapper = mount(FaceEnrollmentModal, { props: { open: true } })
    await flushPromises()
    expect(mocks.rpc).toHaveBeenCalledWith('my_face_enrollment_access')
    expect(wrapper.text()).toContain('Ask an administrator to authorize a retake')
    await state(wrapper).captureSample()
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Take photo 1 of 3')
    wrapper.unmount()
  })
  it('fails closed when access cannot be confirmed', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Unable to check permission' } })
    const wrapper = mount(FaceEnrollmentModal, { props: { open: true } })
    await flushPromises()
    await state(wrapper).captureSample()
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Unable to check permission')
    wrapper.unmount()
  })
  it('uses a granted retake once and releases all temporary photo previews after saving', async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === 'my_face_enrollment_access' ? [{ is_enrolled: true, can_retake: true }] : null, error: null }))
    const wrapper = mount(FaceEnrollmentModal, { props: { open: true } })
    await flushPromises()
    expect(wrapper.text()).toContain('Your retake is authorized')
    const vm = state(wrapper)
    await vm.captureSample(); await vm.captureSample(); await vm.captureSample()
    vm.consented = true
    await vm.saveEnrollment(); await flushPromises()
    expect(mocks.rpc).toHaveBeenCalledWith('enroll_my_face', { p_embedding: [1, 0], p_model_version: 'test-model', p_sample_count: 3 })
    expect(wrapper.emitted('enrolled')).toHaveLength(1)
    expect(mocks.release).toHaveBeenCalledTimes(3)
    expect(vm.locked).toBe(true)
    await vm.captureSample()
    expect(mocks.capture).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })
  it('clears camera previews when closed and checks access again on re-entry', async () => {
    const wrapper = mount(FaceEnrollmentModal, { props: { open: true } })
    await flushPromises()
    await state(wrapper).captureSample()
    await wrapper.setProps({ open: false })
    expect(mocks.release).toHaveBeenCalledOnce()
    expect(state(wrapper).samples).toEqual([])
    await wrapper.setProps({ open: true }); await flushPromises()
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })
})
