<template>
  <ion-page class="dashboard-page">
    <portal-header portal="Family portal" :busy="signingOut" @logout="logout" />

    <ion-content class="dashboard-content">
      <div v-if="loading" class="loading-state" role="status" aria-label="Loading family attendance">
        <ion-spinner name="crescent" />
        <p>Loading your family dashboard…</p>
      </div>

      <main v-else class="dashboard-shell">
        <header class="page-heading">
          <div>
            <p class="eyebrow">Parent and guardian portal</p>
            <h1>{{ activeSection === 'history' ? 'Attendance history' : activeSection === 'schedule' ? 'Your child’s calendar' : 'Your child’s attendance' }}</h1>
            <p>{{ activeSection === 'history' ? 'Every past class, including present, absent, and meetings that were not counted.' : activeSection === 'schedule' ? 'The same class calendar your child sees, with week and month views.' : 'A simple summary of your child’s present and absent attendance.' }}</p>
          </div>
        </header>

        <div v-if="message" class="page-message" role="alert">
          <ion-icon :icon="alertCircleOutline" aria-hidden="true" />
          <span>{{ message }}</span>
        </div>

        <p v-if="successMessage" class="consent-success" role="status">{{ successMessage }}</p>
        <section v-if="pendingLinks.length" class="link-requests" aria-labelledby="link-requests-title"><header><p class="eyebrow">Your approval is required</p><h2 id="link-requests-title">Student link requests</h2><p>Confirm that you are this student’s parent or guardian before sharing attendance access.</p></header><article v-for="request in pendingLinks" :key="request.id"><div><strong>{{ request.student_name }}</strong><span>{{ request.student_email }}</span><small>Requested {{ formatDateTime(request.requested_at) }}</small></div><div class="consent-actions"><ion-button size="small" fill="outline" @click="openLinkReview(request, false)">Decline</ion-button><ion-button size="small" @click="openLinkReview(request, true)">Review & approve</ion-button></div></article></section>
        <section v-if="students.length === 0" class="empty-state" aria-labelledby="no-student-title">
          <div class="empty-icon" aria-hidden="true"><ion-icon :icon="peopleOutline" /></div>
          <h2 id="no-student-title">No student is linked yet</h2>
          <p>
            Ask the student to send a link request using this registered parent account’s email address.
            You must approve the request before their attendance and class calendar can appear here.
          </p>
        </section>

        <div v-else class="student-dashboards">
          <article
            v-for="dashboard in studentDashboards"
            :key="dashboard.student.id"
            class="student-dashboard"
          >
            <header class="student-heading">
              <div class="student-identity">
                <span class="student-avatar" aria-hidden="true">{{ initials(dashboard.student.full_name) }}</span>
                <div>
                  <p class="eyebrow">Linked student</p>
                  <h2>{{ dashboard.student.full_name }}</h2>
                  <p>{{ dashboard.student.email }}</p>
                </div>
              </div>
              <span class="linked-badge"><ion-icon :icon="linkOutline" /> Family access</span>
            </header>

            <parent-calendar-panel v-if="activeSection === 'schedule'" :student-id="dashboard.student.id" :student-name="dashboard.student.full_name" :courses="dashboard.courses" />
            <section v-if="activeSection === 'overview'" class="attendance-totals" :aria-label="`${dashboard.student.full_name}'s attendance totals`">
              <article class="attendance-total is-present"><ion-icon :icon="checkmarkCircleOutline" aria-hidden="true" /><div><span>Present</span><strong>{{ dashboard.present }}</strong></div></article>
              <article class="attendance-total is-absent"><ion-icon :icon="closeCircleOutline" aria-hidden="true" /><div><span>Absent</span><strong>{{ dashboard.absent }}</strong></div></article>
              <p>Totals include counted class meetings. Canceled meetings are excluded.</p>
            </section>

            <template v-if="dashboard.latest && activeSection !== 'schedule'">
              <div v-if="activeSection === 'overview'" class="latest-grid">
                <section class="status-card" :class="dashboard.latest.attendance_enabled === false ? 'is-not-counted' : dashboard.latest.verification_status === 'rejected' || dashboard.latest.status === 'absent' ? 'is-absent' : 'is-present'" :aria-labelledby="`latest-status-heading-${dashboard.student.id}`">
                  <div class="status-icon" aria-hidden="true"><ion-icon :icon="dashboard.latest.status === 'present' && dashboard.latest.verification_status !== 'rejected' ? checkmarkCircleOutline : closeCircleOutline" /></div>
                  <p class="eyebrow">Latest attendance</p>
                  <h3 :id="`latest-status-heading-${dashboard.student.id}`">{{ attendanceLabel(dashboard.latest) }}</h3>
                  <p class="meeting-name">{{ dashboard.latest.class_name }}</p>
                  <p class="meeting-time"><ion-icon :icon="calendarOutline" aria-hidden="true" />{{ formatDateTime(dashboard.latest.meeting_starts_at) }}</p>
                  <span class="verification-pill" :class="dashboard.latest.is_inferred ? 'is-missing' : verificationClass(dashboard.latest.verification_status)"><ion-icon :icon="dashboard.latest.is_inferred ? hourglassOutline : verificationIcon(dashboard.latest.verification_status)" aria-hidden="true" />{{ verificationLabel(dashboard.latest.verification_status, dashboard.latest.is_inferred) }}</span>
                </section>
                <section class="evidence-card" :aria-labelledby="`evidence-heading-${dashboard.student.id}`">
                  <div class="section-title"><div><p class="eyebrow">Attendance details</p><h3 :id="`evidence-heading-${dashboard.student.id}`">Check-in details</h3></div><ion-button size="small" fill="outline" @click="openEvidence(dashboard.latest, dashboard.student.full_name)">View details</ion-button></div>
                  <div class="evidence-body">
                    <figure class="photo-proof">
                      <button v-if="dashboard.latest.selfie_path" type="button" class="photo-button latest-photo-button" :aria-label="`View ${dashboard.student.full_name}'s latest attendance photo`" @click="openEvidence(dashboard.latest, dashboard.student.full_name)"><attendance-photo :path="dashboard.latest.selfie_path" :alt="`${dashboard.student.full_name}'s latest attendance check-in`" /></button>
                      <div v-else class="photo-placeholder"><ion-icon :icon="imageOutline" aria-hidden="true" /><span>{{ dashboard.latest.is_inferred ? 'No check-in submitted' : 'No photo required' }}</span></div>
                      <figcaption>Check-in photo</figcaption>
                    </figure>
                    <div class="evidence-details">
                      <div class="detail-row"><span class="detail-icon"><ion-icon :icon="timeOutline" aria-hidden="true" /></span><span><small>Submitted</small><strong>{{ formatDateTime(dashboard.latest.submitted_at) }}</strong></span></div>
                      <div v-if="dashboard.latest.latitude != null && dashboard.latest.longitude != null" class="detail-row"><span class="detail-icon"><ion-icon :icon="locationOutline" aria-hidden="true" /></span><span><small>Submitted location</small><strong>{{ dashboard.latest.distance_m != null ? `${Math.round(dashboard.latest.distance_m)} m from class location` : 'Location captured' }}</strong><a :href="mapUrl(dashboard.latest.latitude, dashboard.latest.longitude)" target="_blank" rel="noopener">View on Google Maps <ion-icon :icon="openOutline" aria-hidden="true" /></a></span></div>
                      <div v-else class="detail-row"><span class="detail-icon"><ion-icon :icon="locationOutline" aria-hidden="true" /></span><span><small>Location</small><strong>{{ locationLabel(dashboard.latest) }}</strong></span></div>
                    </div>
                  </div>
                </section>
              </div>
              <section v-if="activeSection === 'history'" class="history-card" :aria-labelledby="`history-${dashboard.student.id}`">
                <div class="section-title history-title">
                  <div>
                    <p class="eyebrow">Attendance history</p>
                    <h3 :id="`history-${dashboard.student.id}`">All past meetings</h3>
                  </div>
                  <span class="record-count">{{ dashboard.records.length }} {{ dashboard.records.length === 1 ? 'record' : 'records' }}</span>
                </div>

                <div class="history-list">
                  <article v-for="record in dashboard.records" :key="record.id" class="history-row">
                    <button v-if="record.selfie_path" type="button" class="history-photo photo-button" :aria-label="`View ${dashboard.student.full_name}'s attendance photo`" @click="openEvidence(record, dashboard.student.full_name)"><attendance-photo :path="record.selfie_path" :alt="`${dashboard.student.full_name}'s attendance check-in`" /></button>
                    <span v-else class="history-photo is-placeholder" role="img" aria-label="No photo was required"><ion-icon :icon="imageOutline" aria-hidden="true" /></span>

                    <div class="history-copy">
                      <strong>{{ record.class_name }}</strong>
                      <small>{{ formatDateTime(record.meeting_starts_at) }}</small>
                      <small v-if="record.is_inferred">No check-in was recorded before the meeting ended.</small>
                      <small v-if="record.location_status === 'teacher_confirmed_on_campus'">Inside school · marked present by teacher</small>
                    </div>

                    <div class="history-meta">
                      <ion-button size="small" fill="outline" @click="openEvidence(record, dashboard.student.full_name)">Details</ion-button>
                      <span class="attendance-pill" :class="record.attendance_enabled === false ? 'is-not-counted' : record.status === 'present' ? 'is-present' : 'is-absent'">
                        {{ attendanceLabel(record) }}
                      </span>
                      <small class="history-verification" :class="verificationClass(record.verification_status)">
                        {{ verificationLabel(record.verification_status, record.is_inferred) }}
                      </small>
                      <a
                        v-if="record.latitude != null && record.longitude != null"
                        :href="mapUrl(record.latitude, record.longitude)"
                        target="_blank"
                        rel="noopener"
                        aria-label="Open submitted location in Google Maps"
                      >
                        <ion-icon :icon="locationOutline" aria-hidden="true" /> Location
                      </a>
                    </div>
                  </article>
                </div>
              </section>
            </template>

            <section v-else-if="activeSection !== 'schedule'" class="student-empty">
              <div class="empty-icon" aria-hidden="true"><ion-icon :icon="calendarOutline" /></div>
              <div>
                <h3>No attendance records yet</h3>
                <p>Present and absent attendance will appear here after meetings take place.</p>
              </div>
            </section>
          </article>
        </div>
      </main>
    </ion-content>
    <evidence-detail-modal :record="selectedEvidence" :student-name="selectedStudentName" @close="selectedEvidence = null" />
    <app-modal :open="Boolean(selectedLink)" :title="approveLink ? 'Approve student link' : 'Decline student link'" :busy="respondingLink" @close="closeLinkReview"><template v-if="selectedLink"><h3>{{ selectedLink.student_name }}</h3><p class="consent-description">{{ selectedLink.student_email }}</p><p class="consent-description">{{ approveLink ? 'Approving this request links you as a parent or guardian. You will be able to see this student’s attendance, school schedule, check-in photos, and submitted locations.' : 'Declining this request will not share this student’s attendance with your account.' }}</p><label v-if="approveLink" class="confirm-student"><input v-model="confirmedStudent" type="checkbox" :disabled="respondingLink" /><span>I have verified this student’s identity and confirm that I am their parent or guardian.</span></label><p v-if="linkError" class="consent-error" role="alert">{{ linkError }}</p></template><template #actions><ion-button fill="outline" :disabled="respondingLink" @click="closeLinkReview">Cancel</ion-button><ion-button :disabled="respondingLink || (approveLink && !confirmedStudent)" @click="respondToLink">{{ respondingLink ? 'Saving…' : approveLink ? 'Approve link' : 'Decline link' }}</ion-button></template></app-modal>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonIcon,
  IonPage,
  IonSpinner,
  onIonViewWillEnter,
} from '@ionic/vue'
import {
  alertCircleOutline,
  calendarOutline,
  checkmarkCircleOutline,
  closeCircleOutline,
  hourglassOutline,
  imageOutline,
  linkOutline,
  locationOutline,
  logOutOutline,
  openOutline,
  peopleOutline,
  schoolOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from 'ionicons/icons'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useSession } from '@/composables/useSession'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { supabase } from '@/lib/supabase'
import { loadAttendanceHistory, loadParentOnlineLocations } from '@/services/attendanceHistory'
import PortalHeader from '@/components/PortalHeader.vue'
import EvidenceDetailModal from '@/components/EvidenceDetailModal.vue'
import AttendancePhoto from '@/components/AttendancePhoto.vue'
import ParentCalendarPanel from '@/components/ParentCalendarPanel.vue'
import AppModal from '@/components/AppModal.vue'
import type { ScheduleCourse } from '@/utils/studentScheduleCalendar'
import { toUserFacingErrorMessage } from '@/utils/errors'

interface StudentRow {
  id: string
  full_name: string
  email: string
}

interface AttendanceDisplayRow {
  id: string
  attendance_id: string | null
  meeting_id: string
  student_id: string
  status: 'present' | 'absent'
  verification_status: 'pending' | 'approved' | 'rejected' | null
  latitude: number | null
  longitude: number | null
  distance_m: number | null
  selfie_path: string | null
  selfie_url: string | null
  submitted_at: string | null
  meeting_starts_at: string
  class_name: string
  review_note: string | null
  attendance_enabled: boolean
  attendance_mode: string
  is_inferred: boolean
  location_status?: string
}
interface ParentLinkRequest { id: string; student_id: string; student_name: string; student_email: string; status: string; requested_at: string }

const router = useRouter()
const route = useRoute()
const { initializeSession, profile, signOut } = useSession()
const loading = ref(true)
const refreshing = ref(false)
const signingOut = ref(false)
const students = ref<StudentRow[]>([])
const attendance = ref<AttendanceDisplayRow[]>([])
const studentCourses = ref<Record<string, ScheduleCourse[]>>({})
const linkRequests = ref<ParentLinkRequest[]>([])
const pendingLinks = computed(() => linkRequests.value.filter(link => link.status === 'pending'))
const selectedLink = ref<ParentLinkRequest | null>(null), approveLink = ref(true), confirmedStudent = ref(false), respondingLink = ref(false), linkError = ref(''), successMessage = ref('')
let successTimeout: ReturnType<typeof setTimeout> | undefined
const message = ref('')
const selectedEvidence = ref<AttendanceDisplayRow | null>(null)
const selectedStudentName = ref('')
const activeSection = computed(() => route.query.section === 'history' ? 'history' : route.query.section === 'schedule' ? 'schedule' : 'overview')

const studentDashboards = computed(() => students.value.map((student) => {
  const records = attendance.value.filter((record) => record.student_id === student.id)
  const counted = records.filter(record => record.attendance_enabled !== false)
  const present = counted.filter(record => record.status === 'present' && record.verification_status !== 'rejected').length
  return { student, records, latest: records[0] ?? null, courses: studentCourses.value[student.id] || [], present, absent: counted.length - present }
}))

let dashboardRequest = 0
async function loadDashboard() {
  const request = ++dashboardRequest
  const parentId = profile.value?.id
  if (!parentId || profile.value?.role !== 'parent') return
  const isCurrent = () => request === dashboardRequest && profile.value?.id === parentId && profile.value?.role === 'parent'
  refreshing.value = true
  message.value = ''

  try {
    const [linkResult, requests] = await Promise.all([
      supabase.from('guardian_links').select('student_id').eq('parent_id', parentId).order('created_at'),
      supabase.rpc('my_parent_link_requests'),
    ])
    const { data: links, error: linksError } = linkResult
    if (linksError) throw linksError
    if (requests.error) throw requests.error
    if (!isCurrent()) return
    linkRequests.value = Array.isArray(requests.data) ? requests.data : []

    const studentIds = (links ?? []).map((link) => link.student_id)
    if (!studentIds.length) {
      students.value = []
      attendance.value = []
      studentCourses.value = {}
      selectedEvidence.value = null
      return
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id,full_name,email')
      .in('id', studentIds)
    if (profilesError) throw profilesError
    if (!isCurrent()) return
    const results = await Promise.all(studentIds.map(async studentId => {
      const [history, locations, enrollments] = await Promise.all([
        loadAttendanceHistory<AttendanceDisplayRow>(studentId, isCurrent),
        loadParentOnlineLocations<{ attendance_id: string; latitude: number; longitude: number }>(studentId, isCurrent),
        supabase.from('class_enrollments').select('class_id,class:classes(id,name,archived_at)').eq('student_id', studentId).eq('is_active', true),
      ])
      if (!isCurrent()) return { studentId, records: [], courses: [] }
      if (enrollments.error) throw enrollments.error
      const locationById = new Map<string, { latitude: number; longitude: number }>(locations.map(location => [location.attendance_id, location]))
      const records = history.map(record => {
        const location = record.attendance_id ? locationById.get(record.attendance_id) : null
        return { ...record, latitude: location?.latitude ?? record.latitude, longitude: location?.longitude ?? record.longitude, selfie_url: null as string | null }
      })
      if (!isCurrent()) return { studentId, records: [], courses: [] }
      const classRows = (enrollments.data ?? []) as unknown as Array<{ class_id: string; class: { id: string; name: string; archived_at?: string | null } | Array<{ id: string; name: string; archived_at?: string | null }> | null }>
      const courses = classRows.flatMap(row => Array.isArray(row.class) ? row.class : row.class ? [row.class] : []).filter(course => !course.archived_at)
      return { studentId, records, courses }
    }))
    if (!isCurrent()) return
    students.value = (profiles ?? []) as StudentRow[]
    attendance.value = results.flatMap(result => result.records).sort((a, b) => b.meeting_starts_at.localeCompare(a.meeting_starts_at))
    studentCourses.value = Object.fromEntries(results.map(result => [result.studentId, result.courses]))
    if (selectedEvidence.value) selectedEvidence.value = attendance.value.find(record => record.id === selectedEvidence.value?.id) ?? null
  } catch (error) {
    if (isCurrent()) message.value = toUserFacingErrorMessage(error, 'Unable to load parent attendance.')
  } finally {
    if (isCurrent()) refreshing.value = false
  }
}

function locationLabel(record: AttendanceDisplayRow) {
  if (record.location_status === 'teacher_confirmed_on_campus') return 'Inside school · marked present by teacher'
  if (record.location_status === 'gps_on_campus') return 'Inside the school boundary'
  return record.attendance_mode === 'self_online' ? 'No location was saved for this record' : 'No submitted location'
}
function openLinkReview(request: ParentLinkRequest, approve: boolean) { selectedLink.value = request; approveLink.value = approve; confirmedStudent.value = false; linkError.value = '' }
function closeLinkReview() { if (!respondingLink.value) selectedLink.value = null }
async function respondToLink() {
  if (!selectedLink.value || respondingLink.value || (approveLink.value && !confirmedStudent.value)) return
  respondingLink.value = true; linkError.value = ''
  try {
    const result = await supabase.rpc('respond_to_parent_link_request', { p_request_id: selectedLink.value.id, p_approve: approveLink.value, p_note: null })
    if (result.error) throw result.error
    const approved = approveLink.value
    selectedLink.value = null; await loadDashboard()
    successMessage.value = approved ? 'Student link approved. Their attendance and calendar are now available.' : 'Student link declined.'
    clearTimeout(successTimeout); successTimeout = setTimeout(() => { successMessage.value = '' }, 5000)
  } catch (error) { linkError.value = toUserFacingErrorMessage(error, 'The student link could not be updated.') }
  finally { respondingLink.value = false }
}

function openEvidence(record: AttendanceDisplayRow, name: string) {
  selectedStudentName.value = name
  selectedEvidence.value = record
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'ST'
}

function attendanceLabel(record: AttendanceDisplayRow) {
  if (!record.attendance_enabled) return 'Meeting not counted'
  if (record.verification_status === 'rejected') return 'Voided by teacher'
  return record.status === 'present' ? 'Present' : 'Absent'
}

function verificationLabel(status: AttendanceDisplayRow['verification_status'], inferred = false) {
  if (inferred) return 'No check-in recorded'
  if (status === 'approved') return 'Self-check accepted'
  if (status === 'rejected') return 'Voided by teacher'
  if (status === 'pending') return 'Legacy review pending'
  return 'Teacher-recorded attendance'
}

function verificationClass(status: AttendanceDisplayRow['verification_status']) {
  if (status === 'approved') return 'is-approved'
  if (status === 'rejected') return 'is-rejected'
  if (status === 'pending') return 'is-pending'
  return 'is-recorded'
}

function verificationIcon(status: AttendanceDisplayRow['verification_status']) {
  if (status === 'approved') return shieldCheckmarkOutline
  if (status === 'rejected') return closeCircleOutline
  if (status === 'pending') return hourglassOutline
  return checkmarkCircleOutline
}

function formatDateTime(value: string | null) {
  if (!value || Number.isNaN(new Date(value).getTime())) return 'Not submitted'
  return new Intl.DateTimeFormat(undefined, {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function mapUrl(latitude: number, longitude: number) {
  return `https://www.google.com/maps?q=${encodeURIComponent(`${latitude},${longitude}`)}`
}

async function logout() {
  signingOut.value = true
  try {
    await signOut()
    await router.replace('/login')
  } finally {
    signingOut.value = false
  }
}

onMounted(async () => {
  try {
    await initializeSession()
    if (profile.value?.role === 'parent') await loadDashboard()
  } catch (error) {
    message.value = toUserFacingErrorMessage(error, 'Unable to load the parent account.')
  } finally {
    loading.value = false
  }
})

onIonViewWillEnter(async () => {
  if (loading.value || refreshing.value || signingOut.value || selectedEvidence.value || profile.value?.role !== 'parent') return
  await loadDashboard()
})
useRealtimeRefresh({ channel: 'family-attendance', enabled: () => profile.value?.role === 'parent', onChange: loadDashboard })
watch(() => profile.value?.id, () => {
  dashboardRequest++
  students.value = []
  attendance.value = []
  studentCourses.value = {}
  linkRequests.value = []; selectedLink.value = null; successMessage.value = ''; clearTimeout(successTimeout)
  selectedEvidence.value = null
  refreshing.value = false
})
watch(activeSection, () => { if (!loading.value && profile.value?.role === 'parent') void loadDashboard() })
onBeforeUnmount(() => { dashboardRequest++; clearTimeout(successTimeout) })
</script>

<style scoped>
.attendance-totals { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; }
.attendance-total { display:flex; align-items:center; gap:18px; padding:26px; border:1px solid var(--campus-border); border-radius:16px; background:var(--campus-surface-soft); }
.attendance-total > ion-icon { font-size:30px; color:var(--campus-success); }
.attendance-total.is-absent > ion-icon { color:var(--campus-danger); }
.attendance-total div { display:grid; gap:7px; }
.attendance-total span { color:var(--campus-muted); font-size:13px; }
.attendance-total strong { color:var(--campus-text); font-size:34px; line-height:1; }
.attendance-totals > p { grid-column:1/-1; margin:0; color:var(--campus-muted); font-size:12px; }
@media(max-width:520px) { .attendance-totals { gap:10px; }.attendance-total { padding:18px 12px; gap:10px; }.attendance-total > ion-icon { font-size:24px; }.attendance-total strong { font-size:30px; } }
.link-requests { margin-bottom:24px; padding:22px; border:1px solid var(--campus-border); border-radius:16px; background:var(--campus-surface); }.link-requests h2 { margin:0; color:var(--campus-text); font-size:20px; }.link-requests header>p:last-child,.consent-description { color:var(--campus-muted); font-size:13px; line-height:1.6; }.link-requests article { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:16px; padding:18px 0; border-top:1px solid var(--campus-border); }.link-requests article:last-child { padding-bottom:0; }.link-requests article>div:first-child { display:grid; gap:5px; min-width:0; }.link-requests strong { color:var(--campus-text); font-size:14px; }.link-requests span,.link-requests small { color:var(--campus-muted); font-size:12px; overflow-wrap:anywhere; }.consent-actions { display:flex; flex-wrap:wrap; gap:6px; }.confirm-student { display:flex; align-items:start; gap:12px; padding:14px; border:1px solid var(--campus-border); border-radius:10px; color:var(--campus-text); font-size:13px; line-height:1.6; }.confirm-student input { flex:0 0 auto; width:20px; height:20px; accent-color:var(--campus-accent); }.consent-error { color:var(--campus-danger); font-size:13px; }.consent-success { padding:14px; margin:0 0 18px; border-radius:10px; color:var(--campus-success); background:var(--campus-success-soft); font-size:13px; }.photo-button { padding:0; border:0; cursor:pointer; }.photo-button:focus-visible { outline:3px solid var(--campus-accent); outline-offset:3px; }.latest-photo { height:160px; border-radius:12px; }
.weekly-schedule-card { border: 1px solid var(--campus-border); border-radius: 16px; background: var(--campus-surface); padding: 22px; margin: 0 0 22px; }
.weekly-schedule-list { display: grid; margin-top: 16px; }
.weekly-meeting { display: flex; align-items: center; gap: 14px; padding: 16px 0; border-top: 1px solid var(--campus-border); }
.weekly-day { width: 42px; flex: 0 0 auto; color: var(--campus-green); font-size: 12px; font-weight: 700; }
.weekly-meeting > div { display: grid; flex: 1; min-width: 0; gap: 4px; }
.weekly-meeting strong { font-size: 13px; color: var(--campus-text); }
.weekly-meeting span:not(.attendance-pill):not(.weekly-day), .weekly-meeting small { font-size: 12px; color: var(--campus-muted); }
.weekly-empty { margin: 16px 0 0; color: var(--campus-muted); font-size: 13px; }
@media (max-width: 600px) { .weekly-schedule-card { padding: 16px; } .weekly-meeting { flex-wrap: wrap; gap: 9px; } .weekly-meeting .attendance-pill { margin-left: 51px; } }
.is-not-counted { background: var(--campus-surface-soft) !important; color: var(--campus-muted) !important; }
.is-not-counted .status-icon { color: var(--campus-muted); background: var(--campus-surface); }
.dashboard-page {
  --campus-accent-local: var(--campus-accent, #087443);
  --campus-navy-local: var(--campus-navy, #063f2a);
  --campus-bg-local: var(--campus-bg, #f5f5ef);
  --campus-surface-local: var(--campus-surface, #ffffff);
  --campus-surface-soft-local: var(--campus-surface-soft, #f5f8fa);
  --campus-accent-soft-local: var(--campus-accent-soft, #e6f0e9);
  --campus-text-local: var(--campus-text, #182632);
  --campus-muted-local: var(--campus-muted, #62727f);
  --campus-border-local: var(--campus-border, #d9e2e9);
  --campus-success-local: var(--campus-success, #147a50);
  --campus-success-soft-local: var(--campus-success-soft, #e1f4eb);
  --campus-danger-local: var(--campus-danger, #bb3e45);
  --campus-danger-soft-local: var(--campus-danger-soft, #fae9ea);
  --campus-warning-local: var(--campus-warning, #91620d);
  --campus-warning-soft-local: var(--campus-warning-soft, #fff3d5);
  color: var(--campus-text-local);
}

.app-header {
  box-shadow: none;
}

.app-toolbar {
  --background: var(--campus-surface-local);
  --border-color: var(--campus-border-local);
  --min-height: 70px;
  --padding-start: max(14px, calc((100vw - 1120px) / 2));
  --padding-end: max(8px, calc((100vw - 1120px) / 2));
}

.toolbar-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}

.toolbar-mark {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 12px;
  background: var(--campus-navy-local);
  color: #ffffff;
}

.toolbar-brand strong,
.toolbar-brand small {
  display: block;
}

.toolbar-brand strong {
  font-size: 14px;
  font-weight: 650;
}

.toolbar-brand small {
  margin-top: 2px;
  color: var(--campus-muted-local);
  font-size: 11px;
}

.sign-out-button {
  --color: var(--campus-muted-local);
  text-transform: none;
}

.dashboard-content {
  --background: var(--campus-bg-local);
}

.dashboard-shell {
  width: min(100%, 1180px);
  margin: 0 auto;
  padding: 32px 28px 56px;
}

.loading-state {
  display: grid;
  min-height: 60vh;
  place-items: center;
  align-content: center;
  gap: 12px;
  color: var(--campus-muted-local);
}

.loading-state p {
  margin: 0;
  font-size: 13px;
}

.page-heading,
.student-heading,
.section-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
}

.page-heading {
  margin-bottom: 24px;
}

.eyebrow {
  margin: 0 0 6px;
  color: var(--campus-muted-local);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.page-heading h1,
.student-heading h2,
.section-title h3,
.student-empty h3 {
  margin: 0;
  color: var(--campus-text-local);
  font-weight: 600;
  letter-spacing: -0.025em;
}

.page-heading h1 {
  font-size: clamp(27px, 4vw, 38px);
}

.page-heading > div > p:last-child,
.student-heading .student-identity p:last-child,
.student-empty p {
  margin: 7px 0 0;
  color: var(--campus-muted-local);
  font-size: 13px;
  line-height: 1.5;
}

.secondary-button {
  --border-color: var(--campus-border-local);
  --border-radius: 11px;
  --color: var(--campus-accent-local);
  --padding-start: 15px;
  --padding-end: 15px;
  min-height: 42px;
  margin: 0;
  text-transform: none;
}

.page-message {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-bottom: 20px;
  padding: 13px 15px;
  border-radius: 13px;
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
  font-size: 13px;
  line-height: 1.45;
}

.page-message ion-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  font-size: 18px;
}

.empty-state {
  display: grid;
  min-height: 360px;
  place-items: center;
  align-content: center;
  padding: 36px;
  border: 1px solid var(--campus-border-local);
  border-radius: var(--campus-radius, 20px);
  background: var(--campus-surface-local);
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 58px;
  height: 58px;
  place-items: center;
  margin-bottom: 14px;
  border-radius: 18px;
  background: var(--campus-accent-soft-local);
  color: var(--campus-accent-local);
  font-size: 26px;
}

.empty-state h2 {
  margin: 0;
  font-size: 21px;
}

.empty-state p {
  max-width: 510px;
  margin: 10px 0 0;
  color: var(--campus-muted-local);
  font-size: 14px;
  line-height: 1.6;
}

.student-dashboards {
  display: grid;
  gap: 26px;
}

.student-dashboard {
  padding: clamp(18px, 3vw, 28px);
  border: 1px solid var(--campus-border-local);
  border-radius: var(--campus-radius, 20px);
  background: var(--campus-surface-local);
  box-shadow: var(--campus-shadow, 0 15px 45px rgba(6, 63, 42, 0.08));
}

.student-heading {
  align-items: center;
  margin-bottom: 22px;
}

.student-identity {
  display: flex;
  align-items: center;
  gap: 13px;
  min-width: 0;
}

.student-avatar {
  display: grid;
  width: 48px;
  height: 48px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 15px;
  background: var(--campus-accent-soft-local);
  color: var(--campus-accent-local);
  font-size: 13px;
  font-weight: 700;
}

.student-heading h2 {
  font-size: 20px;
}

.student-heading .student-identity p:last-child {
  overflow: hidden;
  margin-top: 3px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.linked-badge,
.verification-pill,
.attendance-pill,
.record-count {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.linked-badge {
  padding: 7px 10px;
  background: var(--campus-accent-soft-local);
  color: var(--campus-accent-local);
}

.latest-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.75fr) minmax(410px, 1.25fr);
  gap: 16px;
  margin-top: 16px;
}
.latest-photo-button { display: block; width: 100%; height: 160px; overflow: hidden; border-radius: 12px; }
.verification-pill.is-missing { color: var(--campus-muted-local); background: var(--campus-surface-soft-local); }

.status-card,
.evidence-card,
.history-card,
.student-empty {
  border: 1px solid var(--campus-border-local);
  border-radius: 17px;
  background: var(--campus-surface-local);
}

.status-card {
  padding: 24px;
  background: linear-gradient(145deg, var(--campus-surface-local), var(--campus-surface-soft-local));
}

.status-icon {
  display: grid;
  width: 50px;
  height: 50px;
  place-items: center;
  margin-bottom: 24px;
  border-radius: 16px;
  font-size: 26px;
}

.status-card.is-present .status-icon {
  background: var(--campus-success-soft-local);
  color: var(--campus-success-local);
}

.status-card.is-absent .status-icon {
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
}

.status-card h3 {
  margin: 0;
  font-size: 34px;
  font-weight: 600;
  letter-spacing: -0.04em;
}

.status-card.is-present h3 {
  color: var(--campus-success-local);
}

.status-card.is-absent h3 {
  color: var(--campus-danger-local);
}

.meeting-name {
  margin: 8px 0 0;
  color: var(--campus-text-local);
  font-size: 13px;
  font-weight: 550;
  line-height: 1.5;
}

.meeting-time {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 7px 0 18px;
  color: var(--campus-muted-local);
  font-size: 12px;
}

.verification-pill {
  padding: 7px 9px;
}

.verification-pill.is-approved,
.verification-pill.is-recorded {
  background: var(--campus-success-soft-local);
  color: var(--campus-success-local);
}

.verification-pill.is-rejected {
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
}

.verification-pill.is-pending {
  background: var(--campus-warning-soft-local);
  color: var(--campus-warning-local);
}

.evidence-card {
  padding: 22px;
}

.section-title {
  align-items: center;
}

.section-title h3 {
  font-size: 17px;
}

.section-title > ion-icon {
  color: var(--campus-accent-local);
  font-size: 22px;
}

.evidence-body {
  display: grid;
  grid-template-columns: minmax(120px, 155px) 1fr;
  gap: 20px;
  margin-top: 18px;
}

.photo-proof {
  margin: 0;
}

.photo-proof img,
.photo-placeholder {
  width: 100%;
  aspect-ratio: 4 / 5;
  border-radius: 14px;
  object-fit: cover;
  background: var(--campus-bg-local);
}

.photo-placeholder {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 7px;
  color: var(--campus-muted-local);
  font-size: 11px;
  text-align: center;
}

.photo-placeholder ion-icon {
  font-size: 28px;
}

.photo-placeholder.is-unavailable,
.history-photo.is-placeholder.is-unavailable {
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
}

.photo-proof figcaption {
  margin-top: 7px;
  color: var(--campus-muted-local);
  font-size: 10px;
  text-align: center;
}

.evidence-details {
  display: grid;
  align-content: center;
  gap: 16px;
}

.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.detail-icon {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  background: var(--campus-accent-soft-local);
  color: var(--campus-accent-local);
}

.detail-row small,
.detail-row strong {
  display: block;
}

.detail-row small {
  color: var(--campus-muted-local);
  font-size: 10px;
}

.detail-row strong {
  margin-top: 3px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.4;
}

.detail-row a,
.history-meta a {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
  color: var(--campus-accent-local);
  font-size: 11px;
  font-weight: 600;
  text-decoration: none;
}

.history-card {
  margin-top: 16px;
  padding: 22px;
}

.history-title {
  margin-bottom: 8px;
}

.record-count {
  padding: 6px 9px;
  background: var(--campus-bg-local);
  color: var(--campus-muted-local);
}

.history-list {
  display: grid;
}

.history-row {
  display: grid;
  grid-template-columns: 48px minmax(150px, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 13px 0;
  border-top: 1px solid var(--campus-border-local);
}

.history-photo {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 12px;
  object-fit: cover;
}

.history-photo.is-placeholder {
  background: var(--campus-bg-local);
  color: var(--campus-muted-local);
}

.history-copy,
.history-meta {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.history-copy strong {
  overflow: hidden;
  color: var(--campus-text-local);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-copy span,
.history-copy small,
.history-meta small {
  overflow: hidden;
  color: var(--campus-muted-local);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-copy .photo-state {
  color: var(--campus-danger-local);
}

.history-verification.is-approved,
.history-verification.is-recorded {
  color: var(--campus-success-local);
}

.history-verification.is-rejected {
  color: var(--campus-danger-local);
}

.history-verification.is-pending {
  color: var(--campus-warning-local);
}

.history-meta {
  justify-items: end;
}

.attendance-pill {
  padding: 6px 9px;
}

.attendance-pill.is-present {
  background: var(--campus-success-soft-local);
  color: var(--campus-success-local);
}

.attendance-pill.is-absent {
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
}

.student-empty {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 24px;
}

.student-empty .empty-icon {
  margin: 0;
}

.student-empty h3 {
  font-size: 16px;
}

@media (max-width: 800px) {
  .latest-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .app-toolbar {
    --min-height: 62px;
  }

  .toolbar-brand small,
  .button-label {
    display: none;
  }

  .dashboard-shell {
    padding: 24px 14px 44px;
  }

  .page-heading {
    display: grid;
  }

  .secondary-button {
    width: fit-content;
  }

  .student-heading {
    align-items: flex-start;
  }

  .linked-badge {
    font-size: 0;
  }

  .linked-badge ion-icon {
    font-size: 15px;
  }

  .evidence-body {
    grid-template-columns: 105px 1fr;
    gap: 14px;
  }

  .history-row {
    grid-template-columns: 44px minmax(0, 1fr);
  }

  .history-photo {
    width: 44px;
    height: 44px;
  }

  .history-meta {
    grid-column: 2;
    justify-items: start;
  }
}

@media (max-width: 400px) {
  .evidence-body {
    grid-template-columns: 1fr;
  }

  .photo-proof {
    width: 120px;
  }
}
</style>
