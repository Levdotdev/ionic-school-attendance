/** Development-only visual fixture. This file is never imported by production. */
import { createApp } from 'vue'
import { IonicVue } from '@ionic/vue'
import { createRouter } from '@ionic/vue-router'
import { createMemoryHistory } from 'vue-router'
import '@ionic/vue/css/core.css'
import '@ionic/vue/css/normalize.css'
import '@ionic/vue/css/structure.css'
import '@ionic/vue/css/typography.css'
import '@ionic/vue/css/padding.css'
import '@ionic/vue/css/text-alignment.css'
import '@ionic/vue/css/text-transformation.css'
import '@ionic/vue/css/flex-utils.css'
import '@ionic/vue/css/display.css'
import '@/theme/variables.css'
import '@/theme/app.css'

if (!import.meta.env.DEV || !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) throw new Error('This fixture only runs on the local development server.')

// Fail closed before loading the application client: fixtures must never call
// hosted Auth, Storage, Realtime, analytics, or any other external service.
const localFetch = window.fetch.bind(window)
window.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href)
  if (url.origin !== location.origin && !['blob:', 'data:'].includes(url.protocol)) return Promise.reject(new Error('External requests are disabled in the local visual fixture.'))
  return localFetch(input, init)
}

const params = new URLSearchParams(location.search)
const role = ['student', 'teacher', 'parent', 'admin'].includes(params.get('role') ?? '') ? params.get('role')! : 'student'
if (params.has('theme')) localStorage.setItem('minsu-attendance-theme', params.get('theme') === 'dark' ? 'dark' : 'light')
localStorage.setItem('minsu-sidebar-collapsed', params.get('collapsed') === '1' ? 'true' : 'false')

const realGetItem = Storage.prototype.getItem
Storage.prototype.getItem = function (key: string) { return key.startsWith('sb-') ? null : realGetItem.call(this, key) }
const { supabase } = await import('@/lib/supabase')

type Row = Record<string, any>
const now = new Date()
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const monday = new Date(`${day}T00:00:00Z`)
monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
const key = (offset: number) => { const date = new Date(monday); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10) }
const iso = (offset: number, time = '08:00') => `${key(offset)}T${time}:00+08:00`
const created = '2026-09-01T00:00:00Z'
const names = ['Lance Brito', 'Alex Reyes', 'Jamie Santos', 'Sam Cruz', 'Riley Garcia', 'Taylor Ramos', 'Jordan Lopez', 'Casey Mendoza', 'Morgan Torres', 'Avery Flores', 'Charlie Diaz', 'Robin Aquino']
const students: Row[] = names.map((full_name, index) => ({ id: `student-${index + 1}`, role: 'student', full_name, email: `student${index + 1}@example.test`, created_at: created, onboarding_completed_at: created, teacher_approval_status: null, teacher_approval_note: null, teacher_approved_at: null, avatar_path: index === 0 ? 'student-1/avatar.jpg' : null }))
const roleNames: Record<string, string> = { student: names[0], teacher: 'Maria Villanueva', parent: 'Patricia Brito', admin: 'School Administrator' }
const actorId = role === 'student' ? 'student-1' : `${role}-1`
const actor: Row = { id: actorId, role, full_name: roleNames[role], email: `${role}@example.test`, onboarding_completed_at: created, created_at: created, teacher_approval_status: role === 'teacher' ? 'approved' : null, teacher_approval_note: null, teacher_approved_at: role === 'teacher' ? created : null, avatar_path: `${actorId}/avatar.jpg` }
const teachers: Row[] = [actor.role === 'teacher' ? actor : { id: 'teacher-1', role: 'teacher', full_name: 'Maria Villanueva', email: 'maria@example.test', teacher_approval_status: 'approved', teacher_approval_note: 'Faculty identity verified.', teacher_approved_at: created, created_at: created }, { id: 'teacher-2', role: 'teacher', full_name: 'Daniel Mendoza', email: 'daniel@example.test', teacher_approval_status: 'pending', teacher_approval_note: null, teacher_approved_at: null, created_at: new Date(Date.now() - 86_400_000).toISOString() }, { id: 'teacher-3', role: 'teacher', full_name: 'Andrea Santos', email: 'andrea@example.test', teacher_approval_status: 'rejected', teacher_approval_note: 'Please contact the registrar to verify your faculty details.', teacher_approved_at: created, created_at: created }]
const classes: Row[] = ['System Integration and Architecture', 'Application Development', 'Database Administration'].map((name, index) => ({ id: `class-${index + 1}`, teacher_id: 'teacher-1', name, section: null, timezone: 'Asia/Manila', join_code: ['SYS412', 'APP301', 'DBA204'][index], archived_at: null, default_latitude: null, default_longitude: null, default_radius_m: 180, default_max_accuracy_m: 100, created_at: created }))
const schedules: Row[] = classes.map((course, index) => ({ id: `schedule-${index + 1}`, class_id: course.id, day_of_week: [1, 3, 5][index], starts_at: ['08:00:00', '10:00:00', '13:00:00'][index], ends_at: ['09:30:00', '11:30:00', '14:30:00'][index], room: ['Room 201', 'Computer Laboratory', 'Room 305'][index], is_active: true, attendance_mode: index === 1 ? 'self_online' : 'self_on_site', check_in_minutes_before: 15, check_in_minutes_after_start: 30 }))
const meetings: Row[] = schedules.map((schedule, index) => ({ id: `meeting-${index + 1}`, class_id: schedule.class_id, schedule_id: schedule.id, schedule_week_start: key(0), title: ['Systems integration workshop', 'Application development class', 'Database practical'][index], meeting_date: key(index * 2), starts_at: iso(index * 2, schedule.starts_at.slice(0, 5)), ends_at: iso(index * 2, schedule.ends_at.slice(0, 5)), attendance_mode: schedule.attendance_mode, attendance_enabled: true, attendance_opens_at: iso(index * 2, '07:45'), attendance_closes_at: iso(index * 2, '09:30'), latitude: null, longitude: null, radius_m: 180, max_accuracy_m: 100, class: classes[index] }))
const attendance: Row[] = students.map((student, index) => ({ id: `attendance-${index + 1}`, meeting_id: 'meeting-1', student_id: student.id, status: index === 3 || index === 8 ? 'absent' : 'present', source: index % 3 === 0 ? 'teacher' : 'self_check', verification_status: index === 8 ? 'rejected' : index % 3 === 0 ? null : 'approved', selfie_path: index % 3 === 0 ? null : `fixture/${student.id}.jpg`, submitted_at: iso(0, '08:02'), created_at: iso(0, '08:02'), teacher_note: null, review_note: index === 8 ? 'Photo did not match the enrolled student.' : null, latitude: null, longitude: null, distance_m: null }))
const history: Row[] = meetings.map((meeting, index) => ({ ...attendance[0], id: `history-${index}`, attendance_id: `attendance-${index + 1}`, meeting_id: meeting.id, class_id: meeting.class_id, student_id: 'student-1', status: index === 1 ? 'absent' : 'present', source: index === 1 ? null : 'self_check', verification_status: index === 1 ? null : 'approved', selfie_path: index === 1 ? null : 'fixture/selfie.jpg', latitude: null, longitude: null, accuracy_m: null, distance_m: null, submitted_at: index === 1 ? null : meeting.starts_at, meeting_title: meeting.title, meeting_starts_at: meeting.starts_at, meeting_ends_at: meeting.ends_at, class_name: classes[index].name, attendance_enabled: true, attendance_mode: meeting.attendance_mode, review_note: null, teacher_note: null, face_verified: index !== 1, is_inferred: index === 1 }))
const categories: Row[] = [{ id: 'category-1', student_id: 'student-1', name: 'Personal', color: '#ba8d51', created_at: created, updated_at: created }]
const tasks: Row[] = ['Complete integration diagram', 'Review database normalization', 'Prepare group presentation', 'Read the Vue composition guide'].map((title, index) => ({ id: `task-${index + 1}`, student_id: 'student-1', class_id: classes[index % 3].id, category_id: null, title, description: ['Map the connections between the system components and describe the data flow.', 'Review the lecture notes and practice converting sample tables to 3NF.', 'Outline the presentation and share the draft with your group.', 'Take notes on reactive state and reusable composables.'][index], due_at: new Date(Date.now() + (index + 1) * 86_400_000).toISOString(), priority: ['high', 'medium', 'low', 'medium'][index], recurrence: index === 3 ? 'weekly' : 'none', recurrence_until: null, reminder_minutes: [30], sort_order: index, created_at: created, updated_at: created, course: classes[index % 3], category: null, links: [], files: [], occurrences: [] }))
const enrollments: Row[] = classes.flatMap(course => students.map(student => ({ id: `${course.id}-${student.id}`, student_id: student.id, class_id: course.id, is_active: true, enrolled_at: created, class: course })))
const tables: Record<string, Row[]> = { profiles: [...students, ...teachers, ...(role === 'parent' || role === 'admin' ? [actor] : [])], classes, class_schedules: schedules, meetings, class_enrollments: enrollments, attendance_records: attendance, guardian_links: [{ student_id: 'student-1', parent_id: 'parent-1', created_at: created }], student_profiles: [{ user_id: 'student-1', guardian_email: 'parent@example.test', registration_completed_at: created }], student_available_meetings: [{ ...meetings[0], id: 'open-meeting', class_name: classes[0].name, starts_at: new Date(Date.now() + 1_800_000).toISOString(), ends_at: new Date(Date.now() + 5_400_000).toISOString(), attendance_opens_at: new Date(Date.now() - 600_000).toISOString(), attendance_closes_at: new Date(Date.now() + 3_600_000).toISOString(), existing_status: null, submitted_at: null }], student_tasks: tasks, student_task_categories: categories, student_schedule_notification_preferences: schedules.map(schedule => ({ schedule_id: schedule.id, student_id: 'student-1', reminder_minutes: [5, 15] })) }
if (role === 'student' || role === 'teacher') tables.profiles = tables.profiles.map(profile => profile.id === actor.id ? actor : profile)

function query(table: string) {
  let rows = [...(tables[table] ?? [])]
  let singular = false
  let mutation: string | null = null
  let payload: Row | Row[] = {}
  const builder: any = {
    select: () => builder,
    eq: (field: string, value: unknown) => { rows = rows.filter(row => row[field] === value); return builder },
    neq: (field: string, value: unknown) => { rows = rows.filter(row => row[field] !== value); return builder },
    in: (field: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[field])); return builder },
    gte: () => builder, lte: () => builder, gt: () => builder, lt: () => builder, is: () => builder,
    order: (field: string, options: { ascending?: boolean } = {}) => { rows.sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (options.ascending === false ? -1 : 1)); return builder },
    limit: (count: number) => { rows = rows.slice(0, count); return builder },
    range: (start: number, end: number) => { rows = rows.slice(start, end + 1); return builder },
    maybeSingle: () => { singular = true; return builder }, single: () => { singular = true; return builder },
    update: (next: Row) => { mutation = 'update'; payload = next; return builder },
    insert: (next: Row | Row[]) => { mutation = 'insert'; payload = next; return builder },
    upsert: (next: Row | Row[]) => { mutation = 'upsert'; payload = next; return builder },
    delete: () => { mutation = 'delete'; return builder },
    then: (resolve: (value: any) => any, reject: (reason: unknown) => any) => Promise.resolve().then(() => {
      if (mutation === 'update') rows.forEach(row => Object.assign(row, payload))
      else if (mutation === 'delete') tables[table] = (tables[table] ?? []).filter(row => !rows.includes(row))
      else if (mutation === 'insert' || mutation === 'upsert') { rows = (Array.isArray(payload) ? payload : [payload]).map(row => ({ id: crypto.randomUUID(), ...row })); tables[table] = [...(tables[table] ?? []), ...rows] }
      return { data: singular ? rows[0] ?? null : rows, error: null, count: rows.length }
    }).then(resolve, reject),
  }
  return builder
}

const sampleImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="520" height="360"><rect width="520" height="360" fill="#dce9df"/><circle cx="260" cy="130" r="62" fill="#789985"/><path d="M130 320c5-100 255-100 260 0" fill="#789985"/><rect y="310" width="520" height="50" fill="#173d2b"/><text x="20" y="340" fill="#fff" font-size="16" font-family="sans-serif">Sample fixture photo · No real student data</text></svg>')}`
const fakeUser: Row = { id: actor.id, email: actor.email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email', providers: ['email', 'google', 'facebook'] }, user_metadata: { full_name: actor.full_name }, identities: [{ provider: 'email', identity_id: 'email-identity' }, { provider: 'google', identity_id: 'google-identity' }, { provider: 'facebook', identity_id: 'facebook-identity' }], created_at: created }
const fakeSession = { user: fakeUser, access_token: 'local-fixture-only', refresh_token: 'local-fixture-only', expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: 'bearer' }
const client = supabase as any
client.from = query
client.rpc = (name: string, args?: Row) => {
  if (name === 'my_face_enrollment_access') return { data: [{ is_enrolled: true, can_retake: false, granted_at: null }], error: null }
  if (name === 'my_face_enrollment_status') return { data: { enrolled: true }, error: null }
  if (name === 'student_attendance_history') { tables.fixture_attendance_history = history; return query('fixture_attendance_history') }
  if (name === 'parent_online_attendance_locations') { tables.fixture_online_locations = []; return query('fixture_online_locations') }
  if (name === 'visible_schedule_meeting_exceptions') return { data: [], error: null }
  if (name === 'admin_student_face_enrollments') return { data: students.map((student, index) => ({ student_id: student.id, full_name: student.full_name, email: student.email, enrolled: index !== 3, can_retake: index === 2, granted_at: index === 2 ? created : null, enrolled_at: index === 3 ? null : created })), error: null }
  if (name === 'review_teacher_registration') { const teacher = teachers.find(row => row.id === args?.p_teacher_id); if (teacher) Object.assign(teacher, { teacher_approval_status: args?.p_decision, teacher_approval_note: args?.p_note }) }
  if (name === 'record_manual_attendance') { const record = attendance.find(row => row.student_id === args?.p_student_id); if (record) record.status = args?.p_status }
  return { data: null, error: null }
}
client.channel = () => { const channel = { on: () => channel, subscribe: () => channel, unsubscribe: async () => ({ error: null }) }; return channel }
client.removeChannel = async () => 'ok'
client.storage.from = () => ({ createSignedUrl: async () => ({ data: { signedUrl: sampleImage }, error: null }), upload: async () => ({ data: { path: `${actor.id}/new-avatar.jpg` }, error: null }), remove: async () => ({ data: [], error: null }) })
client.auth.getSession = async () => ({ data: { session: fakeSession }, error: null })
client.auth.getUser = async () => ({ data: { user: fakeUser }, error: null })
client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe: () => {} } } })
client.auth.updateUser = async (attributes: Row) => { Object.assign(fakeUser, attributes); return { data: { user: fakeUser }, error: null } }
client.auth.resetPasswordForEmail = async () => ({ data: {}, error: null })
client.auth.reauthenticate = async () => ({ data: {}, error: null })
client.auth.signOut = async () => ({ error: null })

const [{ default: App }, { initializeTheme }, { initializeSession }] = await Promise.all([import('@/App.vue'), import('@/composables/useTheme'), import('@/composables/useSession')])
const routes = [
  { path: '/', redirect: `/${role}` },
  { path: '/student', component: () => import('@/views/StudentPage.vue') },
  { path: '/student/tasks', component: () => import('@/views/StudentTasksPage.vue') },
  { path: '/teacher', component: () => import('@/views/TeacherPage.vue') },
  { path: '/parent', component: () => import('@/views/ParentPage.vue') },
  { path: '/admin', component: () => import('@/views/AdminPage.vue') },
  { path: '/login', component: () => import('@/views/LoginPage.vue') },
]
const router = createRouter({ history: createMemoryHistory(), routes })
initializeTheme()
await initializeSession()
const app = createApp(App).use(IonicVue).use(router)
const destination = params.get('page') === 'tasks' && role === 'student' ? '/student/tasks' : `/${role}`
await router.replace({ path: destination, query: params.get('section') ? { section: params.get('section')! } : {} })
await router.isReady()
app.mount('#app')
document.documentElement.dataset.fixture = 'local-only'
