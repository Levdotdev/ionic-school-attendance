import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import StudentPage from '@/views/StudentPage.vue'
import StudentHistoryPanel from '@/components/StudentHistoryPanel.vue'
import StudentSchedulePanel from '@/components/StudentSchedulePanel.vue'
import { makeStudentCalendarEvents, type StudentWeeklySchedule } from '@/utils/studentScheduleCalendar'
import type { StudentTask } from '@/types/studentTasks'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), push: vi.fn(), loadTasks: vi.fn(), realtime: vi.fn(),
  profile: { value: { id: 'student-1', full_name: 'Student One', role: 'student' } }, user: { value: { id: 'student-1' } },
  route: { query: { section: 'overview' } }, enter: [] as Array<() => unknown>,
}))
vi.mock('@ionic/vue', async original => ({ ...await original<typeof import('@ionic/vue')>(), onIonViewWillEnter: (cb: () => unknown) => { mocks.enter.push(cb) } }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, rpc: (...args: unknown[]) => {
  const result = mocks.rpc(...args)
  const builder = { order: () => builder, range: () => builder, then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject) }
  return builder
} } }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ profile: mocks.profile, user: mocks.user, initializeSession: async () => {}, refreshProfile: async () => mocks.profile.value, signOut: async () => {} }) }))
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ push: mocks.push, replace: vi.fn() }) }))
vi.mock('@/composables/useRealtimeRefresh', () => ({ useRealtimeRefresh: mocks.realtime }))
vi.mock('@/services/studentTasks', () => ({ loadStudentTaskData: mocks.loadTasks }))
vi.mock('@/services/barcode', () => ({ scanStudentBarcode: vi.fn() }))
vi.mock('@/components/PortalHeader.vue', () => ({ default: { template: '<header />' } }))
vi.mock('@/components/FaceEnrollmentModal.vue', () => ({ default: { template: '<aside />' } }))
vi.mock('@/components/EvidenceDetailModal.vue', () => ({ default: { props: ['record', 'studentName'], template: '<aside />' } }))

interface Query { table: string; action: string; filters: Record<string, unknown>; payload?: unknown }
type Result = { data: unknown; error: { message: string } | null }
let handler: (query: Query) => Result = () => ({ data: [], error: null })
function query(table: string) {
  const state: Query = { table, action: 'select', filters: {} }
  const builder = {
    select: () => builder, order: () => builder, maybeSingle: () => builder, single: () => builder,
    eq: (key: string, value: unknown) => { state.filters[key] = value; return builder },
    in: (key: string, value: unknown) => { state.filters[key] = value; return builder },
    gte: (key: string, value: unknown) => { state.filters[`${key}:gte`] = value; return builder },
    lt: (key: string, value: unknown) => { state.filters[`${key}:lt`] = value; return builder },
    upsert: (payload: unknown) => { state.action = 'upsert'; state.payload = payload; return builder },
    then: <T, U>(resolve: (result: Result) => T, reject?: (reason: unknown) => U) => Promise.resolve().then(() => handler(state)).then(resolve, reject),
  }
  return builder
}
const slot = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const dialog = defineComponent({ props: { open: Boolean }, setup: (props, { slots }) => () => props.open ? h('section', [slots.default?.(), slots.actions?.()]) : null })
function state(wrapper: ReturnType<typeof shallowMount>) { return (wrapper.vm as unknown as { $: { setupState: Record<string, any> } }).$.setupState }
const schedule: StudentWeeklySchedule = { id: 'schedule-1', class_id: 'course-1', day_of_week: 1, starts_at: '09:00:00', ends_at: '10:00:00', room: 'Room 4', is_active: true }
const course = { id: 'course-1', name: 'System Integration', archived_at: null }
function task(): StudentTask { return { id: 'task-1', student_id: 'student-1', class_id: 'course-1', category_id: null, title: 'Weekly exercise', description: '', due_at: '2026-10-19T02:00:00Z', priority: 'medium', recurrence: 'weekly', recurrence_until: null, reminder_minutes: [], sort_order: 0, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', course: { ...course, section: null }, category: null, links: [], files: [], occurrences: [] } }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.route.query.section = 'overview'
  mocks.enter.length = 0
  mocks.from.mockImplementation(query)
  mocks.rpc.mockResolvedValue({ data: [], error: null })
  mocks.loadTasks.mockResolvedValue({ tasks: [], courses: [], categories: [] })
  handler = () => ({ data: [], error: null })
})

describe('combined student calendar', () => {
  it('combines recurring tasks with weekly classes and respects cancelled, deleted and archived classes', () => {
    const events = makeStudentCalendarEvents({
      courses: [course, { id: 'archived', name: 'Archived course', archived_at: '2026-10-01T00:00:00Z' }],
      schedules: [schedule, { ...schedule, id: 'deleted', day_of_week: 2 }, { ...schedule, id: 'archived-schedule', class_id: 'archived', day_of_week: 3 }],
      meetings: [{ id: 'actual', class_id: course.id, schedule_id: schedule.id, schedule_week_start: '2026-10-26', meeting_date: '2026-10-26', starts_at: '2026-10-26T01:00:00Z', ends_at: '2026-10-26T02:00:00Z', attendance_enabled: false }],
      exceptions: [{ schedule_id: 'deleted', schedule_week_start: '2026-10-26' }], tasks: [task()], range: { start: '2026-10-26', end: '2026-11-02' }, now: new Date('2026-10-24T00:00:00Z'),
    })
    expect(events).toHaveLength(2)
    expect(events.find(e => e.meetingId === 'actual')?.status).toBe('not_counted')
    expect(events.find(e => e.taskId === 'task-1')?.start).toBe('2026-10-26T02:00:00.000Z')
    expect(events.some(e => e.kind === 'weekly')).toBe(false)
  })

  it('projects an untouched class at the exact Manila time and excludes task occurrences outside the visible range', () => {
    const events = makeStudentCalendarEvents({ courses: [course], schedules: [schedule], meetings: [], exceptions: [], tasks: [task()], range: { start: '2026-11-02', end: '2026-11-09' } })
    expect(events.find(e => e.kind === 'weekly')?.start).toBe('2026-11-02T09:00:00+08:00')
    expect(events.filter(e => e.kind === 'task')).toHaveLength(1)
  })
})

describe('student course reminder preferences', () => {
  function prepare() {
    const writes: Query[] = []
    handler = q => {
      if (q.action === 'upsert') { writes.push(q); return { data: null, error: null } }
      if (q.table === 'class_schedules') return { data: [schedule], error: null }
      if (q.table === 'student_schedule_notification_preferences') return { data: [{ schedule_id: schedule.id, reminder_minutes: [5, 0] }], error: null }
      return { data: [], error: null }
    }
    return writes
  }
  it('persists a student’s selected times and supports turning one weekly schedule off', async () => {
    const writes = prepare()
    const wrapper = shallowMount(StudentSchedulePanel, { props: { studentId: 'student-1', courses: [course] } })
    await flushPromises()
    const vm = state(wrapper)
    vm.openReminders(schedule)
    expect(vm.draftOffsets).toEqual([5, 0])
    vm.draftOffsets = [15, 0, 15]
    await vm.saveReminders()
    expect(writes[0].payload).toEqual({ student_id: 'student-1', schedule_id: 'schedule-1', reminder_minutes: [15, 0] })
    expect(vm.editingSchedule).toBeNull()
    vm.openReminders(schedule)
    vm.draftOffsets = []
    await vm.saveReminders()
    expect(writes[1].payload).toEqual({ student_id: 'student-1', schedule_id: 'schedule-1', reminder_minutes: [] })
    expect(vm.reminderSummary(schedule.id)).toBe('Reminders off')
    wrapper.unmount()
  })
  it('opens task details from the exact calendar occurrence and refetches on live changes', async () => {
    prepare()
    mocks.loadTasks.mockResolvedValue({ tasks: [task()], courses: [course], categories: [] })
    const wrapper = shallowMount(StudentSchedulePanel, { props: { studentId: 'student-1', courses: [course] } })
    await flushPromises()
    const vm = state(wrapper)
    vm.changeRange({ start: '2026-10-26', end: '2026-11-02' })
    await flushPromises()
    const event = vm.calendarEvents.find((e: { taskId?: string }) => e.taskId)
    vm.selectEvent(event)
    expect(mocks.push).toHaveBeenCalledWith({ path: '/student/tasks', query: { task: 'task-1', due: '2026-10-26T02:00:00.000Z' } })
    await mocks.realtime.mock.calls[0][0].onChange()
    expect(mocks.loadTasks).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })
})

describe('student attendance history and face access', () => {
  it('shows present, absent and not-counted history with evidence inside attendance and strips online coordinates', async () => {
    mocks.rpc.mockResolvedValue({ data: [
      { id: 'present', class_id: course.id, student_id: 'student-1', status: 'present', attendance_enabled: true, class_name: course.name, meeting_starts_at: '2026-10-23T01:00:00Z', attendance_mode: 'self_online', latitude: 1, longitude: 2, distance_m: 3, selfie_path: 'photo.jpg', verification_status: 'approved' },
      { id: 'absent', class_id: course.id, student_id: 'student-1', status: 'absent', attendance_enabled: true, class_name: course.name, meeting_starts_at: '2026-10-22T01:00:00Z', attendance_mode: 'teacher_manual', is_inferred: true },
      { id: 'disabled', class_id: course.id, student_id: 'student-1', status: 'absent', attendance_enabled: false, class_name: course.name, meeting_starts_at: '2026-10-21T01:00:00Z', attendance_mode: 'teacher_manual', is_inferred: true },
    ], error: null })
    const wrapper = mount(StudentHistoryPanel, { props: { studentId: 'student-1', studentName: 'Student One' }, global: { stubs: { IonSpinner: slot, IonIcon: slot } } })
    await flushPromises()
    expect(wrapper.findAll('.history-row')).toHaveLength(3)
    expect(wrapper.text()).toContain('Present')
    expect(wrapper.text()).toContain('Absent')
    expect(wrapper.text()).toContain('Not counted')
    await wrapper.findAll('.history-row')[0].trigger('click')
    expect(state(wrapper).selected).toMatchObject({ id: 'present', latitude: null, longitude: null, distance_m: null })
    await wrapper.findAll('select')[1].setValue('absent')
    expect(wrapper.findAll('.history-row')).toHaveLength(1)
    expect(wrapper.text()).toContain(course.name)
    expect(wrapper.text()).toContain('Oct 22')
    wrapper.unmount()
  })
  it('removes submitted self-checks from availability and exposes retake only after admin permission', async () => {
    handler = q => {
      if (q.table === 'student_profiles') return { data: { registration_completed_at: '2026-10-01', guardian_email: 'parent@example.invalid' }, error: null }
      if (q.table === 'student_available_meetings') return { data: [{ id: 'done', existing_status: 'present', submitted_at: '2026-10-24' }, { id: 'open', existing_status: null, submitted_at: null }, { id: 'next', existing_status: null, submitted_at: null }], error: null }
      return { data: [], error: null }
    }
    mocks.rpc.mockResolvedValue({ data: [{ is_enrolled: true, can_retake: false }], error: null })
    const wrapper = shallowMount(StudentPage)
    await flushPromises()
    const vm = state(wrapper)
    expect(vm.meetings.map((m: { id: string }) => m.id)).toEqual(['open'])
    expect(vm.faceEnrollmentOpen).toBe(false)
    expect(vm.faceRetakeAllowed).toBe(false)
    mocks.rpc.mockResolvedValue({ data: [{ is_enrolled: true, can_retake: true }], error: null })
    await vm.loadFaceEnrollmentStatus()
    expect(vm.faceRetakeAllowed).toBe(true)
    await vm.handleFaceEnrolled()
    expect(vm.faceRetakeAllowed).toBe(false)
    wrapper.unmount()
  })
})

describe('student parent consent', () => {
  function readyStudent() {
    handler = q => q.table === 'student_profiles'
      ? { data: { registration_completed_at: '2026-10-01', guardian_email: null }, error: null }
      : { data: [], error: null }
  }
  it('blocks joining until a registered parent approves, and reacts to approval updates', async () => {
    readyStudent()
    let status = 'pending'
    mocks.rpc.mockImplementation(async (name: string) => ({ data: name === 'student_guardian_summary'
      ? [{ request_id: 'link-1', parent_id: 'parent-1', parent_name: 'Parent One', parent_email: 'parent@example.test', status }]
      : name === 'my_face_enrollment_access' ? [{ is_enrolled: true, can_retake: false }] : { name: course.name }, error: null }))
    const wrapper = shallowMount(StudentPage)
    await flushPromises()
    const vm = state(wrapper)
    vm.openJoinModal()
    expect(vm.guardianModalOpen).toBe(true)
    expect(vm.joinModalOpen).toBe(false)
    vm.joinCode = 'SYS412'
    await vm.joinClass()
    expect(mocks.rpc.mock.calls.some(call => call[0] === 'join_class')).toBe(false)
    status = 'approved'
    await mocks.realtime.mock.calls[0][0].onChange()
    vm.openJoinModal()
    expect(vm.joinModalOpen).toBe(true)
    await vm.joinClass()
    expect(mocks.rpc).toHaveBeenCalledWith('join_class', { p_join_code: 'SYS412' })
    wrapper.unmount()
  })
  it('shows a registered-parent validation error without granting enrollment access', async () => {
    readyStudent()
    mocks.rpc.mockImplementation(async (name: string) => name === 'request_student_parent_link'
      ? { data: null, error: { message: 'This email is not a registered, verified parent. Invite the parent to register first.' } }
      : { data: [], error: null })
    const wrapper = shallowMount(StudentPage)
    await flushPromises()
    const vm = state(wrapper)
    vm.parentLinkEmail = 'unregistered@example.test'
    await vm.requestParentLink()
    expect(vm.guardianError).toBe(true)
    expect(vm.guardianMessage).toContain('not a registered')
    expect(vm.hasApprovedParent).toBe(false)
    wrapper.unmount()
  })
  it('fails closed when parent permissions cannot be loaded', async () => {
    readyStudent()
    mocks.rpc.mockImplementation(async (name: string) => ({ data: [], error: name === 'student_guardian_summary' ? { message: 'Unable to load consent' } : null }))
    const wrapper = shallowMount(StudentPage)
    await flushPromises()
    const vm = state(wrapper)
    expect(vm.hasApprovedParent).toBe(false)
    expect(vm.pageMessage).toContain('Unable to load consent')
    wrapper.unmount()
  })
})
