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
            <h1>{{ activeSection === 'history' ? 'Attendance history' : activeSection === 'schedule' ? 'This week’s classes' : 'Your child’s attendance' }}</h1>
            <p>{{ activeSection === 'history' ? 'Every past class, including present, absent, and meetings that were not counted.' : activeSection === 'schedule' ? 'Your linked children’s current weekly schedule, updated automatically.' : 'Follow attendance and view check-in photos and locations.' }}</p>
          </div>
        </header>

        <div v-if="message" class="page-message" role="alert">
          <ion-icon :icon="alertCircleOutline" aria-hidden="true" />
          <span>{{ message }}</span>
        </div>

        <section v-if="students.length === 0" class="empty-state" aria-labelledby="no-student-title">
          <div class="empty-icon" aria-hidden="true"><ion-icon :icon="peopleOutline" /></div>
          <h2 id="no-student-title">No student is linked yet</h2>
          <p>
            Ask the student to use this account’s confirmed email address as their parent or guardian
            email during registration.
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

            <section v-if="activeSection === 'overview' || activeSection === 'schedule'" class="weekly-schedule-card">
              <div class="section-title"><div><p class="eyebrow">Current week · {{ weekLabel }}</p><h3>Weekly schedule</h3></div><span class="record-count">{{ dashboard.schedule.length }} meetings</span></div>
              <div v-if="dashboard.schedule.length" class="weekly-schedule-list"><article v-for="meeting in dashboard.schedule" :key="meeting.id" class="weekly-meeting"><span class="weekly-day">{{ weekday(meeting.starts_at) }}</span><div><strong>{{ meeting.class_name }}</strong><span>{{ meeting.title }}</span><small>{{ formatDateTime(meeting.starts_at) }} – {{ formatTime(meeting.ends_at) }}</small></div><span class="attendance-pill" :class="meeting.attendance_enabled ? 'is-present' : 'is-not-counted'">{{ meeting.attendance_enabled ? 'Scheduled' : 'Not counted' }}</span></article></div>
              <p v-else class="weekly-empty">No classes scheduled for this week.</p>
            </section>

            <template v-if="dashboard.latest && activeSection !== 'schedule'">
              <div v-if="activeSection === 'overview'" class="latest-grid">
                <section
                  class="status-card"
                  :class="dashboard.latest.attendance_enabled === false ? 'is-not-counted' : dashboard.latest.status === 'present' ? 'is-present' : 'is-absent'"
                  :aria-labelledby="`latest-status-heading-${dashboard.student.id}`"
                >
                  <div class="status-icon" aria-hidden="true">
                    <ion-icon :icon="dashboard.latest.status === 'present' ? checkmarkCircleOutline : closeCircleOutline" />
                  </div>
                  <p class="eyebrow">Latest attendance</p>
                  <h3 :id="`latest-status-heading-${dashboard.student.id}`">
                    {{ attendanceLabel(dashboard.latest) }}
                  </h3>
                  <p class="meeting-name">{{ dashboard.latest.class_name }} · {{ dashboard.latest.meeting_title }}</p>
                  <p class="meeting-time">
                    <ion-icon :icon="calendarOutline" aria-hidden="true" />
                    {{ formatDateTime(dashboard.latest.meeting_starts_at) }}
                  </p>
                  <span class="verification-pill" :class="verificationClass(dashboard.latest.verification_status)">
                    <ion-icon :icon="verificationIcon(dashboard.latest.verification_status)" aria-hidden="true" />
                    {{ verificationLabel(dashboard.latest.verification_status) }}
                  </span>
                </section>

                <section
                  class="evidence-card"
                  :aria-labelledby="`evidence-heading-${dashboard.student.id}`"
                >
                  <div class="section-title">
                    <div>
                      <p class="eyebrow">Attendance details</p>
                      <h3 :id="`evidence-heading-${dashboard.student.id}`">Check-in details</h3>
                    </div>
                    <ion-button size="small" fill="outline" @click="openEvidence(dashboard.latest, dashboard.student.full_name)">View details</ion-button>
                  </div>

                  <div class="evidence-body">
                    <figure class="photo-proof">
                      <img
                        v-if="dashboard.latest.selfie_url"
                        :src="dashboard.latest.selfie_url"
                        :alt="`${dashboard.student.full_name}'s latest attendance check-in`"
                        loading="lazy"
                      />
                      <div
                        v-else
                        class="photo-placeholder"
                        :class="{ 'is-unavailable': dashboard.latest.selfie_path }"
                      >
                        <ion-icon
                          :icon="dashboard.latest.selfie_path ? alertCircleOutline : imageOutline"
                          aria-hidden="true"
                        />
                        <span>
                          {{ dashboard.latest.selfie_path ? 'Photo could not be loaded' : 'No photo required' }}
                        </span>
                      </div>
                      <figcaption>Check-in photo</figcaption>
                    </figure>

                    <div class="evidence-details">
                      <div class="detail-row">
                        <span class="detail-icon"><ion-icon :icon="timeOutline" /></span>
                        <span><small>Submitted</small><strong>{{ formatDateTime(dashboard.latest.submitted_at) }}</strong></span>
                      </div>

                      <div v-if="dashboard.latest.latitude != null && dashboard.latest.longitude != null" class="detail-row">
                        <span class="detail-icon"><ion-icon :icon="locationOutline" /></span>
                        <span>
                          <small>Submitted location</small>
                          <strong v-if="dashboard.latest.distance_m != null">
                            {{ Math.round(dashboard.latest.distance_m) }} m from class location
                          </strong>
                          <strong v-else>Location captured</strong>
                          <a
                            :href="mapUrl(dashboard.latest.latitude, dashboard.latest.longitude)"
                            target="_blank"
                            rel="noopener"
                          >
                            View on Google Maps <ion-icon :icon="openOutline" aria-hidden="true" />
                          </a>
                        </span>
                      </div>

                      <div v-else class="detail-row">
                        <span class="detail-icon"><ion-icon :icon="locationOutline" /></span>
                        <span><small>Location</small><strong>{{ dashboard.latest.attendance_mode === 'self_online' ? 'No location was saved for this record' : 'No submitted location' }}</strong></span>
                      </div>
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
                    <span
                      class="history-photo is-placeholder"
                      role="img"
                      :aria-label="record.selfie_path ? 'Attendance photo available in Details' : 'No photo was required'"
                      :title="record.selfie_path ? 'Open Details to view the attendance photo' : 'No photo was required'"
                    >
                      <ion-icon :icon="imageOutline" aria-hidden="true" />
                    </span>

                    <div class="history-copy">
                      <strong>{{ record.class_name }}</strong>
                      <span>{{ record.meeting_title }}</span>
                      <small>{{ formatDateTime(record.meeting_starts_at) }}</small>
                      <small v-if="record.is_inferred">No check-in was recorded before the meeting ended.</small>
                      <small v-if="record.selfie_path" class="photo-available">
                        Photo available in Details
                      </small>
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
  meeting_title: string
  meeting_starts_at: string
  class_name: string
  review_note: string | null
  attendance_enabled: boolean
  attendance_mode: string
  is_inferred: boolean
}
interface WeeklyMeeting { id: string; student_id: string; class_id: string; title: string; class_name: string; starts_at: string; ends_at: string; attendance_enabled: boolean }

const router = useRouter()
const route = useRoute()
const { initializeSession, profile, signOut } = useSession()
const loading = ref(true)
const refreshing = ref(false)
const signingOut = ref(false)
const students = ref<StudentRow[]>([])
const attendance = ref<AttendanceDisplayRow[]>([])
const weeklyMeetings = ref<WeeklyMeeting[]>([])
const message = ref('')
const selectedEvidence = ref<AttendanceDisplayRow | null>(null)
const selectedStudentName = ref('')
const activeSection = computed(() => route.query.section === 'history' ? 'history' : route.query.section === 'schedule' ? 'schedule' : 'overview')
const weekLabel = ref('')

const studentDashboards = computed(() => students.value.map((student) => {
  const records = attendance.value.filter((record) => record.student_id === student.id)
  return { student, records, latest: records[0] ?? null, schedule: weeklyMeetings.value.filter(meeting => meeting.student_id === student.id) }
}))

let dashboardRequest = 0
const photoCache = new Map<string, { url: string; expires: number }>()
async function latestPhoto(path: string, isCurrent: () => boolean): Promise<string | null> {
  const cached = photoCache.get(path)
  if (cached && cached.expires > Date.now()) return cached.url
  const signed = await supabase.storage.from('attendance-selfies').createSignedUrl(path, 900)
  if (!isCurrent() || signed.error || !signed.data?.signedUrl) return null
  const url = signed.data.signedUrl
  photoCache.set(path, { url, expires: Date.now() + 14 * 60_000 })
  for (const [key, value] of photoCache) if (value.expires <= Date.now()) photoCache.delete(key)
  return url
}
async function loadDashboard() {
  const request = ++dashboardRequest
  const parentId = profile.value?.id
  if (!parentId || profile.value?.role !== 'parent') return
  const isCurrent = () => request === dashboardRequest && profile.value?.id === parentId && profile.value?.role === 'parent'
  refreshing.value = true
  message.value = ''

  try {
    const { data: links, error: linksError } = await supabase
      .from('guardian_links')
      .select('student_id')
      .eq('parent_id', parentId)
      .order('created_at')
    if (linksError) throw linksError
    if (!isCurrent()) return

    const studentIds = (links ?? []).map((link) => link.student_id)
    if (!studentIds.length) {
      students.value = []
      attendance.value = []
      weeklyMeetings.value = []
      selectedEvidence.value = null
      return
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id,full_name,email')
      .in('id', studentIds)
    if (profilesError) throw profilesError
    if (!isCurrent()) return
    const week = currentWeek()
    const results = await Promise.all(studentIds.map(async studentId => {
      const [history, locations, enrollments] = await Promise.all([
        loadAttendanceHistory<AttendanceDisplayRow>(studentId, isCurrent),
        loadParentOnlineLocations<{ attendance_id: string; latitude: number; longitude: number }>(studentId, isCurrent),
        supabase.from('class_enrollments').select('class_id,class:classes(id,name,archived_at)').eq('student_id', studentId).eq('is_active', true),
      ])
      if (!isCurrent()) return { records: [], schedule: [] }
      if (enrollments.error) throw enrollments.error
      const locationById = new Map<string, { latitude: number; longitude: number }>(locations.map(location => [location.attendance_id, location]))
      const records = history.map(record => {
        const location = record.attendance_id ? locationById.get(record.attendance_id) : null
        return { ...record, latitude: location?.latitude ?? record.latitude, longitude: location?.longitude ?? record.longitude, selfie_url: null as string | null }
      })
      if (activeSection.value === 'overview' && records[0]?.selfie_path) records[0].selfie_url = await latestPhoto(records[0].selfie_path, isCurrent)
      if (!isCurrent()) return { records: [], schedule: [] }
      const classRows = (enrollments.data ?? []) as unknown as Array<{ class_id: string; class: { id: string; name: string; archived_at?: string | null } | Array<{ id: string; name: string; archived_at?: string | null }> | null }>
      const courses = classRows.flatMap(row => Array.isArray(row.class) ? row.class : row.class ? [row.class] : []).filter(course => !course.archived_at)
      let schedule: WeeklyMeeting[] = []
      if (courses.length) {
        const meetings = await supabase.from('meetings').select('id,class_id,title,starts_at,ends_at,attendance_enabled').in('class_id', courses.map(course => course.id)).gte('meeting_date', week.start).lte('meeting_date', week.end).order('starts_at')
        if (meetings.error) throw meetings.error
        const names = new Map(courses.map(course => [course.id, course.name]))
        schedule = (meetings.data ?? []).map(meeting => ({ ...meeting, student_id: studentId, class_name: names.get(meeting.class_id) ?? 'Class' })) as WeeklyMeeting[]
      }
      return { records, schedule }
    }))
    if (!isCurrent()) return
    students.value = (profiles ?? []) as StudentRow[]
    attendance.value = results.flatMap(result => result.records).sort((a, b) => b.meeting_starts_at.localeCompare(a.meeting_starts_at))
    weeklyMeetings.value = results.flatMap(result => result.schedule)
    weekLabel.value = `${week.start} – ${week.end}`
    if (selectedEvidence.value) selectedEvidence.value = attendance.value.find(record => record.id === selectedEvidence.value?.id) ?? null
  } catch (error) {
    if (isCurrent()) message.value = toUserFacingErrorMessage(error, 'Unable to load parent attendance.')
  } finally {
    if (isCurrent()) refreshing.value = false
  }
}

function currentWeek() {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const start = new Date(`${today}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}
function weekday(value: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short' }).format(new Date(value)) }
function formatTime(value: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }

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
  photoCache.clear()
  students.value = []
  attendance.value = []
  weeklyMeetings.value = []
  selectedEvidence.value = null
  refreshing.value = false
})
watch(activeSection, () => { if (!loading.value && profile.value?.role === 'parent') void loadDashboard() })
onBeforeUnmount(() => { dashboardRequest++; photoCache.clear() })
</script>

<style scoped>
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
}

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
