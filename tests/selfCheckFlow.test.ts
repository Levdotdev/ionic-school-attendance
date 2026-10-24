import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), meeting: vi.fn(), replace: vi.fn(),
  capture: vi.fn(), watermark: vi.fn(), upload: vi.fn(), analyze: vi.fn(), location: vi.fn(),
}))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ initializeSession: async () => {}, user: { value: { id: 'student-1' } } }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { meetingId: 'meeting-1' } }), useRouter: () => ({ replace: mocks.replace }) }))
vi.mock('@/lib/supabase', () => ({ supabase: {
  rpc: mocks.rpc,
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.meeting }) }) }),
} }))
vi.mock('@/services/selfie', () => ({ captureSelfie: mocks.capture, watermarkAttendanceSelfie: mocks.watermark, uploadAttendanceSelfie: mocks.upload, releaseSelfiePreview: vi.fn() }))
vi.mock('@/services/faceRecognition', () => ({ analyzeFace: mocks.analyze, FACE_MODEL_VERSION: 'test-model' }))
vi.mock('@/services/location', () => ({ captureAttendanceLocation: mocks.location }))
vi.mock('@/services/barcode', () => ({ scanStudentBarcode: async () => 'school-code' }))
vi.mock('@/components/FaceEnrollmentModal.vue', () => ({ default: defineComponent({ props: ['open'], render: () => null }) }))

import SelfCheckPage from '@/views/SelfCheckPage.vue'

const container = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const button = defineComponent({ props: ['disabled'], setup: (props, { slots, attrs }) => () => h('button', { ...attrs, disabled: props.disabled }, slots.default?.()) })
const stubs = Object.fromEntries(['IonPage', 'IonHeader', 'IonToolbar', 'IonButtons', 'IonContent', 'IonTitle', 'IonIcon', 'IonSpinner', 'IonBackButton'].map(name => [name, container]))
function render() { return mount(SelfCheckPage, { global: { stubs: { ...stubs, IonButton: button } } }) }
function clickText(wrapper: ReturnType<typeof render>, text: string) {
  const target = wrapper.findAll('button').find(item => item.text().includes(text))
  if (!target) throw new Error(`Button ${text} not found`)
  return target.trigger('click')
}
const photo = { blob: new Blob(['photo']), previewUrl: 'blob:original', capturedAt: '2026-10-23T06:00:00Z', watermarkApplied: false, extension: 'jpg', contentType: 'image/jpeg' }
const stamped = { ...photo, previewUrl: 'blob:stamped', watermarkApplied: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.meeting.mockResolvedValue({ data: { id: 'meeting-1', class_name: 'ITE 412', title: 'Online class', attendance_mode: 'self_online', attendance_closes_at: '2030-01-01T06:00:00Z', max_accuracy_m: 100, existing_status: null }, error: null })
  mocks.rpc.mockImplementation(async name => ({ data: name === 'my_face_enrollment_status' ? [{ enrolled: true }] : name === 'verify_my_face_for_meeting' ? [{ matched: true }] : null, error: null }))
  mocks.capture.mockResolvedValue(photo)
  mocks.analyze.mockResolvedValue({ embedding: [1, 2], livenessScore: .8, antiSpoofScore: .9 })
  mocks.watermark.mockResolvedValue(stamped)
  mocks.upload.mockResolvedValue('student-1/meeting-1/photo.jpg')
  mocks.location.mockResolvedValue({ latitude: 13.387419, longitude: 121.162494, accuracyM: 9, capturedAt: '2026-10-23T06:00:00Z' })
})

describe('attendance self-check evidence workflow', () => {
  it('captures parent-only online location without an ID or coordinates printed in the photo', async () => {
    const wrapper = render()
    await flushPromises()
    expect(wrapper.text()).not.toContain('Scan your school ID')
    await clickText(wrapper, 'Open camera')
    await flushPromises()
    expect(wrapper.text()).toContain('Your teacher cannot view this location')
    await clickText(wrapper, 'Use current location')
    await flushPromises()
    expect(wrapper.find('img[alt="Timestamped attendance selfie ready for submission"]').attributes('src')).toBe('blob:stamped')
    await clickText(wrapper, 'Submit attendance')
    await flushPromises()
    expect(mocks.location).toHaveBeenCalledOnce()
    expect(mocks.watermark).toHaveBeenCalledWith(photo, { location: null })
    expect(mocks.upload).toHaveBeenCalledWith(stamped, 'student-1', 'meeting-1')
    expect(mocks.rpc).toHaveBeenCalledWith('submit_self_attendance', expect.objectContaining({ p_raw_barcode: null, p_latitude: 13.387419, p_longitude: 121.162494, p_accuracy_m: 9 }))
    expect(mocks.replace).toHaveBeenCalledWith('/student')
    wrapper.unmount()
  })

  it('blocks upload when the face does not match', async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === 'my_face_enrollment_status' ? [{ enrolled: true }] : [{ matched: false }], error: null }))
    const wrapper = render(); await flushPromises()
    await clickText(wrapper, 'Open camera'); await flushPromises()
    await clickText(wrapper, 'Use current location'); await flushPromises()
    await clickText(wrapper, 'Submit attendance'); await flushPromises()
    expect(wrapper.text()).toContain('Your face did not match')
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.replace).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('offers face enrollment before collecting attendance evidence when it is missing', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ enrolled: false }], error: null })
    const wrapper = render(); await flushPromises()
    expect(wrapper.text()).toContain('Set up face verification first')
    expect(wrapper.text()).not.toContain('Submit attendance')
    expect(mocks.capture).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('blocks online submission when location permission is denied', async () => {
    mocks.location.mockRejectedValue(new Error('Location permission was denied.'))
    const wrapper = render(); await flushPromises()
    await clickText(wrapper, 'Open camera'); await flushPromises()
    await clickText(wrapper, 'Use current location'); await flushPromises()
    expect(wrapper.text()).toContain('Location permission was denied')
    expect(wrapper.text()).not.toContain('Ready to submit')
    expect(mocks.upload).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('allows online location outside the school and never watermarks its coordinates', async () => {
    mocks.location.mockResolvedValue({ latitude: 14.5995, longitude: 120.9842, accuracyM: 1200 })
    const wrapper = render(); await flushPromises()
    await clickText(wrapper, 'Open camera'); await flushPromises()
    await clickText(wrapper, 'Use current location'); await flushPromises()
    await clickText(wrapper, 'Submit attendance'); await flushPromises()
    expect(mocks.watermark).toHaveBeenLastCalledWith(photo, { location: null })
    expect(mocks.rpc).toHaveBeenCalledWith('submit_self_attendance', expect.objectContaining({ p_latitude: 14.5995, p_accuracy_m: 1200 }))
    wrapper.unmount()
  })

  it('does not request another selfie for an already recorded meeting', async () => {
    mocks.meeting.mockResolvedValue({ data: { id: 'meeting-1', existing_status: 'present' }, error: null })
    const wrapper = render(); await flushPromises()
    expect(wrapper.text()).toContain('Attendance has already been submitted')
    expect(wrapper.text()).not.toContain('Take a clear selfie')
    expect(mocks.capture).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('stamps on-site coordinates and keeps the same upload when submission is retried', async () => {
    mocks.meeting.mockResolvedValue({ data: { id: 'meeting-1', class_name: 'ITE 412', title: 'On-site', attendance_mode: 'self_on_site', attendance_closes_at: '2030-01-01T06:00:00Z', max_accuracy_m: 100, existing_status: null }, error: null })
    let submissions = 0
    mocks.rpc.mockImplementation(async name => {
      if (name === 'submit_self_attendance' && ++submissions === 1) return { error: { message: 'Connection interrupted. Try again.' } }
      return { data: name === 'my_face_enrollment_status' ? [{ enrolled: true }] : [{ matched: true }], error: null }
    })
    const wrapper = render(); await flushPromises()
    await clickText(wrapper, 'Scan with camera'); await flushPromises()
    await clickText(wrapper, 'Open camera'); await flushPromises()
    await clickText(wrapper, 'Use current location'); await flushPromises()
    expect(mocks.watermark).toHaveBeenCalledWith(photo, { location: expect.objectContaining({ latitude: 13.387419, longitude: 121.162494 }) })
    await clickText(wrapper, 'Submit attendance'); await flushPromises()
    expect(wrapper.text()).toContain('Connection interrupted')
    await clickText(wrapper, 'Submit attendance'); await flushPromises()
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenLastCalledWith('submit_self_attendance', expect.objectContaining({ p_raw_barcode: 'school-code', p_latitude: 13.387419, p_accuracy_m: 9 }))
    expect(mocks.replace).toHaveBeenCalledWith('/student')
    wrapper.unmount()
  })
})
