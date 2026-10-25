import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import TeacherPage from '@/views/TeacherPage.vue'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), route: { query: { section: 'overview' } },
  profile: { value: { id: 'teacher-1', role: 'teacher', full_name: 'TEACHER ONE', teacher_approval_status: 'approved' } }, push: vi.fn(), refresh: vi.fn() }))
vi.mock('@ionic/vue', async original => ({ ...await original<typeof import('@ionic/vue')>(), onIonViewWillEnter: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, auth: { getUser: async () => ({ data: { user: { id: 'teacher-1' } }, error: null }) } } }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ initializeSession: async () => {}, refreshProfile: mocks.refresh, profile: mocks.profile, signOut: vi.fn() }) }))
vi.mock('@/composables/useRealtimeRefresh', () => ({ useRealtimeRefresh: vi.fn() }))
vi.mock('/minsu-logo.png', () => ({ default: '/minsu-logo.png' }))
vi.mock('@/components/PortalHeader.vue', () => ({ default: { template: '<header />' } }))
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }))
const slot = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const dialog = defineComponent({ props: ['open'], setup: (props, { slots }) => () => props.open ? h('section', slots.default?.()) : null })
const classes = [{ id: 'class-1', teacher_id: 'teacher-1', name: 'INTEGRATION', join_code: 'SYS412', archived_at: null }, { id: 'class-2', teacher_id: 'teacher-1', name: 'DATABASES', join_code: 'DBA204', archived_at: null }]
const schedules = classes.map((course, index) => ({ id: `schedule-${index}`, class_id: course.id, day_of_week: 1, starts_at: index ? '10:00:00' : '08:00:00', ends_at: index ? '11:00:00' : '09:00:00', is_active: true, room: 'ROOM 1', attendance_mode: 'teacher_manual', check_in_minutes_after_start: null }))
const meeting = { id: 'meeting-1', class_id: 'class-1', schedule_id: 'schedule-0', starts_at: '2026-10-26T00:00:00Z', ends_at: '2026-10-26T01:00:00Z', attendance_opens_at: '2026-10-26T00:00:00Z', attendance_closes_at: '2026-10-26T01:00:00Z', attendance_enabled: true, attendance_mode: 'teacher_manual' }
const students = [{ id: 'student-1', first_name: 'ALICE', last_name: 'ZULU', full_name: 'ALICE ZULU', email: 'alice@example.test' }, { id: 'student-2', first_name: 'BOB', last_name: 'ALPHA', full_name: 'BOB ALPHA', email: 'bob@example.test' }]
function query(table: string) {
  const filters: Record<string, unknown> = {}
  const builder = { select: () => builder, order: () => builder, maybeSingle: () => builder,
    eq: (key: string, value: unknown) => { filters[key] = value; return builder }, in: () => builder, gte: () => builder, lt: () => builder,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve().then(() => {
      const data = table === 'classes' ? classes : table === 'class_schedules' ? schedules.filter(row => !filters.class_id || row.class_id === filters.class_id) : table === 'meetings' ? [meeting] : table === 'class_enrollments' ? students.map(row => ({ student_id: row.id })) : table === 'profiles' ? students : []
      return resolve({ data, error: null })
    }) }
  return builder
}
function render(section: string) {
  mocks.route.query.section = section
  return shallowMount(TeacherPage, { global: { stubs: { IonPage: slot, IonContent: slot, IonCard: slot, IonCardContent: slot,
    IonSelect: { props: ['label'], template: '<label>{{ label }}<slot /></label>' }, IonSelectOption: slot, IonNote: slot, IonBadge: slot,
    IonButton: { props: ['fill', 'color'], template: '<button :data-fill="fill" :data-color="color"><slot /></button>' },
    AppModal: dialog, PortalHeader: { template: '<header />' }, ScheduleCalendar: { template: '<div data-calendar>CLASS CALENDAR</div>' },
    EvidenceDetailModal: { template: '<aside />' }, StudentGuardianModal: { template: '<aside />' }, InviteParentModal: { template: '<aside />' }, ClassAttendanceReportModal: { template: '<aside />' } } } })
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-26T00:30:00Z'))
  mocks.from.mockImplementation(query); mocks.rpc.mockResolvedValue({ data: [], error: null }); mocks.refresh.mockResolvedValue(mocks.profile.value)
})
afterEach(() => vi.useRealTimers())
describe('teacher workspace refinements', () => {
  it('overview contains only the current and next class, without class selectors or attendance totals', async () => {
    const wrapper = render('overview'); await flushPromises()
    expect(wrapper.text()).toContain('Happening now'); expect(wrapper.text()).toContain('INTEGRATION')
    expect(wrapper.text()).toContain('Up next'); expect(wrapper.text()).toContain('DATABASES')
    expect(wrapper.find('.workspace-switcher').exists()).toBe(false)
    expect(wrapper.find('.stats-grid').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Weekly schedule'); expect(wrapper.text()).not.toContain('Additional meeting')
    wrapper.unmount()
  })
  it('puts weekly schedules, additional meetings and reports on Classes', async () => {
    const wrapper = render('classes'); await flushPromises()
    expect(wrapper.text()).toContain('Weekly schedule'); expect(wrapper.text()).toContain('Additional meeting')
    expect(wrapper.text()).toContain('PDF / CSV reports')
    const deletion = wrapper.findAll('button').filter(button => /^(Delete|Delete class)$/.test(button.text()))
    expect(deletion.length).toBeGreaterThan(0)
    expect(deletion.every(button => button.attributes('data-fill') === 'outline')).toBe(true)
    wrapper.unmount()
  })
  it('leaves Calendar free of planning forms', async () => {
    const wrapper = render('schedules'); await flushPromises()
    expect(wrapper.find('[data-calendar]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Additional meeting'); expect(wrapper.find('.planning-section').exists()).toBe(false)
    wrapper.unmount()
  })
  it('has one meeting selector and lists students by last name', async () => {
    const wrapper = render('attendance'); await flushPromises()
    expect(wrapper.text().match(/Meeting in selected week/g)).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Mark missing check-ins manually')
    expect(wrapper.findAll('.student-copy strong').map(row => row.text())).toEqual(['ALPHA, BOB', 'ZULU, ALICE'])
    wrapper.unmount()
  })
})
