import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ClassAttendanceReportModal from '@/components/ClassAttendanceReportModal.vue'
import type { ClassAttendanceReport } from '@/services/classAttendanceReport'

const mocks = vi.hoisted(() => ({ load: vi.fn(), download: vi.fn(), pdf: vi.fn(), assets: vi.fn() }))
const profile = ref({ id: 'teacher-1', role: 'teacher', teacher_approval_status: 'approved' })
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ profile }) }))
vi.mock('@/composables/useRealtimeRefresh', () => ({ useRealtimeRefresh: vi.fn() }))
vi.mock('@/services/classAttendanceReport', async original => ({ ...await original<typeof import('@/services/classAttendanceReport')>(), loadClassAttendanceReport: mocks.load, downloadAttendanceBlob: mocks.download }))
vi.mock('@/services/classAttendancePdf', () => ({ buildClassAttendancePdf: mocks.pdf, loadAttendancePdfAssets: mocks.assets }))
vi.mock('@ionic/vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { IonSpinner: { template: '<span />' }, IonButton: defineComponent({ props: ['disabled'], setup: (props, { slots }) => () => h('button', { disabled: props.disabled }, slots.default?.()) }) }
})
vi.mock('@/components/AppModal.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ props: ['open'], setup: (props, { slots }) => () => props.open ? h('section', [slots.default?.(), slots.actions?.()]) : null }) }
})
const data = (id = 'class-1'): ClassAttendanceReport => ({ class_id: id, class_name: 'INTEGRATION', teacher_name: 'TEACHER ONE', as_of: '2026-10-25T00:00:00Z', meeting_count: 2,
  students: [{ student_id: 'student-1', first_name: 'MARÍA', last_name: 'PEÑA', full_name: 'MARÍA PEÑA', is_active: true, present_count: 1, absent_count: 1, total_count: 2, attendance_rate: 50 }],
  totals: { student_count: 1, present_count: 1, absent_count: 1, total_count: 2, attendance_rate: 50 } })
function pending<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(done => { resolve = done }), resolve: (value: T) => resolve(value) } }
beforeEach(() => {
  vi.clearAllMocks(); profile.value = { id: 'teacher-1', role: 'teacher', teacher_approval_status: 'approved' }
  mocks.load.mockResolvedValue(data()); mocks.assets.mockResolvedValue({}); mocks.pdf.mockResolvedValue(new Uint8Array([1, 2, 3]))
})
describe('teacher cumulative report dialog', () => {
  it('loads class-wide totals and downloads the verified snapshot as CSV', async () => {
    const wrapper = mount(ClassAttendanceReportModal, { props: { open: true, classId: 'class-1' } }); await flushPromises()
    expect(wrapper.text()).toContain('PEÑA, MARÍA'); expect(wrapper.text()).toContain('50.00%')
    await wrapper.findAll('button').find(button => button.text() === 'Download CSV')!.trigger('click'); await flushPromises()
    expect(mocks.download).toHaveBeenCalledWith(expect.any(Blob), 'minsu-attendance-INTEGRATION-2026-10-25.csv', expect.any(Function))
    expect(mocks.pdf).not.toHaveBeenCalled(); wrapper.unmount()
  })
  it('disables downloads and explains an authorization failure', async () => {
    mocks.load.mockRejectedValue({ message: 'Only the owning teacher can access this report' })
    const wrapper = mount(ClassAttendanceReportModal, { props: { open: true, classId: 'class-1' } }); await flushPromises()
    expect(wrapper.text()).toContain('Only the owning teacher')
    const exportButtons = wrapper.findAll('button').filter(button => button.text().startsWith('Download'))
    expect(exportButtons.every(button => button.attributes('disabled') !== undefined)).toBe(true)
    expect(mocks.download).not.toHaveBeenCalled(); wrapper.unmount()
  })
  it('does not replace a newly selected class with a stale report response', async () => {
    const old = pending<ClassAttendanceReport>()
    mocks.load.mockImplementation((id: string) => id === 'class-1' ? old.promise : Promise.resolve({ ...data(id), class_name: 'DATABASES' }))
    const wrapper = mount(ClassAttendanceReportModal, { props: { open: true, classId: 'class-1' } })
    await wrapper.setProps({ classId: 'class-2' }); await flushPromises()
    expect(wrapper.text()).toContain('DATABASES')
    old.resolve(data()); await flushPromises()
    expect(wrapper.text()).toContain('DATABASES'); expect(wrapper.text()).not.toContain('INTEGRATION'); wrapper.unmount()
  })
  it('does not download a PDF if the signed-in account changes during generation', async () => {
    const pdf = pending<Uint8Array>(); mocks.pdf.mockReturnValue(pdf.promise)
    const wrapper = mount(ClassAttendanceReportModal, { props: { open: true, classId: 'class-1' } }); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === 'Download PDF')!.trigger('click'); await flushPromises()
    profile.value = { id: 'teacher-2', role: 'teacher', teacher_approval_status: 'approved' }; await flushPromises()
    pdf.resolve(new Uint8Array([1, 2, 3])); await flushPromises()
    expect(mocks.download).not.toHaveBeenCalled(); wrapper.unmount()
  })
})
