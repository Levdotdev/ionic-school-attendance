<template>
  <ion-page class="dashboard-page">
    <ion-header class="app-header">
      <ion-toolbar class="app-toolbar">
        <ion-title>
          <span class="toolbar-brand">
            <span class="toolbar-mark" aria-hidden="true"><ion-icon :icon="schoolOutline" /></span>
            <span><strong>MinSU Attendance</strong><small>Family portal</small></span>
          </span>
        </ion-title>
        <ion-buttons slot="end">
          <ion-button
            class="sign-out-button"
            aria-label="Sign out of the family portal"
            :disabled="signingOut"
            @click="logout"
          >
            <ion-icon slot="start" :icon="logOutOutline" aria-hidden="true" />
            <span class="button-label">Sign out</span>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="dashboard-content">
      <div v-if="loading" class="loading-state" role="status" aria-label="Loading family attendance">
        <ion-spinner name="crescent" />
        <p>Loading your family dashboard…</p>
      </div>

      <main v-else class="dashboard-shell">
        <header class="page-heading">
          <div>
            <p class="eyebrow">Parent and guardian portal</p>
            <h1>Your child’s attendance</h1>
            <p>See recent check-ins, teacher verification, photos, and submitted locations.</p>
          </div>
          <ion-button class="secondary-button" fill="outline" :disabled="refreshing" @click="loadDashboard">
            <ion-spinner v-if="refreshing" name="crescent" />
            <ion-icon v-else slot="start" :icon="refreshOutline" aria-hidden="true" />
            <span>Refresh</span>
          </ion-button>
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

            <template v-if="dashboard.latest">
              <div class="latest-grid">
                <section
                  class="status-card"
                  :class="dashboard.latest.status === 'present' ? 'is-present' : 'is-absent'"
                  :aria-labelledby="`latest-status-heading-${dashboard.student.id}`"
                >
                  <div class="status-icon" aria-hidden="true">
                    <ion-icon :icon="dashboard.latest.status === 'present' ? checkmarkCircleOutline : closeCircleOutline" />
                  </div>
                  <p class="eyebrow">Latest attendance</p>
                  <h3 :id="`latest-status-heading-${dashboard.student.id}`">
                    {{ statusLabel(dashboard.latest.status) }}
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
                      <p class="eyebrow">Submitted evidence</p>
                      <h3 :id="`evidence-heading-${dashboard.student.id}`">Check-in details</h3>
                    </div>
                    <ion-icon :icon="shieldCheckmarkOutline" aria-hidden="true" />
                  </div>

                  <div class="evidence-body">
                    <figure class="photo-proof">
                      <img
                        v-if="dashboard.latest.selfie_url"
                        :src="dashboard.latest.selfie_url"
                        :alt="`${dashboard.student.full_name}'s latest attendance check-in`"
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
                        <span><small>Location</small><strong>Not required for this check-in</strong></span>
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <section class="history-card" :aria-labelledby="`history-${dashboard.student.id}`">
                <div class="section-title history-title">
                  <div>
                    <p class="eyebrow">Attendance history</p>
                    <h3 :id="`history-${dashboard.student.id}`">Recent records</h3>
                  </div>
                  <span class="record-count">{{ dashboard.records.length }} {{ dashboard.records.length === 1 ? 'record' : 'records' }}</span>
                </div>

                <div class="history-list">
                  <article v-for="record in dashboard.records" :key="record.id" class="history-row">
                    <img
                      v-if="record.selfie_url"
                      :src="record.selfie_url"
                      :alt="`${dashboard.student.full_name}'s attendance check-in`"
                      class="history-photo"
                      loading="lazy"
                    />
                    <span
                      v-else
                      class="history-photo is-placeholder"
                      :class="{ 'is-unavailable': record.selfie_path }"
                      role="img"
                      :aria-label="record.selfie_path ? 'Check-in photo could not be loaded' : 'No photo was required'"
                      :title="record.selfie_path ? 'Check-in photo could not be loaded' : 'No photo was required'"
                    >
                      <ion-icon :icon="record.selfie_path ? alertCircleOutline : imageOutline" aria-hidden="true" />
                    </span>

                    <div class="history-copy">
                      <strong>{{ record.class_name }}</strong>
                      <span>{{ record.meeting_title }}</span>
                      <small>{{ formatDateTime(record.meeting_starts_at) }}</small>
                      <small v-if="record.selfie_path && !record.selfie_url" class="photo-state">
                        Check-in photo unavailable
                      </small>
                    </div>

                    <div class="history-meta">
                      <span class="attendance-pill" :class="record.status === 'present' ? 'is-present' : 'is-absent'">
                        {{ statusLabel(record.status) }}
                      </span>
                      <small class="history-verification" :class="verificationClass(record.verification_status)">
                        {{ verificationLabel(record.verification_status) }}
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

            <section v-else class="student-empty">
              <div class="empty-icon" aria-hidden="true"><ion-icon :icon="calendarOutline" /></div>
              <div>
                <h3>No attendance records yet</h3>
                <p>This student’s completed attendance check-ins will appear here.</p>
              </div>
            </section>
          </article>
        </div>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
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
  refreshOutline,
  schoolOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from 'ionicons/icons'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'

interface StudentRow {
  id: string
  full_name: string
  email: string
}

interface AttendanceDisplayRow {
  id: string
  student_id: string
  status: 'present' | 'absent'
  verification_status: 'pending' | 'approved' | 'rejected' | null
  latitude: number | null
  longitude: number | null
  distance_m: number | null
  selfie_path: string | null
  selfie_url: string | null
  submitted_at: string
  meeting_title: string
  meeting_starts_at: string
  class_name: string
}

const router = useRouter()
const { initializeSession, profile, signOut } = useSession()
const loading = ref(true)
const refreshing = ref(false)
const signingOut = ref(false)
const students = ref<StudentRow[]>([])
const attendance = ref<AttendanceDisplayRow[]>([])
const message = ref('')

const studentDashboards = computed(() => students.value.map((student) => {
  const records = attendance.value.filter((record) => record.student_id === student.id)
  return { student, records, latest: records[0] ?? null }
}))

async function loadDashboard() {
  refreshing.value = true
  message.value = ''

  try {
    const { data: links, error: linksError } = await supabase
      .from('guardian_links')
      .select('student_id')
      .order('created_at')
    if (linksError) throw linksError

    const studentIds = (links ?? []).map((link) => link.student_id)
    if (!studentIds.length) {
      students.value = []
      attendance.value = []
      return
    }

    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id,full_name,email')
      .in('id', studentIds)
    if (profilesError) throw profilesError
    students.value = (profiles ?? []) as StudentRow[]

    const { data: records, error: recordsError } = await supabase
      .from('attendance_records')
      .select(
        'id,meeting_id,student_id,status,verification_status,latitude,longitude,distance_m,selfie_path,submitted_at',
      )
      .in('student_id', studentIds)
      .order('submitted_at', { ascending: false })
    if (recordsError) throw recordsError

    const selfieUrlByRecordId = new Map<string, string>()
    await Promise.all(
      (records ?? []).map(async (record) => {
        if (!record.selfie_path) return

        const { data: signed, error: signedError } = await supabase.storage
          .from('attendance-selfies')
          .createSignedUrl(record.selfie_path, 900)
        if (!signedError && signed?.signedUrl) selfieUrlByRecordId.set(record.id, signed.signedUrl)
      }),
    )

    const meetingIds = [...new Set((records ?? []).map((record) => record.meeting_id))]
    if (!meetingIds.length) {
      attendance.value = []
      return
    }

    const { data: meetings, error: meetingsError } = await supabase
      .from('meetings')
      .select('id,class_id,title,starts_at')
      .in('id', meetingIds)
    if (meetingsError) throw meetingsError

    const classIds = [...new Set((meetings ?? []).map((meeting) => meeting.class_id))]
    const { data: classes, error: classesError } = await supabase
      .from('classes')
      .select('id,name')
      .in('id', classIds)
    if (classesError) throw classesError

    const meetingById = new Map((meetings ?? []).map((meeting) => [meeting.id, meeting]))
    const classById = new Map((classes ?? []).map((schoolClass) => [schoolClass.id, schoolClass]))

    attendance.value = (records ?? []).flatMap((record) => {
      const meeting = meetingById.get(record.meeting_id)
      const schoolClass = meeting ? classById.get(meeting.class_id) : null
      if (!meeting || !schoolClass) return []
      return [{
        id: record.id,
        student_id: record.student_id,
        status: record.status,
        verification_status: record.verification_status,
        latitude: record.latitude,
        longitude: record.longitude,
        distance_m: record.distance_m,
        selfie_path: record.selfie_path,
        selfie_url: selfieUrlByRecordId.get(record.id) ?? null,
        submitted_at: record.submitted_at,
        meeting_title: meeting.title,
        meeting_starts_at: meeting.starts_at,
        class_name: schoolClass.name,
      } as AttendanceDisplayRow]
    })
  } catch (error) {
    students.value = []
    attendance.value = []
    message.value = error instanceof Error ? error.message : 'Unable to load parent attendance.'
  } finally {
    refreshing.value = false
  }
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('') || 'ST'
}

function statusLabel(status: AttendanceDisplayRow['status']) {
  return status === 'present' ? 'Present' : 'Absent'
}

function verificationLabel(status: AttendanceDisplayRow['verification_status']) {
  if (status === 'approved') return 'Verified by teacher'
  if (status === 'rejected') return 'Evidence rejected'
  if (status === 'pending') return 'Awaiting teacher verification'
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

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
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
    message.value = error instanceof Error ? error.message : 'Unable to load the parent account.'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.dashboard-page {
  --campus-accent-local: var(--campus-accent, #245f86);
  --campus-navy-local: var(--campus-navy, #15364e);
  --campus-bg-local: var(--campus-bg, #eef3f7);
  --campus-surface-local: var(--campus-surface, #ffffff);
  --campus-surface-soft-local: var(--campus-surface-soft, #f5f8fa);
  --campus-accent-soft-local: var(--campus-accent-soft, #e1edf5);
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
  width: min(100%, 1120px);
  margin: 0 auto;
  padding: 34px 20px 64px;
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
  box-shadow: var(--campus-shadow, 0 15px 45px rgba(21, 54, 78, 0.055));
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
