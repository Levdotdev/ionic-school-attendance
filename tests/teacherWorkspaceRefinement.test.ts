import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, reactive } from 'vue'
import TeacherPage from '@/views/TeacherPage.vue'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), route: { query: { section: 'overview' } },
  profile: { value: { id: 'teacher-1', role: 'teacher', full_name: 'TEACHER ONE', teacher_approval_status: 'approved' } }, push: vi.fn(), refresh: vi.fn(), alertCreate: vi.fn() }))
vi.mock('@ionic/vue', async original => ({ ...await original<typeof import('@ionic/vue')>(), onIonViewWillEnter: vi.fn(), alertController: { create: mocks.alertCreate } }))
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
let fixtureClasses = [...classes]
let fixtureSchedules = [...schedules]
let fixtureMeetings: Array<Omit<typeof meeting, 'schedule_id'> & { schedule_id: string | null }> = [meeting]
let fixtureEnrollments: Array<{ class_id: string; student_id: string; is_active: boolean }> = []
let fixtureAttendance: Array<{ id: string; meeting_id: string; student_id: string; status: string; source: string; verification_status: string | null }> = []
function query(table: string) {
  const filters: Record<string, unknown> = {}
  let deleting = false
  const minimums: Record<string, string> = {}, maximums: Record<string, string> = {}
  const builder = { select: () => builder, order: () => builder, maybeSingle: () => builder, delete: () => { deleting = true; return builder },
    eq: (key: string, value: unknown) => { filters[key] = value; return builder }, in: (key: string, values: unknown[]) => { filters[key] = values; return builder },
    gte: (key: string, value: string) => { minimums[key] = value; return builder }, lt: (key: string, value: string) => { maximums[key] = value; return builder },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve().then(() => {
      if (deleting && table === 'class_schedules') {
        fixtureSchedules = fixtureSchedules.filter(row => row.id !== filters.id)
        fixtureMeetings = fixtureMeetings.filter(row => row.schedule_id !== filters.id)
        return resolve({ data: null, error: null })
      }
      const rows = table === 'classes' ? fixtureClasses : table === 'class_schedules' ? fixtureSchedules : table === 'meetings' ? fixtureMeetings : table === 'class_enrollments' ? fixtureEnrollments : table === 'profiles' ? students : table === 'attendance_records' ? fixtureAttendance : []
      const data = rows.filter(row => Object.entries(filters).every(([key, value]) => {
        if (!(key in row)) return true
        const actual = (row as Record<string, unknown>)[key]
        return Array.isArray(value) ? value.includes(actual) : actual === value
      }) && Object.entries(minimums).every(([key, value]) => new Date((row as Record<string, string>)[key]).getTime() >= new Date(value).getTime())
        && Object.entries(maximums).every(([key, value]) => new Date((row as Record<string, string>)[key]).getTime() < new Date(value).getTime()))
      return resolve({ data, error: null })
    }) }
  return builder
}
function render(section: string) {
  mocks.route.query.section = section
  return shallowMount(TeacherPage, { global: { stubs: { IonPage: slot, IonContent: slot, IonCard: slot, IonCardContent: slot,
    IonSelect: { props: ['label'], template: '<label>{{ label }}<slot /></label>' }, IonSelectOption: slot, IonNote: slot, IonBadge: slot,
    IonButton: { props: ['fill', 'color'], template: '<button :data-fill="fill" :data-color="color"><slot /></button>' },
    AppModal: dialog, PortalHeader: { template: '<header />' }, ScheduleCalendar: { name: 'ScheduleCalendar', template: '<div data-calendar>CLASS CALENDAR</div>' },
    EvidenceDetailModal: { template: '<aside />' }, StudentGuardianModal: { template: '<aside />' }, InviteParentModal: { template: '<aside />' }, ClassAttendanceReportModal: { template: '<aside />' } } } })
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-26T00:30:00Z'))
  mocks.route = reactive({ query: { section: 'overview' } })
  fixtureClasses = [...classes]; fixtureSchedules = [...schedules]; fixtureMeetings = [meeting]
  fixtureEnrollments = classes.flatMap(course => students.map(student => ({ class_id: course.id, student_id: student.id, is_active: true })))
  fixtureAttendance = []
  mocks.from.mockImplementation(query); mocks.rpc.mockResolvedValue({ data: [], error: null }); mocks.refresh.mockResolvedValue(mocks.profile.value)
  mocks.alertCreate.mockResolvedValue({ present: async () => {}, onDidDismiss: async () => ({ role: 'confirm' }) })
})
afterEach(() => vi.useRealTimers())
describe('teacher workspace refinements', () => {
  it('restores overview context for the current class even when a different workspace is selected', async () => {
    fixtureClasses.reverse()
    fixtureMeetings.push({ ...meeting, id: 'disabled', schedule_id: 'schedule-extra', starts_at: '2026-10-28T00:00:00Z', ends_at: '2026-10-28T01:00:00Z', attendance_enabled: false })
    fixtureEnrollments.push({ class_id: 'class-1', student_id: 'student-3', is_active: true })
    fixtureAttendance = [
      { id: 'present', meeting_id: 'meeting-1', student_id: 'student-1', status: 'present', source: 'teacher', verification_status: null },
      { id: 'absent', meeting_id: 'meeting-1', student_id: 'student-2', status: 'absent', source: 'teacher', verification_status: null },
      { id: 'void', meeting_id: 'meeting-1', student_id: 'former-student', status: 'present', source: 'self_check', verification_status: 'rejected' },
    ]
    const wrapper = render('overview'); await flushPromises()
    expect(wrapper.find('[data-overview-occurrence]').text()).toContain('Happening now')
    expect(wrapper.find('[data-overview-occurrence]').text()).toContain('INTEGRATION')
    expect(wrapper.text()).not.toContain('Up next'); expect(wrapper.text()).not.toContain('DATABASES')
    expect(wrapper.find('.workspace-switcher').exists()).toBe(false)
    expect(wrapper.find('[data-overview-present]').text()).toBe('1'); expect(wrapper.find('[data-overview-absent]').text()).toBe('1')
    expect(wrapper.find('[data-overview-unchecked]').text()).toBe('1'); expect(wrapper.find('[data-overview-voided]').text()).toBe('1')
    expect(wrapper.find('[data-overview-class]').text()).toContain('3 enrolled students')
    expect(wrapper.find('[data-overview-class]').text()).toContain('SYS412'); expect(wrapper.find('[data-overview-class]').text()).not.toContain('DBA204')
    expect(wrapper.find('[data-overview-plan] .overview-meeting-count').text()).toBe('2')
    expect(wrapper.find('[data-overview-plan]').text()).toContain('1 count attendance.')
    expect(wrapper.find('.week-chip').text()).toContain('This school week')
    expect(wrapper.text()).not.toContain('Weekly schedule'); expect(wrapper.text()).not.toContain('Additional meeting')
    wrapper.unmount()
  })
  it('uses only the next class and its roster once no class is in progress', async () => {
    vi.setSystemTime(new Date('2026-10-26T01:30:00Z'))
    fixtureMeetings.push({ ...meeting, id: 'next', class_id: 'class-2', schedule_id: 'schedule-1', starts_at: '2026-10-26T02:00:00Z', ends_at: '2026-10-26T03:00:00Z' })
    const wrapper = render('overview'); await flushPromises()
    expect(wrapper.find('[data-overview-occurrence]').text()).toContain('Up next')
    expect(wrapper.find('[data-overview-occurrence]').text()).toContain('DATABASES')
    expect(wrapper.text()).not.toContain('Happening now')
    expect(wrapper.find('[data-overview-class]').text()).toContain('DBA204')
    expect(wrapper.find('[data-overview-present]').text()).toBe('0')
    expect(wrapper.find('[data-overview-unchecked]').text()).toBe('2')
    expect(wrapper.find('[data-overview-plan] .overview-meeting-count').text()).toBe('1')
    wrapper.unmount()
  })
  it('returns from an older calendar week to the actual school week and current occurrence', async () => {
    const wrapper = render('schedules'); await flushPromises()
    wrapper.findComponent({ name: 'ScheduleCalendar' }).vm.$emit('date-change', '2026-10-12'); await flushPromises()
    expect(wrapper.find('.week-chip').text()).toContain('Selected school week')
    mocks.route.query.section = 'overview'; await flushPromises()
    expect(wrapper.find('.week-chip').text()).toContain('This school week')
    expect(wrapper.find('.week-chip').text()).toContain('Oct 26')
    expect(wrapper.find('[data-overview-occurrence]').text()).toContain('INTEGRATION')
    expect(wrapper.find('[data-overview-plan] .overview-meeting-count').text()).toBe('1')
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
  it('warns that deleting a weekly schedule removes generated history and reloads the remaining independent meetings', async () => {
    fixtureMeetings.push({ ...meeting, id: 'additional', schedule_id: null, starts_at: '2026-10-28T00:00:00Z', ends_at: '2026-10-28T01:00:00Z' })
    const wrapper = render('classes'); await flushPromises()
    await wrapper.findAll('.schedule-row button').find(button => button.text() === 'Delete')!.trigger('click'); await flushPromises()
    expect(mocks.alertCreate.mock.calls[0][0].message).toContain('past, current, and future')
    expect(mocks.alertCreate.mock.calls[0][0].message).toContain('recorded attendance and photos')
    expect(mocks.alertCreate.mock.calls[0][0].message).toContain('Independent additional meetings are kept')
    mocks.route.query.section = 'attendance'; await flushPromises()
    expect(wrapper.find('.week-overview .count-bubble').text()).toBe('1')
    expect(wrapper.findAll('.mini-meeting')).toHaveLength(1)
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
