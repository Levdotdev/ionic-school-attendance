import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { alertController } from '@ionic/vue'

import EvidenceDetailModal, { type EvidenceRecord } from '@/components/EvidenceDetailModal.vue'
import AppModal from '@/components/AppModal.vue'
import AdminPage from '@/views/AdminPage.vue'
import ParentPage from '@/views/ParentPage.vue'
import StudentPage from '@/views/StudentPage.vue'
import TeacherPage from '@/views/TeacherPage.vue'

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
  rpc: mocks.rpc,
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
vi.mock('vue-router', () => ({ useRoute: () => mocks.route, useRouter: () => ({ replace: vi.fn() }) }))
vi.mock('@/components/PortalHeader.vue', () => ({ default: { template: '<header />' } }))
vi.mock('@/components/FaceEnrollmentModal.vue', () => ({ default: { template: '<section />' } }))
vi.mock('@/services/barcode', () => ({ scanStudentBarcode: vi.fn() }))

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
    meeting_starts_at: '2026-10-24T01:00:00.000Z', meeting_title: 'Saturday class',
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
})

describe('shared dialog lifetime', () => {
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
    expect(state.meetings[0].existing_status).toBe('present')
    expect(state.faceEnrollmentOpen).toBe(false)
    wrapper.unmount()
  })
})

describe('teacher class workspace', () => {
  const schoolClass = (id: string) => ({ id, teacher_id: 'teacher-1', name: `Class ${id}`, join_code: `JOIN${id}`, section: null })
  const meeting = (classId: string) => ({
    id: `meeting-${classId}`, class_id: classId, title: `Meeting ${classId}`, starts_at: '2026-10-24T01:00:00Z', ends_at: '2026-10-24T02:00:00Z',
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
    state.meetingForm.title = 'Renamed cancelled class'
    await state.saveMeeting()
    expect(writes[0].payload).toMatchObject({ title: 'Renamed cancelled class', attendance_enabled: false, latitude: 13.387419, longitude: 121.162494, radius_m: 180 })
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
    Object.assign(state.scheduleForm, { attendance_mode: 'self_online', check_in_minutes_before: 30 })
    await state.saveSchedule()
    expect(saved).toMatchObject({ class_id: 'A', attendance_mode: 'self_online', check_in_minutes_before: 30 })
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
    Object.assign(state.scheduleForm, { attendance_mode: 'self_on_site', check_in_minutes_before: 20, room: 'Room 201' })
    await state.saveSchedule()
    expect(state.scheduleModalOpen).toBe(false)
    expect(state.schedules[0]).toMatchObject({ attendance_mode: 'self_on_site', check_in_minutes_before: 20, room: 'Room 201' })
    state.beginScheduleEdit(state.schedules[0])
    Object.assign(state.scheduleForm, { attendance_mode: 'self_online', check_in_minutes_before: 5 })
    await state.saveSchedule()
    expect(writes[1].payload).toMatchObject({ attendance_mode: 'self_online', check_in_minutes_before: 5 })
    confirmDialog()
    await state.deleteSchedule(state.schedules[0])
    expect(state.schedules).toEqual([])
    expect(writes[2].filters.id).toBe('schedule-1')
    wrapper.unmount()
  })
})

describe('administrator review dialog', () => {
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
})

describe('family history', () => {
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
    const wrapper = shallowMount(ParentPage, { global: { renderStubDefaultSlot: true } })
    await flushPromises()
    expect(wrapper.text()).toContain('Meeting not counted')
    expect(wrapper.find('img.history-photo').attributes('src')).toBe('https://storage.test/private-signed-photo')
    wrapper.unmount()
  })
})
