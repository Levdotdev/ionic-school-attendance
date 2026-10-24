import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { alertController } from '@ionic/vue'

import EvidenceDetailModal, { type EvidenceRecord } from '@/components/EvidenceDetailModal.vue'
import AppModal from '@/components/AppModal.vue'
import ParentCalendarPanel from '@/components/ParentCalendarPanel.vue'
import AdminPage from '@/views/AdminPage.vue'
import ParentPage from '@/views/ParentPage.vue'
import StudentPage from '@/views/StudentPage.vue'
import TeacherPage from '@/views/TeacherPage.vue'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), signedUrl: vi.fn(), getUser: vi.fn(),
  profile: { value: null as Record<string, unknown> | null },
  user: { value: { id: 'student-1' } },
  route: { query: { section: 'attendance' } },
  viewEnter: [] as Array<() => unknown>,
}))

vi.mock('@ionic/vue', async importOriginal => ({
  ...await importOriginal<typeof import('@ionic/vue')>(),
  onIonViewWillEnter: (callback: () => unknown) => { mocks.viewEnter.push(callback) },
}))

vi.mock('@/lib/supabase', () => ({ supabase: {
  from: mocks.from,
  rpc: (...args: unknown[]) => {
    const result = mocks.rpc(...args)
    const builder = { order: () => builder, range: () => builder, then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(result).then(resolve, reject) }
    return builder
  },
  auth: { getUser: mocks.getUser },
  storage: { from: () => ({ createSignedUrl: mocks.signedUrl }) },
} }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({
  profile: mocks.profile,
  user: mocks.user,
  initializeSession: async () => {},
  refreshProfile: async () => mocks.profile.value,
  signOut: async () => {},
}) }))
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }))
vi.mock('@/components/PortalHeader.vue', () => ({ default: { template: '<header />' } }))
vi.mock('@/components/FaceEnrollmentModal.vue', () => ({ default: { template: '<section />' } }))
vi.mock('@/services/barcode', () => ({ scanStudentBarcode: vi.fn() }))
vi.mock('@/composables/useRealtimeRefresh', () => ({ useRealtimeRefresh: vi.fn() }))

type Result = { data: unknown; error: { code?: string; message?: string } | null }
type QueryState = { table: string; filters: Record<string, unknown>; payload?: unknown; action: string }
let queryHandler: (state: QueryState) => Result | Promise<Result>

function query(table: string) {
  const state: QueryState = { table, filters: {}, action: 'select' }
  const builder = {
    select: () => builder,
    eq: (key: string, value: unknown) => { state.filters[key] = value; return builder },
    in: () => builder,
    gte: () => builder,
    lt: () => builder,
    lte: () => builder,
    order: () => builder,
    single: () => builder,
    maybeSingle: () => builder,
    insert: (payload: unknown) => { state.action = 'insert'; state.payload = payload; return builder },
    update: (payload: unknown) => { state.action = 'update'; state.payload = payload; return builder },
    delete: () => { state.action = 'delete'; return builder },
    then: <T, U>(resolve: (value: Result) => T, reject?: (reason: unknown) => U) =>
      Promise.resolve().then(() => queryHandler(state)).then(resolve, reject),
  }
  return builder
}

const dialogStub = defineComponent({
  props: { open: Boolean },
  setup: (props, { slots }) => () => props.open ? h('section', [slots.default?.(), slots.actions?.()]) : null,
})
const ionStub = defineComponent({ setup: (_, { slots }) => () => h('div', slots.default?.()) })
const evidenceStubs = {
  AppModal: dialogStub,
  IonBadge: ionStub,
  IonButton: ionStub,
  IonIcon: ionStub,
  IonSpinner: ionStub,
  IonTextarea: ionStub,
}

function record(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: 'record-1', status: 'present', verification_status: 'approved',
    selfie_path: 'student-1/meeting-1/selfie.jpg', latitude: 13.387419, longitude: 121.162494,
    distance_m: 16, submitted_at: '2026-10-24T01:05:00.000Z',
    meeting_starts_at: '2026-10-24T01:00:00.000Z',
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function setupState(wrapper: ReturnType<typeof shallowMount>) {
  return (wrapper.vm as unknown as { $: { setupState: Record<string, any> } }).$.setupState
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'))
  mocks.profile.value = { id: 'teacher-1', role: 'teacher', teacher_approval_status: 'approved', full_name: 'Teacher One' }
  mocks.route.query.section = 'attendance'
  mocks.viewEnter.length = 0
  mocks.getUser.mockResolvedValue({ data: { user: { id: 'teacher-1' } }, error: null })
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  mocks.signedUrl.mockResolvedValue({ data: { signedUrl: 'https://storage.test/private-signed-photo' }, error: null })
  mocks.from.mockImplementation(query)
  queryHandler = () => ({ data: [], error: null })
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('protected attendance evidence', () => {
  it('labels manual present attendance as teacher-confirmed inside school without inventing GPS', async () => {
    const wrapper = mount(EvidenceDetailModal, { props: { record: record({ selfie_path: null, latitude: null, longitude: null, distance_m: null, location_status: 'teacher_confirmed_on_campus' }), studentName: 'Student One' }, global: { stubs: evidenceStubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('Inside school · marked present by teacher (not a GPS reading)')
    expect(wrapper.find('a').exists()).toBe(false)
    wrapper.unmount()
  })
  it('loads an initially open photo using a short-lived signed URL and shows Manila time/location', async () => {
    const wrapper = mount(EvidenceDetailModal, { props: { record: record(), studentName: 'Student One' }, global: { stubs: evidenceStubs } })
    await flushPromises()
    expect(mocks.signedUrl).toHaveBeenCalledWith('student-1/meeting-1/selfie.jpg', 900)
    expect(wrapper.get('img').attributes('src')).toBe('https://storage.test/private-signed-photo')
    expect(wrapper.text()).toMatch(/9:05\s*AM/)
    expect(wrapper.get('a').attributes('href')).toBe('https://www.google.com/maps?q=13.387419,121.162494')
    wrapper.unmount()
  })

  it('does not show a previous student’s photo after switching records during a slow request', async () => {
    const first = deferred<{ data: { signedUrl: string }; error: null }>()
    mocks.signedUrl.mockReturnValueOnce(first.promise)
    const wrapper = mount(EvidenceDetailModal, { props: { record: record(), studentName: 'First Student' }, global: { stubs: evidenceStubs } })
    await wrapper.setProps({ record: record({ id: 'record-2', selfie_path: 'student-2/photo.jpg' }), studentName: 'Second Student' })
    await flushPromises()
    first.resolve({ data: { signedUrl: 'https://storage.test/first-student' }, error: null })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('https://storage.test/private-signed-photo')
    expect(wrapper.get('img').attributes('alt')).toContain('Second Student')
    wrapper.unmount()
  })

  it('keeps rejected photos private and reports storage errors inside the modal', async () => {
    mocks.signedUrl.mockResolvedValue({ data: null, error: { message: 'You do not have access to this photo.' } })
    const wrapper = mount(EvidenceDetailModal, { props: { record: record({ selfie_url: 'https://public.test/should-not-be-used', attendance_enabled: false }), studentName: 'Student One' }, global: { stubs: evidenceStubs } })
    await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('You do not have access to this photo.')
    expect(wrapper.text()).toContain('Meeting not counted')
    wrapper.unmount()
  })

  it('keeps a teacher note draft and the current signed photo when the same attendance record updates', async () => {
    const wrapper = mount(EvidenceDetailModal, { props: { record: record({ review_note: 'Saved note' }), studentName: 'Student One', reviewable: true }, global: { stubs: evidenceStubs } })
    await flushPromises()
    const state = setupState(wrapper)
    state.note = 'Unsaved reason for review'
    await wrapper.setProps({ record: record({ review_note: 'Server note', verification_status: 'rejected' }) })
    await flushPromises()
    expect(state.note).toBe('Unsaved reason for review')
    expect(mocks.signedUrl).toHaveBeenCalledOnce()
    await wrapper.setProps({ record: record({ id: 'record-2', review_note: 'Next student note' }) })
    expect(state.note).toBe('Next student note')
    wrapper.unmount()
  })

  it('explains parent-only online location access and uses a compact empty-photo state for inferred absence', async () => {
    const wrapper = mount(EvidenceDetailModal, { props: { record: record({ attendance_mode: 'self_online', is_inferred: true, selfie_path: null, latitude: null, longitude: null, distance_m: null }), studentName: 'Student One' }, global: { stubs: evidenceStubs } })
    await flushPromises()
    expect(wrapper.text()).toContain('private to the linked parent or guardian')
    expect(wrapper.text()).toContain('No attendance check-in was submitted')
    expect(wrapper.find('.photo-state.is-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('Sat')
    expect(mocks.signedUrl).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('shared dialog lifetime', () => {
  it('does not close its parent when a child dialog programmatically replaces it', async () => {
    const wrapper = shallowMount(AppModal, { props: { open: true, title: 'Security' } })
    await wrapper.setProps({ open: false })
    wrapper.findComponent({ name: 'IonModal' }).vm.$emit('didDismiss')
    expect(wrapper.emitted('close')).toBeUndefined()
    await wrapper.setProps({ open: true })
    wrapper.findComponent({ name: 'IonModal' }).vm.$emit('didDismiss')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
  it('blocks user cancellation during save while allowing a successful parent close and route unmount', async () => {
    const wrapper = shallowMount(AppModal, { props: { open: true, title: 'Save class', busy: true } })
    const canDismiss = wrapper.findComponent({ name: 'IonModal' }).props('canDismiss') as () => boolean
    expect(canDismiss()).toBe(false)
    await wrapper.setProps({ open: false })
    expect(canDismiss()).toBe(true)
    await wrapper.setProps({ open: true })
    expect(canDismiss()).toBe(false)
    wrapper.unmount()
    expect(canDismiss()).toBe(true)
  })
})

describe('cached student dashboard re-entry', () => {
  it('refreshes submitted attendance after returning while avoiding duplicate initial loads and repeated face prompts', async () => {
    mocks.profile.value = { id: 'student-1', role: 'student', full_name: 'Student One' }
    mocks.route.query.section = 'overview'
    let submitted = false
    let availableMeetingReads = 0
    queryHandler = state => {
      if (state.table === 'student_profiles') return { data: { user_id: 'student-1', guardian_email: 'parent@example.com', registration_completed_at: '2026-10-23T00:00:00Z' }, error: null }
      if (state.table === 'student_available_meetings') {
        availableMeetingReads++
        return { data: [{ id: 'meeting-1', class_id: 'class-1', class_name: 'Integration', title: 'Saturday class', starts_at: '2026-10-24T01:00:00Z', ends_at: '2026-10-24T02:00:00Z', attendance_opens_at: '2026-10-24T00:45:00Z', attendance_closes_at: '2026-10-24T02:00:00Z', attendance_mode: 'self_online', attendance_enabled: true, existing_status: submitted ? 'present' : null, submitted_at: submitted ? '2026-10-24T01:01:00Z' : null }], error: null }
      }
      return { data: [], error: null }
    }
    mocks.rpc.mockResolvedValue({ data: { enrolled: true }, error: null })
    const wrapper = shallowMount(StudentPage)
    const enter = mocks.viewEnter[0]
    await enter()
    await flushPromises()
    const state = setupState(wrapper)
    expect(availableMeetingReads).toBe(1)
    expect(state.meetings[0].existing_status).toBeNull()
    expect(state.faceEnrollmentOpen).toBe(false)
    submitted = true
    mocks.rpc.mockResolvedValue({ data: { enrolled: false }, error: null })
    await enter()
    await flushPromises()
    expect(availableMeetingReads).toBe(2)
    expect(state.meetings).toEqual([])
    expect(state.faceEnrollmentOpen).toBe(false)
    wrapper.unmount()
  })
})

describe('teacher class workspace', () => {
  const schoolClass = (id: string) => ({ id, teacher_id: 'teacher-1', name: `Class ${id}`, join_code: `JOIN${id}`, section: null })
  const meeting = (classId: string) => ({
    id: `meeting-${classId}`, class_id: classId, starts_at: '2026-10-24T01:00:00Z', ends_at: '2026-10-24T02:00:00Z',
    attendance_mode: 'teacher_manual', attendance_enabled: true, attendance_opens_at: '2026-10-24T00:45:00Z', attendance_closes_at: '2026-10-24T02:00:00Z',
  })

  function confirmDialog() {
    vi.spyOn(alertController, 'create').mockResolvedValue({
      present: async () => {}, onDidDismiss: async () => ({ role: 'confirm' }),
    } as unknown as Awaited<ReturnType<typeof alertController.create>>)
  }

  it('creates, edits, and deletes a class through its dialog without leaving stale selections', async () => {
    let rows = [schoolClass('A')]
    const writes: QueryState[] = []
    mocks.rpc.mockImplementation(async name => {
      if (name === 'create_class') {
        const created = { ...schoolClass('B'), name: 'Networking' }
        rows.push(created)
        return { data: created, error: null }
      }
      return { data: null, error: null }
    })
    queryHandler = state => {
      if (state.table !== 'classes') return { data: [], error: null }
      if (state.action === 'update') {
        writes.push(state)
        const updated = { ...rows.find(row => row.id === state.filters.id)!, ...(state.payload as object) }
        rows = rows.map(row => row.id === updated.id ? updated : row)
        return { data: updated, error: null }
      }
      if (state.action === 'delete') {
        writes.push(state)
        rows = rows.filter(row => row.id !== state.filters.id)
      }
      return { data: rows, error: null }
    }
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    state.beginClassCreate()
    state.classForm.name = 'Networking'
    await state.saveClass()
    await flushPromises()
    expect(state.classModalOpen).toBe(false)
    expect(state.selectedClassId).toBe('B')
    state.beginClassEdit(state.activeClass)
    state.classForm.name = 'Advanced Networking'
    await state.saveClass()
    expect(state.activeClass.name).toBe('Advanced Networking')
    expect(writes[0].payload).toMatchObject({ name: 'Advanced Networking', timezone: 'Asia/Manila' })
    confirmDialog()
    await state.deleteClass(state.activeClass)
    await flushPromises()
    expect(state.classes.map((row: { id: string }) => row.id)).toEqual(['A'])
    expect(state.selectedClassId).toBe('A')
    expect(writes[1].filters.id).toBe('B')
    wrapper.unmount()
  })

  it('keeps a disabled meeting excluded after editing, then removes it from the workspace when deleted', async () => {
    let current = { ...meeting('A'), attendance_enabled: false }
    const writes: QueryState[] = []
    queryHandler = state => {
      if (state.table === 'classes') return { data: [schoolClass('A')], error: null }
      if (state.table === 'meetings') {
        if (state.action === 'update') {
          writes.push(state)
          current = { ...current, ...(state.payload as object) }
          return { data: current, error: null }
        }
        if (state.action === 'delete') writes.push(state)
        return { data: [current], error: null }
      }
      return { data: [], error: null }
    }
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    state.beginMeetingEdit(state.selectedMeeting)
    state.meetingForm.check_in_closes_at = '2026-10-24T09:30'
    await state.saveMeeting()
    expect(writes[0].payload).toMatchObject({ attendance_enabled: false, latitude: 13.387419, longitude: 121.162494, radius_m: 180, attendance_opens_at: current.starts_at })
    expect(writes[0].payload).not.toHaveProperty('title')
    expect(state.meetings[0].attendance_enabled).toBe(false)
    expect(state.meetingModalOpen).toBe(false)
    confirmDialog()
    await state.deleteMeeting(state.selectedMeeting)
    await flushPromises()
    expect(state.meetings).toEqual([])
    expect(state.selectedMeetingId).toBe('')
    expect(writes[1].filters.id).toBe('meeting-A')
    wrapper.unmount()
  })

  it('keeps the selected class when an earlier class request completes late', async () => {
    const slowClass = deferred<Result>()
    queryHandler = state => {
      if (state.table === 'classes') return { data: ['A', 'B', 'C'].map(schoolClass), error: null }
      if (state.table === 'meetings') {
        if (state.filters.class_id === 'B') return slowClass.promise
        return { data: [meeting(String(state.filters.class_id))], error: null }
      }
      return { data: [], error: null }
    }
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    state.selectedClassId = 'B'
    await flushPromises()
    state.selectedClassId = 'C'
    await flushPromises()
    slowClass.resolve({ data: [meeting('B')], error: null })
    await flushPromises()
    expect(state.selectedClassId).toBe('C')
    expect(state.meetings.map((item: { class_id: string }) => item.class_id)).toEqual(['C'])
    expect(state.selectedMeetingId).toBe('meeting-C')
    wrapper.unmount()
  })

  it('saves weekly defaults and keeps the dialog open with a useful message when the server upgrade is pending', async () => {
    let saved: unknown
    queryHandler = state => {
      if (state.table === 'classes') return { data: [schoolClass('A')], error: null }
      if (state.table === 'class_schedules' && state.action === 'insert') {
        saved = state.payload
        return { data: null, error: { code: 'PGRST204', message: 'Could not find attendance_mode' } }
      }
      return { data: [], error: null }
    }
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    state.beginScheduleCreate()
    Object.assign(state.scheduleForm, { attendance_mode: 'self_online', check_in_minutes_after_start: 30 })
    await state.saveSchedule()
    expect(saved).toMatchObject({ class_id: 'A', attendance_mode: 'self_online', check_in_minutes_after_start: 30 })
    expect(saved).not.toHaveProperty('check_in_minutes_before')
    expect(state.scheduleModalOpen).toBe(true)
    expect(state.message).toContain('weekly schedule upgrade is not active')
    wrapper.unmount()
  })

  it('creates, edits, and deletes a weekly schedule while keeping its attendance defaults', async () => {
    let rows: Array<Record<string, unknown>> = []
    const writes: QueryState[] = []
    queryHandler = state => {
      if (state.table === 'classes') return { data: [schoolClass('A')], error: null }
      if (state.table !== 'class_schedules') return { data: [], error: null }
      if (state.action === 'insert') rows = [{ id: 'schedule-1', ...(state.payload as object) }]
      if (state.action === 'update') rows = [{ ...rows[0], ...(state.payload as object) }]
      if (state.action === 'delete') rows = []
      if (state.action !== 'select') writes.push(state)
      return { data: rows, error: null }
    }
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    state.beginScheduleCreate()
    Object.assign(state.scheduleForm, { attendance_mode: 'self_on_site', check_in_minutes_after_start: 20, room: 'Room 201' })
    await state.saveSchedule()
    expect(state.scheduleModalOpen).toBe(false)
    expect(state.schedules[0]).toMatchObject({ attendance_mode: 'self_on_site', check_in_minutes_after_start: 20, room: 'Room 201' })
    state.beginScheduleEdit(state.schedules[0])
    Object.assign(state.scheduleForm, { attendance_mode: 'self_online', check_in_minutes_after_start: 5 })
    await state.saveSchedule()
    expect(writes[1].payload).toMatchObject({ attendance_mode: 'self_online', check_in_minutes_after_start: 5 })
    confirmDialog()
    await state.deleteSchedule(state.schedules[0])
    expect(state.schedules).toEqual([])
    expect(writes[2].filters.id).toBe('schedule-1')
    wrapper.unmount()
  })

  it('archives and restores a class through the protected API while keeping its saved meetings and attendance', async () => {
    let current = { ...schoolClass('A'), archived_at: null as string | null }
    queryHandler = state => {
      if (state.table === 'classes') return { data: [current], error: null }
      if (state.table === 'meetings') return { data: [meeting('A')], error: null }
      return { data: [], error: null }
    }
    mocks.rpc.mockImplementation(async (name, payload) => {
      if (name === 'set_class_archived') current = { ...current, archived_at: payload.p_archived ? '2026-10-24T00:00:00Z' : null }
      return { data: current, error: null }
    })
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    confirmDialog()
    await state.setClassArchived(state.activeClass, true)
    await flushPromises()
    expect(mocks.rpc).toHaveBeenCalledWith('set_class_archived', { p_class_id: 'A', p_archived: true })
    expect(state.classFilter).toBe('archived')
    expect(state.activeClasses).toHaveLength(0)
    expect(state.archivedClasses).toHaveLength(1)
    expect(state.meetings).toHaveLength(1)
    expect(state.canMarkAttendance).toBe(false)
    await state.setClassArchived(state.activeClass, false)
    await flushPromises()
    expect(mocks.rpc).toHaveBeenCalledWith('set_class_archived', { p_class_id: 'A', p_archived: false })
    expect(state.classFilter).toBe('active')
    expect(state.activeClasses).toHaveLength(1)
    expect(state.canMarkAttendance).toBe(true)
    wrapper.unmount()
  })

  it('saves only the weekly closing offset and rejects an invalid closing window without writing', async () => {
    const writes: QueryState[] = []
    queryHandler = state => {
      if (state.table === 'classes') return { data: [schoolClass('A')], error: null }
      if (state.table === 'class_schedules' && state.action === 'insert') writes.push(state)
      return { data: [], error: null }
    }
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    state.beginScheduleCreate()
    Object.assign(state.scheduleForm, { check_in_minutes_after_start: 30 })
    await state.saveSchedule()
    expect(writes[0].payload).toMatchObject({ check_in_minutes_after_start: 30, is_active: true })
    expect(writes[0].payload).not.toHaveProperty('check_in_minutes_before')
    state.beginScheduleCreate()
    state.scheduleForm.check_in_minutes_after_start = 0
    await state.saveSchedule()
    expect(writes).toHaveLength(1)
    expect(state.scheduleModalOpen).toBe(true)
    expect(state.message).toContain('Check-in must close')
    state.scheduleForm.check_in_minutes_after_start = ''
    await state.saveSchedule()
    expect(writes[1].payload).toMatchObject({ check_in_minutes_after_start: null })
    wrapper.unmount()
  })

  it('opens self-check evidence from Attendance and does not create a separate evidence workspace', async () => {
    mocks.route.query.section = 'evidence'
    queryHandler = state => {
      if (state.table === 'classes') return { data: [schoolClass('A')], error: null }
      if (state.table === 'meetings') return { data: [{ ...meeting('A'), attendance_mode: 'self_online' }], error: null }
      return { data: [], error: null }
    }
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    expect(state.activeSection).toBe('attendance')
    const submission = { ...record(), student_id: 'student-1', meeting_id: 'meeting-A', source: 'self_check', created_at: '2026-10-24T01:05:00Z' }
    state.openEvidence(submission)
    expect(state.selectedEvidence).toMatchObject({ id: 'record-1', class_name: 'Class A', latitude: null, longitude: null, distance_m: null })
    expect(state.selectedEvidence).not.toHaveProperty('meeting_title')
    wrapper.unmount()
  })

  it('receives remote attendance changes without closing an editor or clearing its draft', async () => {
    let records: Array<Record<string, unknown>> = []
    queryHandler = state => {
      if (state.table === 'classes') return { data: [schoolClass('A')], error: null }
      if (state.table === 'meetings') return { data: [meeting('A')], error: null }
      if (state.table === 'attendance_records') return { data: records, error: null }
      return { data: [], error: null }
    }
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    state.beginScheduleCreate()
    state.scheduleForm.room = 'Unsaved room draft'
    records = [{ ...record(), student_id: 'student-1', meeting_id: 'meeting-A', source: 'self_check' }]
    const liveOptions = vi.mocked(useRealtimeRefresh).mock.calls.at(-1)![0]
    await liveOptions.onChange()
    expect(state.attendanceRecords).toHaveLength(1)
    expect(state.scheduleModalOpen).toBe(true)
    expect(state.scheduleForm.room).toBe('Unsaved room draft')
    expect(state.loadingDetails).toBe(false)
    wrapper.unmount()
  })

  it('combines all active classes in the calendar, preserving meeting overrides and deleted weekly occurrences', async () => {
    const schedules = [
      { id: 'schedule-A', class_id: 'A', day_of_week: 6, starts_at: '09:00:00', ends_at: '10:00:00', is_active: true, attendance_mode: 'teacher_manual', check_in_minutes_before: 15 },
      { id: 'schedule-B', class_id: 'B', day_of_week: 6, starts_at: '11:00:00', ends_at: '12:00:00', is_active: true, attendance_mode: 'self_online', check_in_minutes_before: 15 },
      { id: 'schedule-C', class_id: 'B', day_of_week: 5, starts_at: '13:00:00', ends_at: '14:00:00', is_active: true, attendance_mode: 'teacher_manual', check_in_minutes_before: 15 },
    ]
    mocks.rpc.mockImplementation(async name => ({ data: name === 'visible_schedule_meeting_exceptions' ? [{ schedule_id: 'schedule-C', schedule_week_start: '2026-10-19' }] : null, error: null }))
    queryHandler = state => {
      if (state.table === 'classes') return { data: ['A', 'B'].map(schoolClass), error: null }
      if (state.table === 'class_schedules') return { data: schedules.filter(schedule => !state.filters.class_id || schedule.class_id === state.filters.class_id), error: null }
      if (state.table === 'meetings') return { data: [{ ...meeting('A'), schedule_id: 'schedule-A', attendance_enabled: false }], error: null }
      return { data: [], error: null }
    }
    const wrapper = shallowMount(TeacherPage)
    await flushPromises()
    const state = setupState(wrapper)
    expect(state.calendarEvents).toHaveLength(2)
    expect(state.calendarEvents.find((event: { meetingId?: string }) => event.meetingId)).toMatchObject({ className: 'Class A', status: 'not_counted' })
    const planned = state.calendarEvents.find((event: { scheduleId?: string }) => event.scheduleId === 'schedule-B')
    expect(planned).toMatchObject({ className: 'Class B', kind: 'weekly' })
    await state.openCalendarEvent(planned)
    await flushPromises()
    expect(state.selectedClassId).toBe('B')
    expect(state.editingScheduleId).toBe('schedule-B')
    expect(state.scheduleModalOpen).toBe(true)
    wrapper.unmount()
  })
})

describe('administrator review dialog', () => {
  it('separates pending, approved, and rejected teachers and searches within the selected status', async () => {
    mocks.profile.value = { id: 'admin-1', role: 'admin' }
    const rows = ['pending', 'approved', 'rejected'].map((status, index) => ({ id: `teacher-${index}`, full_name: `Teacher ${status}`, email: `${status}@example.com`, teacher_approval_status: status, created_at: '2026-10-23T00:00:00Z' }))
    queryHandler = () => ({ data: rows, error: null })
    const wrapper = shallowMount(AdminPage)
    await flushPromises()
    const state = setupState(wrapper)
    expect(state.visibleApplicants.map((row: { teacher_approval_status: string }) => row.teacher_approval_status)).toEqual(['pending'])
    state.selectedView = 'approved'
    expect(state.visibleApplicants.map((row: { teacher_approval_status: string }) => row.teacher_approval_status)).toEqual(['approved'])
    state.teacherSearch = 'APPROVED@EXAMPLE'
    expect(state.visibleApplicants).toHaveLength(1)
    state.teacherSearch = 'rejected'
    expect(state.visibleApplicants).toHaveLength(0)
    state.selectedView = 'rejected'
    expect(state.visibleApplicants).toHaveLength(1)
    wrapper.unmount()
  })

  it('separates enrolled and not-enrolled face lists and clears feedback after five seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    mocks.profile.value = { id: 'admin-1', role: 'admin' }
    mocks.rpc.mockImplementation(async name => ({ data: name === 'admin_student_face_enrollments' ? [{ student_id: 'student-1', full_name: 'Enrolled Student', email: 'one@example.com', enrolled: true }, { student_id: 'student-2', full_name: 'New Student', email: 'two@example.com', enrolled: false }] : [], error: null }))
    const wrapper = shallowMount(AdminPage)
    await flushPromises()
    const state = setupState(wrapper)
    expect(state.visibleStudents.map((student: { student_id: string }) => student.student_id)).toEqual(['student-1'])
    state.faceView = 'not_enrolled'
    expect(state.visibleStudents.map((student: { student_id: string }) => student.student_id)).toEqual(['student-2'])
    state.showSuccess('Teacher One registration approved.')
    await flushPromises()
    expect(state.message).toContain('approved')
    await vi.advanceTimersByTimeAsync(5001)
    expect(state.message).toBe('')
    wrapper.unmount()
  })
  it('saves the teacher approval decision and note, then refreshes the approval totals', async () => {
    mocks.profile.value = { id: 'admin-1', role: 'admin' }
    mocks.route.query.section = 'teachers'
    let applicant = { id: 'teacher-1', full_name: 'Teacher One', email: 'teacher@example.com', teacher_approval_status: 'pending', teacher_approval_note: null as string | null, teacher_approved_at: null, created_at: '2026-10-23T00:00:00Z' }
    queryHandler = () => ({ data: [applicant], error: null })
    mocks.rpc.mockImplementation(async (name, payload) => {
      if (name === 'review_teacher_registration') applicant = { ...applicant, teacher_approval_status: payload.p_decision, teacher_approval_note: payload.p_note }
      return { data: null, error: null }
    })
    const wrapper = shallowMount(AdminPage)
    await flushPromises()
    const state = setupState(wrapper)
    state.openReviewModal(state.applicants[0])
    state.reviewNotes['teacher-1'] = 'School employment verified.'
    await state.reviewApplicant(state.selectedApplicant, 'approved')
    expect(mocks.rpc).toHaveBeenCalledWith('review_teacher_registration', { p_teacher_id: 'teacher-1', p_decision: 'approved', p_note: 'School employment verified.' })
    expect(state.selectedApplicant).toBeNull()
    expect(state.pendingCount).toBe(0)
    expect(state.approvedCount).toBe(1)
    wrapper.unmount()
  })

  it('authorizes one student face retake in a confirmation dialog and refreshes access', async () => {
    mocks.profile.value = { id: 'admin-1', role: 'admin' }
    mocks.route.query.section = 'verification'
    let student = { student_id: 'student-1', full_name: 'Student One', email: 'student@example.com', enrolled: true, can_retake: false, enrolled_at: '2026-10-23T00:00:00Z', granted_at: null }
    mocks.rpc.mockImplementation(async (name, payload) => {
      if (name === 'admin_student_face_enrollments') return { data: [student], error: null }
      if (name === 'admin_grant_face_retake') student = { ...student, can_retake: true }
      return { data: null, error: null }
    })
    const wrapper = shallowMount(AdminPage)
    await flushPromises()
    const state = setupState(wrapper)
    expect(state.visibleStudents).toHaveLength(1)
    state.openRetake(state.visibleStudents[0])
    state.retakeNote = 'Student changed appearance.'
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_grant_face_retake', expect.anything())
    await state.grantRetake()
    expect(mocks.rpc).toHaveBeenCalledWith('admin_grant_face_retake', { p_student_id: 'student-1', p_note: 'Student changed appearance.' })
    expect(state.selectedStudent).toBeNull()
    expect(state.faceStudents[0].can_retake).toBe(true)
    expect(state.message).toContain('one-time face retake')
    wrapper.unmount()
  })

  it('preserves a teacher review draft during a remote update', async () => {
    mocks.profile.value = { id: 'admin-1', role: 'admin' }
    const applicant = { id: 'teacher-1', full_name: 'Teacher One', email: 'teacher@example.com', teacher_approval_status: 'pending', teacher_approval_note: null, created_at: '2026-10-23T00:00:00Z' }
    queryHandler = () => ({ data: [applicant], error: null })
    const wrapper = shallowMount(AdminPage)
    await flushPromises()
    const state = setupState(wrapper)
    state.openReviewModal(state.applicants[0])
    state.reviewNotes['teacher-1'] = 'Unsaved review note'
    const liveOptions = vi.mocked(useRealtimeRefresh).mock.calls.at(-1)![0]
    await liveOptions.onChange()
    expect(state.selectedApplicant.id).toBe('teacher-1')
    expect(state.reviewNotes['teacher-1']).toBe('Unsaved review note')
    wrapper.unmount()
  })
})

describe('family history', () => {
  it('requires an explicit parent confirmation before accepting a pending student link', async () => {
    mocks.profile.value = { id: 'parent-1', role: 'parent' }
    const pending = { id: 'request-1', student_id: 'student-1', student_name: 'Student One', student_email: 'student@example.com', status: 'pending', requested_at: '2026-10-24T00:00:00Z' }
    let approved = false
    queryHandler = state => ({ data: state.table === 'guardian_links' && approved ? [{ student_id: 'student-1' }] : state.table === 'profiles' ? [{ id: 'student-1', full_name: 'Student One', email: 'student@example.com' }] : [], error: null })
    mocks.rpc.mockImplementation(async name => {
      if (name === 'respond_to_parent_link_request') approved = true
      return { data: name === 'my_parent_link_requests' ? approved ? [] : [pending] : [], error: null }
    })
    const wrapper = shallowMount(ParentPage)
    await flushPromises()
    const state = setupState(wrapper)
    expect(state.pendingLinks).toHaveLength(1)
    expect(state.students).toHaveLength(0)
    state.openLinkReview(state.pendingLinks[0], true)
    await state.respondToLink()
    expect(mocks.rpc).not.toHaveBeenCalledWith('respond_to_parent_link_request', expect.anything())
    state.confirmedStudent = true
    await state.respondToLink()
    expect(mocks.rpc).toHaveBeenCalledWith('respond_to_parent_link_request', { p_request_id: 'request-1', p_approve: true, p_note: null })
    expect(state.pendingLinks).toHaveLength(0)
    expect(state.students).toHaveLength(1)
    wrapper.unmount()
  })
  it('keeps history photo paths for lazy thumbnails without eagerly signing hundreds of records', async () => {
    mocks.profile.value = { id: 'parent-1', role: 'parent' }
    mocks.route.query.section = 'overview'
    queryHandler = state => ({ data: ({ guardian_links: [{ student_id: 'student-1' }], profiles: [{ id: 'student-1', full_name: 'Student One', email: 'student@example.com' }], class_enrollments: [] } as Record<string, unknown>)[state.table] ?? [], error: null })
    const history = Array.from({ length: 200 }, (_, index) => ({ ...record(), id: `record-${index}`, attendance_id: `record-${index}`, student_id: 'student-1', meeting_id: `meeting-${index}`, class_id: 'class-1', class_name: 'Integration', attendance_enabled: true, attendance_mode: 'self_on_site', selfie_path: `student-1/meeting-${index}/selfie.jpg`, is_inferred: false }))
    mocks.rpc.mockImplementation(async name => ({ data: name === 'student_attendance_history' ? history : [], error: null }))
    const wrapper = shallowMount(ParentPage)
    await flushPromises()
    expect(setupState(wrapper).attendance).toHaveLength(200)
    expect(mocks.signedUrl).not.toHaveBeenCalled()
    const live = vi.mocked(useRealtimeRefresh).mock.calls.at(-1)![0]
    await live.onChange()
    expect(mocks.signedUrl).not.toHaveBeenCalled()
    vi.setSystemTime(new Date('2026-10-24T00:15:00Z'))
    await live.onChange()
    expect(mocks.signedUrl).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('retains photos for an excluded meeting while clearly marking that attendance does not count', async () => {
    mocks.profile.value = { id: 'parent-1', role: 'parent' }
    mocks.route.query.section = 'history'
    queryHandler = state => ({ data: ({
      guardian_links: [{ student_id: 'student-1' }],
      profiles: [{ id: 'student-1', full_name: 'Student One', email: 'student@example.com' }],
      attendance_records: [{ ...record(), student_id: 'student-1', meeting_id: 'meeting-1' }],
      meetings: [{ id: 'meeting-1', class_id: 'class-1', title: 'Cancelled class', starts_at: '2026-10-24T01:00:00Z', attendance_enabled: false }],
      classes: [{ id: 'class-1', name: 'Integration' }],
    } as Record<string, unknown>)[state.table] ?? [], error: null })
    mocks.rpc.mockImplementation(async name => ({ data: name === 'student_attendance_history' ? [{ ...record(), student_id: 'student-1', meeting_id: 'meeting-1', attendance_id: 'record-1', class_id: 'class-1', class_name: 'Integration', meeting_title: 'Cancelled class', attendance_enabled: false, attendance_mode: 'self_on_site', is_inferred: false }] : [], error: null }))
    const wrapper = shallowMount(ParentPage, { global: { renderStubDefaultSlot: true } })
    await flushPromises()
    expect(wrapper.text()).toContain('Meeting not counted')
    expect(wrapper.find('img.history-photo').exists()).toBe(false)
    expect(wrapper.find('attendance-photo-stub').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Photo available in Details')
    expect(mocks.signedUrl).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows inferred absences and merges online locations only through the verified-parent RPC', async () => {
    mocks.profile.value = { id: 'parent-1', role: 'parent' }
    mocks.route.query.section = 'history'
    queryHandler = state => ({ data: ({ guardian_links: [{ student_id: 'student-1' }], profiles: [{ id: 'student-1', full_name: 'Student One', email: 'student@example.com' }], class_enrollments: [] } as Record<string, unknown>)[state.table] ?? [], error: null })
    const onlineRecord = { ...record(), attendance_id: 'record-1', student_id: 'student-1', meeting_id: 'meeting-1', class_id: 'class-1', class_name: 'Integration', attendance_enabled: true, attendance_mode: 'self_online', latitude: null, longitude: null, distance_m: null, is_inferred: false }
    const absence = { ...onlineRecord, id: 'meeting-0', attendance_id: null, meeting_id: 'meeting-0', status: 'absent', verification_status: null, selfie_path: null, submitted_at: null, is_inferred: true, meeting_starts_at: '2026-10-23T01:00:00Z' }
    mocks.rpc.mockImplementation(async name => ({ data: name === 'student_attendance_history' ? [onlineRecord, absence] : name === 'parent_online_attendance_locations' ? [{ attendance_id: 'record-1', latitude: 13.1, longitude: 121.2 }] : [], error: null }))
    const wrapper = shallowMount(ParentPage, { global: { renderStubDefaultSlot: true } })
    await flushPromises()
    const state = setupState(wrapper)
    expect(state.attendance).toHaveLength(2)
    expect(state.attendance[0]).toMatchObject({ latitude: 13.1, longitude: 121.2 })
    expect(state.attendance[1]).toMatchObject({ status: 'absent', is_inferred: true, submitted_at: null })
    expect(mocks.rpc).toHaveBeenCalledWith('student_attendance_history', { p_student_id: 'student-1' })
    expect(mocks.rpc).toHaveBeenCalledWith('parent_online_attendance_locations', { p_student_id: 'student-1' })
    expect(wrapper.text()).toContain('Absent')
    expect(wrapper.text()).toContain('No check-in recorded')
    wrapper.unmount()
  })

  it('passes the child’s active courses to the shared class calendar without a refresh button', async () => {
    mocks.profile.value = { id: 'parent-1', role: 'parent' }
    mocks.route.query.section = 'schedule'
    let enabled = true
    queryHandler = state => ({ data: ({ guardian_links: [{ student_id: 'student-1' }], profiles: [{ id: 'student-1', full_name: 'Student One', email: 'student@example.com' }], class_enrollments: [{ class_id: 'class-1', class: { id: 'class-1', name: 'Integration', archived_at: null } }], meetings: [{ id: 'meeting-1', class_id: 'class-1', title: 'Saturday class', starts_at: '2026-10-24T01:00:00Z', ends_at: '2026-10-24T02:00:00Z', attendance_enabled: enabled }] } as Record<string, unknown>)[state.table] ?? [], error: null })
    const wrapper = shallowMount(ParentPage, { global: { renderStubDefaultSlot: true } })
    await flushPromises()
    const state = setupState(wrapper)
    expect(state.studentCourses['student-1'][0].name).toBe('Integration')
    expect(wrapper.findComponent(ParentCalendarPanel).props('studentId')).toBe('student-1')
    expect(wrapper.text()).toContain('Your child’s calendar')
    expect(wrapper.text()).not.toContain('Refresh')
    enabled = false
    const liveOptions = vi.mocked(useRealtimeRefresh).mock.calls.at(-1)![0]
    await liveOptions.onChange()
    expect(state.studentCourses['student-1'][0].name).toBe('Integration')
    wrapper.unmount()
  })
})
