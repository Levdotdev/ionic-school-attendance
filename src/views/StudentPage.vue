<template>
  <ion-page class="student-page">
    <ion-header class="campus-header" :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-menu-button aria-label="Open navigation menu" />
        </ion-buttons>
        <ion-title>
          <span class="toolbar-brand">
            <span class="brand-mark" aria-hidden="true"><ion-icon :icon="schoolOutline" /></span>
            <span>
              <strong>MinSU Attendance</strong>
              <small>Student portal</small>
            </span>
          </span>
        </ion-title>
        <ion-buttons slot="end">
          <ion-button class="sign-out-button" :disabled="signingOut" aria-label="Sign out" @click="logout">
            <ion-spinner v-if="signingOut" name="crescent" />
            <template v-else>
              <ion-icon slot="start" :icon="logOutOutline" />
              <span class="sign-out-label">Sign out</span>
            </template>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="student-content" :fullscreen="true">
      <div
        v-if="loading"
        class="centered"
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Loading student portal"
      >
        <div class="loading-state">
          <ion-spinner name="crescent" />
          <span>Preparing your attendance portal...</span>
        </div>
      </div>

      <main v-else class="student-shell">
        <section v-if="!registrationCompleted" class="registration-layout">
          <div class="registration-intro">
            <p class="eyebrow">One-time setup</p>
            <h1>Complete your student profile</h1>
            <p>
              Link your physical school ID and a parent or guardian email before joining classes.
              Your barcode number is protected and never shown on screen.
            </p>

            <ol class="setup-steps" aria-label="Registration steps">
              <li class="is-active"><span>1</span><div><strong>Student details</strong><small>Confirm your name and guardian.</small></div></li>
              <li :class="{ 'is-active': barcodeCaptured }"><span>2</span><div><strong>School ID</strong><small>Scan the long barcode on your ID.</small></div></li>
              <li><span>3</span><div><strong>Ready</strong><small>Join your teacher's class.</small></div></li>
            </ol>
          </div>

          <section class="campus-surface registration-card" aria-labelledby="registration-title">
            <div class="surface-heading">
              <div>
                <p class="eyebrow">Student registration</p>
                <h2 id="registration-title">Your information</h2>
              </div>
              <span class="secure-chip"><ion-icon :icon="shieldCheckmarkOutline" /> Secure</span>
            </div>

            <form class="registration-form" @submit.prevent="completeRegistration">
              <ion-input
                v-model="fullName"
                class="campus-input"
                label="Student full name"
                label-placement="stacked"
                fill="outline"
                autocomplete="name"
                :disabled="savingRegistration"
                required
              />

              <ion-input
                v-model="guardianEmail"
                class="campus-input"
                type="email"
                label="Parent / guardian email"
                label-placement="stacked"
                fill="outline"
                autocomplete="email"
                :disabled="savingRegistration"
                required
              />

              <div class="scan-methods">
                <div class="field-heading">
                  <div>
                    <strong>Scan your physical school ID</strong>
                    <span>Use your device camera. Manual typing is disabled.</span>
                  </div>
                  <span class="capture-state" :class="{ 'is-complete': barcodeCaptured }">
                    <ion-icon :icon="barcodeCaptured ? checkmarkCircleOutline : barcodeOutline" />
                    {{ barcodeCaptured ? 'Captured' : 'Required' }}
                  </span>
                </div>

                <ion-button
                  class="camera-scan-button"
                  type="button"
                  fill="outline"
                  :disabled="savingRegistration || scanningCamera"
                  @click="scanWithCamera"
                >
                  <ion-spinner v-if="scanningCamera" name="crescent" />
                  <template v-else>
                    <ion-icon slot="start" :icon="scanOutline" />
                    Scan barcode with camera
                  </template>
                </ion-button>

              </div>

              <div v-if="registrationMessage" class="message-box is-error" role="alert">
                <ion-icon :icon="alertCircleOutline" />
                <span>{{ registrationMessage }}</span>
              </div>

              <ion-button
                class="primary-action"
                expand="block"
                size="large"
                type="submit"
                :disabled="savingRegistration || !barcodeCaptured"
              >
                <ion-spinner v-if="savingRegistration" name="crescent" />
                <template v-else>
                  Finish registration
                  <ion-icon slot="end" :icon="arrowForwardOutline" />
                </template>
              </ion-button>
            </form>
          </section>
        </section>

        <template v-else>
          <section class="welcome-banner">
            <div>
              <p class="eyebrow">{{ dashboardDate }}</p>
              <h1>Welcome back, {{ studentFirstName }}</h1>
              <p>Check your open attendance windows and submit before they close.</p>
            </div>
            <div class="availability-summary" :class="{ 'has-meetings': meetings.length > 0 }">
              <span class="summary-icon"><ion-icon :icon="meetings.length ? timeOutline : checkmarkCircleOutline" /></span>
              <span>
                <strong>{{ meetings.length }}</strong>
                <small>{{ meetings.length === 1 ? 'open self-check' : 'open self-checks' }}</small>
              </span>
            </div>
          </section>

          <div v-if="pageMessage" class="message-box is-error page-message" role="alert">
            <ion-icon :icon="alertCircleOutline" />
            <span>{{ pageMessage }}</span>
          </div>

          <div
            class="dashboard-grid"
            :class="{
              'courses-layout': activeSection === 'courses',
              'single-section': activeSection === 'schedule',
            }"
          >
            <section v-if="activeSection === 'overview'" class="campus-surface attendance-panel" aria-labelledby="self-checks-title">
              <div class="surface-heading attendance-heading">
                <div>
                  <p class="eyebrow">Attendance</p>
                  <h2 id="self-checks-title">Available self-checks</h2>
                  <p>Only meetings assigned to you with an open check-in window are shown.</p>
                </div>
                <ion-button
                  class="icon-action"
                  fill="clear"
                  :disabled="refreshing"
                  aria-label="Refresh available self-checks"
                  @click="loadAvailableMeetings"
                >
                  <ion-spinner v-if="refreshing" name="crescent" />
                  <ion-icon v-else :icon="refreshOutline" />
                </ion-button>
              </div>

              <div v-if="meetings.length" class="meeting-list">
                <article v-for="meeting in meetings" :key="meeting.id" class="meeting-card">
                  <div class="meeting-icon" :class="`mode-${meeting.attendance_mode}`" aria-hidden="true">
                    <ion-icon :icon="meetingModeMeta(meeting.attendance_mode).icon" />
                  </div>

                  <div class="meeting-copy">
                    <div class="meeting-title-row">
                      <div>
                        <span class="class-name">{{ meeting.class_name }}</span>
                        <h3>{{ meeting.title }}</h3>
                      </div>
                      <span v-if="meeting.existing_status" class="status-chip is-complete">
                        <ion-icon :icon="checkmarkCircleOutline" /> Submitted
                      </span>
                      <span v-else class="status-chip is-open"><span class="live-dot"></span> Open</span>
                    </div>

                    <div class="meeting-details">
                      <span><ion-icon :icon="calendarOutline" /> {{ formatMeetingTime(meeting) }}</span>
                      <span><ion-icon :icon="meetingModeMeta(meeting.attendance_mode).icon" /> {{ meetingModeMeta(meeting.attendance_mode).label }}</span>
                    </div>
                    <p>{{ meetingModeMeta(meeting.attendance_mode).detail }}</p>

                    <div class="meeting-actions">
                      <span v-if="meeting.existing_status" class="submitted-time">
                        Recorded as {{ meeting.existing_status }}
                        <template v-if="meeting.submitted_at"> on {{ formatDateTime(meeting.submitted_at) }}</template>
                      </span>
                      <ion-button
                        v-else
                        class="check-in-button"
                        @click="openSelfCheck(meeting.id)"
                      >
                        Start check-in
                        <ion-icon slot="end" :icon="arrowForwardOutline" />
                      </ion-button>
                    </div>
                  </div>
                </article>
              </div>

              <div v-else class="empty-state">
                <div class="empty-icon"><ion-icon :icon="checkmarkCircleOutline" /></div>
                <h3>You're all caught up</h3>
                <p>No self-check attendance is open right now. Check again when your teacher opens a meeting.</p>
                <ion-button fill="outline" size="small" :disabled="refreshing" @click="loadAvailableMeetings">
                  <ion-spinner v-if="refreshing" name="crescent" />
                  <template v-else><ion-icon slot="start" :icon="refreshOutline" /> Check again</template>
                </ion-button>
              </div>
            </section>

            <section v-if="activeSection === 'courses'" class="campus-surface attendance-panel" aria-labelledby="student-courses-title">
              <div class="surface-heading attendance-heading">
                <div>
                  <p class="eyebrow">Subjects</p>
                  <h2 id="student-courses-title">My courses</h2>
                  <p>Tasks can be connected directly to any course listed here.</p>
                </div>
                <span class="status-chip is-complete">{{ courses.length }} enrolled</span>
              </div>

              <div v-if="courses.length" class="course-list">
                <article v-for="course in courses" :key="course.id" class="course-card">
                  <div class="meeting-icon"><ion-icon :icon="schoolOutline" /></div>
                  <div>
                    <h3>{{ course.name }}</h3>
                    <p>{{ course.section || 'No section specified' }}</p>
                  </div>
                </article>
              </div>
              <div v-else class="empty-state compact-empty">
                <div class="empty-icon"><ion-icon :icon="schoolOutline" /></div>
                <h3>No courses yet</h3>
                <p>Use your teacher's join code to enroll.</p>
              </div>
            </section>

            <section v-if="activeSection === 'schedule'" class="campus-surface attendance-panel" aria-labelledby="student-schedule-title">
              <div class="surface-heading attendance-heading">
                <div>
                  <p class="eyebrow">Current week</p>
                  <h2 id="student-schedule-title">This week's schedule</h2>
                  <p>Only meetings from the current Monday-to-Sunday week are shown.</p>
                </div>
                <ion-button class="icon-action" fill="clear" :disabled="refreshingSchedule" aria-label="Refresh this week's schedule" @click="loadCoursesAndSchedule">
                  <ion-spinner v-if="refreshingSchedule" name="crescent" />
                  <ion-icon v-else :icon="refreshOutline" />
                </ion-button>
              </div>

              <div v-if="weeklyMeetings.length" class="meeting-list">
                <article v-for="meeting in weeklyMeetings" :key="meeting.id" class="meeting-card">
                  <div class="meeting-icon" aria-hidden="true"><ion-icon :icon="calendarOutline" /></div>
                  <div class="meeting-copy">
                    <div class="meeting-title-row">
                      <div>
                        <span class="class-name">{{ meeting.class_name }}</span>
                        <h3>{{ meeting.title }}</h3>
                      </div>
                      <span class="status-chip" :class="meeting.attendance_enabled ? 'is-open' : 'is-complete'">
                        {{ meeting.attendance_enabled ? 'Counts' : 'Not counted' }}
                      </span>
                    </div>
                    <div class="meeting-details">
                      <span><ion-icon :icon="calendarOutline" /> {{ formatMeetingTime(meeting) }}</span>
                      <span v-if="meeting.class_section"><ion-icon :icon="peopleOutline" /> {{ meeting.class_section }}</span>
                    </div>
                  </div>
                </article>
              </div>
              <div v-else class="empty-state">
                <div class="empty-icon"><ion-icon :icon="calendarOutline" /></div>
                <h3>No meetings this week</h3>
                <p>Your enrolled classes have no meeting scheduled for the current week.</p>
              </div>
            </section>

            <aside class="student-sidebar">
              <section v-if="activeSection === 'courses'" class="campus-surface join-panel" aria-labelledby="join-class-title">
                <div class="panel-icon"><ion-icon :icon="peopleOutline" /></div>
                <p class="eyebrow">Enrollment</p>
                <h2 id="join-class-title">Join a class</h2>
                <p>Enter the private join code shared by your teacher.</p>

                <ion-button class="join-button" expand="block" @click="openJoinModal">
                  Enter class code
                  <ion-icon slot="end" :icon="arrowForwardOutline" />
                </ion-button>

                <div
                  v-if="joinMessage"
                  class="message-box compact"
                  :class="joinFailed ? 'is-error' : 'is-success'"
                  role="status"
                >
                  <ion-icon :icon="joinFailed ? alertCircleOutline : checkmarkCircleOutline" />
                  <span>{{ joinMessage }}</span>
                </div>
              </section>

              <section v-if="activeSection === 'overview'" class="face-setup-card">
                <ion-icon :icon="personCircleOutline" />
                <div>
                  <strong>{{ faceEnrolled ? 'Face verification is active' : 'Face verification is not set up' }}</strong>
                  <p>{{ faceEnrolled ? 'Your private template is ready for self-check attendance.' : 'Enroll once before using student self-check attendance.' }}</p>
                  <div class="face-actions">
                    <ion-button size="small" fill="outline" @click="faceEnrollmentOpen = true">
                      {{ faceEnrolled ? 'Re-enroll' : 'Set up now' }}
                    </ion-button>
                    <ion-button v-if="faceEnrolled" size="small" fill="clear" color="danger" @click="confirmRemoveFace">
                      Remove
                    </ion-button>
                  </div>
                </div>
              </section>

              <section v-if="activeSection === 'overview'" class="privacy-card">
                <ion-icon :icon="shieldCheckmarkOutline" />
                <div>
                  <strong>Your evidence is private</strong>
                  <p>Only authorized teachers and your linked parent account can view attendance photos.</p>
                </div>
              </section>
            </aside>
          </div>
        </template>
      </main>
    </ion-content>

    <ion-modal :is-open="joinModalOpen" :can-dismiss="!joiningClass" @did-dismiss="closeJoinModal">
      <ion-header>
        <ion-toolbar>
          <ion-title>Join a class</ion-title>
          <ion-buttons slot="end">
            <ion-button :disabled="joiningClass" @click="closeJoinModal">Close</ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <div class="join-modal-copy">
          <div class="panel-icon"><ion-icon :icon="peopleOutline" /></div>
          <p class="eyebrow">Course enrollment</p>
          <h2>Enter your teacher's code</h2>
          <p>The code is 6 to 16 characters and is not case-sensitive.</p>
        </div>

        <form class="join-form" @submit.prevent="joinClass">
          <ion-input
            v-model="joinCode"
            class="join-code-input"
            label="Class join code"
            label-placement="stacked"
            fill="outline"
            :maxlength="16"
            :disabled="joiningClass"
            autocapitalize="characters"
            required
          />
          <ion-button class="join-button" expand="block" type="submit" :disabled="joiningClass || joinCode.trim().length < 6">
            <ion-spinner v-if="joiningClass" name="crescent" />
            <template v-else>
              Join class
              <ion-icon slot="end" :icon="arrowForwardOutline" />
            </template>
          </ion-button>
        </form>

        <div
          v-if="joinMessage"
          class="message-box compact"
          :class="joinFailed ? 'is-error' : 'is-success'"
          role="status"
        >
          <ion-icon :icon="joinFailed ? alertCircleOutline : checkmarkCircleOutline" />
          <span>{{ joinMessage }}</span>
        </div>
      </ion-content>
    </ion-modal>

    <face-enrollment-modal
      :open="faceEnrollmentOpen"
      @close="faceEnrollmentOpen = false"
      @enrolled="handleFaceEnrolled"
    />
  </ion-page>
</template>

<script setup lang="ts">
import {
  alertController,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonMenuButton,
  IonModal,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import {
  alertCircleOutline,
  arrowForwardOutline,
  barcodeOutline,
  calendarOutline,
  checkmarkCircleOutline,
  cloudOutline,
  logOutOutline,
  peopleOutline,
  personCircleOutline,
  refreshOutline,
  scanOutline,
  schoolOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from 'ionicons/icons'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import FaceEnrollmentModal from '@/components/FaceEnrollmentModal.vue'
import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import { scanStudentBarcode } from '@/services/barcode'
import { toUserFacingErrorMessage } from '@/utils/errors'

type SelfAttendanceMode = 'self_on_site' | 'self_online'

interface StudentProfileRow {
  user_id: string
  guardian_email: string | null
  registration_completed_at: string | null
}

interface AvailableMeeting {
  id: string
  class_id: string
  class_name: string
  title: string
  meeting_date: string
  starts_at: string
  ends_at: string
  attendance_mode: SelfAttendanceMode
  attendance_enabled: boolean
  attendance_opens_at: string
  attendance_closes_at: string
  existing_status: 'present' | 'absent' | null
  submitted_at: string | null
}

interface StudentCourse {
  id: string
  name: string
  section: string | null
  timezone: string
}

interface WeeklyMeeting {
  id: string
  title: string
  meeting_date: string
  starts_at: string
  ends_at: string
  attendance_enabled: boolean
  class_name: string
  class_section: string | null
}

const router = useRouter()
const route = useRoute()
const { initializeSession, profile, refreshProfile, signOut, user } = useSession()

const loading = ref(true)
const refreshing = ref(false)
const refreshingSchedule = ref(false)
const signingOut = ref(false)
const savingRegistration = ref(false)
const scanningCamera = ref(false)
const joiningClass = ref(false)
const studentProfile = ref<StudentProfileRow | null>(null)
const meetings = ref<AvailableMeeting[]>([])
const courses = ref<StudentCourse[]>([])
const weeklyMeetings = ref<WeeklyMeeting[]>([])
const fullName = ref('')
const guardianEmail = ref('')
const rawBarcode = ref<string | null>(null)
const joinCode = ref('')
const joinMessage = ref('')
const joinFailed = ref(false)
const registrationMessage = ref('')
const pageMessage = ref('')
const faceEnrolled = ref(false)
const faceEnrollmentOpen = ref(false)
const joinModalOpen = ref(false)

const registrationCompleted = computed(() => Boolean(studentProfile.value?.registration_completed_at))
const barcodeCaptured = computed(() => Boolean(rawBarcode.value))
const studentFirstName = computed(() => profile.value?.full_name?.trim().split(/\s+/)[0] || 'student')
const dashboardDate = computed(() =>
  new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()),
)
const activeSection = computed(() => {
  const value = typeof route.query.section === 'string' ? route.query.section : 'overview'
  return value === 'courses' || value === 'schedule' ? value : 'overview'
})

function acceptBarcode(value: string) {
  rawBarcode.value = value
  registrationMessage.value = ''
}

function showRegistrationError(message: string) {
  rawBarcode.value = null
  registrationMessage.value = message
}

async function scanWithCamera() {
  scanningCamera.value = true
  registrationMessage.value = ''

  try {
    acceptBarcode(await scanStudentBarcode())
  } catch (error) {
    showRegistrationError(toUserFacingErrorMessage(error, 'The barcode scan failed.'))
  } finally {
    scanningCamera.value = false
  }
}

async function loadStudentProfile() {
  if (!user.value) return

  const { data, error } = await supabase
    .from('student_profiles')
    .select('user_id, guardian_email, registration_completed_at')
    .eq('user_id', user.value.id)
    .maybeSingle()

  if (error) throw error
  studentProfile.value = data
  guardianEmail.value = data?.guardian_email ?? ''
}

async function loadFaceEnrollmentStatus() {
  const { data, error } = await supabase.rpc('my_face_enrollment_status')
  if (error) {
    // The UI remains usable while a migration is being deployed, but self-check
    // will still be protected by the server once face verification is enabled.
    if (error.code === '42883' || error.code === 'PGRST202') return
    throw error
  }

  const status = Array.isArray(data) ? data[0] : data
  faceEnrolled.value = Boolean(status?.enrolled)
}

async function loadAvailableMeetings() {
  refreshing.value = true
  pageMessage.value = ''

  try {
    const { data, error } = await supabase
      .from('student_available_meetings')
      .select(
        'id, class_id, class_name, title, meeting_date, starts_at, ends_at, attendance_mode, attendance_enabled, attendance_opens_at, attendance_closes_at, existing_status, submitted_at',
      )
      .order('attendance_opens_at', { ascending: true })

    if (error) throw error
    meetings.value = (data ?? []) as AvailableMeeting[]
  } catch (error) {
    pageMessage.value = toUserFacingErrorMessage(error, 'Unable to load attendance meetings.')
  } finally {
    refreshing.value = false
  }
}

function currentManilaWeekRange(): { start: string; end: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const numberPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value)
  const today = new Date(Date.UTC(numberPart('year'), numberPart('month') - 1, numberPart('day')))
  const mondayOffset = (today.getUTCDay() + 6) % 7
  const start = new Date(today)
  start.setUTCDate(today.getUTCDate() - mondayOffset)
  const end = new Date(start)
  end.setUTCDate(start.getUTCDate() + 6)
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  }
}

async function loadCoursesAndSchedule() {
  if (!user.value) return
  refreshingSchedule.value = true

  try {
    const week = currentManilaWeekRange()
    const [enrollmentResult, meetingResult] = await Promise.all([
      supabase
        .from('class_enrollments')
        .select('class:classes(id,name,section,timezone)')
        .eq('student_id', user.value.id)
        .eq('is_active', true),
      supabase
        .from('meetings')
        .select('id,title,meeting_date,starts_at,ends_at,attendance_enabled,class:classes!inner(name,section)')
        .gte('meeting_date', week.start)
        .lte('meeting_date', week.end)
        .order('starts_at', { ascending: true }),
    ])
    if (enrollmentResult.error) throw enrollmentResult.error
    if (meetingResult.error) throw meetingResult.error

    const enrollmentRows = (enrollmentResult.data ?? []) as unknown as Array<{
      class: StudentCourse | StudentCourse[] | null
    }>
    courses.value = enrollmentRows
      .flatMap((row) => Array.isArray(row.class) ? row.class : row.class ? [row.class] : [])
      .sort((first, second) => first.name.localeCompare(second.name))

    const meetingRows = (meetingResult.data ?? []) as unknown as Array<{
      id: string
      title: string
      meeting_date: string
      starts_at: string
      ends_at: string
      attendance_enabled: boolean
      class: Pick<StudentCourse, 'name' | 'section'> | Array<Pick<StudentCourse, 'name' | 'section'>>
    }>
    weeklyMeetings.value = meetingRows.flatMap((row) => {
      const course = Array.isArray(row.class) ? row.class[0] : row.class
      if (!course) return []
      return [{
        id: row.id,
        title: row.title,
        meeting_date: row.meeting_date,
        starts_at: row.starts_at,
        ends_at: row.ends_at,
        attendance_enabled: row.attendance_enabled,
        class_name: course.name,
        class_section: course.section,
      }]
    })
  } catch (error) {
    pageMessage.value = toUserFacingErrorMessage(error, 'Unable to load this week\'s classes.')
  } finally {
    refreshingSchedule.value = false
  }
}

async function completeRegistration() {
  registrationMessage.value = ''
  const name = fullName.value.trim()
  const email = guardianEmail.value.trim().toLowerCase()

  if (name.length < 2) {
    registrationMessage.value = 'Enter the student full name.'
    return
  }
  if (!email || !email.includes('@')) {
    registrationMessage.value = 'Enter a valid parent or guardian email.'
    return
  }
  if (!rawBarcode.value) {
    registrationMessage.value = 'Scan the physical student ID before continuing.'
    return
  }

  savingRegistration.value = true

  try {
    const { error } = await supabase.rpc('complete_student_registration', {
      p_full_name: name,
      p_raw_barcode: rawBarcode.value,
      p_guardian_email: email,
    })
    if (error) throw error

    // Erase the raw credential from client memory as soon as the secure RPC has used it.
    rawBarcode.value = null
    await Promise.all([loadStudentProfile(), refreshProfile()])
    await Promise.all([loadAvailableMeetings(), loadCoursesAndSchedule()])
    faceEnrollmentOpen.value = true
  } catch (error) {
    registrationMessage.value = toUserFacingErrorMessage(error, 'Registration could not be completed.')
  } finally {
    savingRegistration.value = false
  }
}

async function joinClass() {
  const code = joinCode.value.trim().toUpperCase()
  joinMessage.value = ''
  joinFailed.value = false

  if (code.length < 6) {
    joinFailed.value = true
    joinMessage.value = 'Enter the complete class code from your teacher.'
    return
  }

  joiningClass.value = true
  try {
    const { data, error } = await supabase.rpc('join_class', { p_join_code: code })
    if (error) throw error
    const schoolClass = data as { name?: string } | null
    joinCode.value = ''
    joinMessage.value = schoolClass?.name ? `Joined ${schoolClass.name}.` : 'Class joined.'
    await Promise.all([loadAvailableMeetings(), loadCoursesAndSchedule()])
  } catch (error) {
    joinFailed.value = true
    joinMessage.value = toUserFacingErrorMessage(error, 'The class could not be joined.')
  } finally {
    joiningClass.value = false
  }
}

function openJoinModal() {
  joinMessage.value = ''
  joinFailed.value = false
  joinModalOpen.value = true
}

function closeJoinModal() {
  if (joiningClass.value) return
  joinModalOpen.value = false
  joinCode.value = ''
  joinMessage.value = ''
  joinFailed.value = false
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatMeetingTime(meeting: Pick<AvailableMeeting, 'starts_at' | 'ends_at'>): string {
  const dateAndTime = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(meeting.starts_at))
  const endTime = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(meeting.ends_at))
  return `${dateAndTime} - ${endTime}`
}

function meetingModeMeta(mode: SelfAttendanceMode) {
  if (mode === 'self_online') {
    return {
      label: 'Online class',
      detail: 'Take a new timestamped selfie. Your check-in counts immediately.',
      icon: cloudOutline,
    }
  }
  return {
    label: 'On-site class',
    detail: 'Your school ID, a timestamped selfie, and verified location are required.',
    icon: schoolOutline,
  }
}

async function openSelfCheck(meetingId: string) {
  if (!faceEnrolled.value) {
    faceEnrollmentOpen.value = true
    pageMessage.value = 'Set up face verification before starting a self-check.'
    return
  }
  await router.push(`/student/check-in/${meetingId}`)
}

async function handleFaceEnrolled() {
  faceEnrolled.value = true
  faceEnrollmentOpen.value = false
  pageMessage.value = ''
}

async function confirmRemoveFace() {
  const alert = await alertController.create({
    header: 'Remove face verification?',
    message: 'You will not be able to use self-check attendance until you enroll again. Your past attendance photos are not deleted.',
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      {
        text: 'Remove',
        role: 'destructive',
        handler: () => { void removeFaceEnrollment() },
      },
    ],
  })
  await alert.present()
}

async function removeFaceEnrollment() {
  pageMessage.value = ''
  const { error } = await supabase.rpc('delete_my_face')
  if (error) {
    pageMessage.value = toUserFacingErrorMessage(error, 'Face enrollment could not be removed.')
    return
  }
  faceEnrolled.value = false
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
    if (!user.value || profile.value?.role !== 'student') return

    fullName.value = profile.value.full_name
    await loadStudentProfile()
    if (registrationCompleted.value) {
      await Promise.all([
        loadAvailableMeetings(),
        loadCoursesAndSchedule(),
        loadFaceEnrollmentStatus(),
      ])
      faceEnrollmentOpen.value = !faceEnrolled.value
    }
  } catch (error) {
    pageMessage.value = toUserFacingErrorMessage(error, 'Unable to load the student account.')
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.student-page {
  --campus-accent: var(--campus-green, #087443);
  --campus-accent-soft: var(--campus-green-soft, #e4f2e9);
  --campus-surface-subtle: var(--campus-surface-soft, #f5f8fa);
  --campus-green: var(--campus-success, #147a50);
  --campus-green-soft: var(--campus-success-soft, #e1f4eb);
  --campus-red: var(--campus-danger, #b73542);
  --campus-red-soft: var(--campus-danger-soft, #fae9ea);
  --campus-radius-lg: var(--campus-radius, 20px);
  --campus-radius-md: var(--campus-radius-sm, 14px);
}

.campus-header ion-toolbar {
  --background: var(--campus-surface);
  --border-color: var(--campus-border);
  --min-height: 68px;
  --padding-start: clamp(0.4rem, 3vw, 1.25rem);
  --padding-end: clamp(0.35rem, 3vw, 1.1rem);
}

.toolbar-brand {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  text-align: left;
}

.brand-mark {
  display: grid;
  width: 2.45rem;
  height: 2.45rem;
  place-items: center;
  border-radius: 0.78rem;
  background: var(--campus-accent);
  color: #fff;
  font-size: 1.15rem;
}

.toolbar-brand strong,
.toolbar-brand small {
  display: block;
}

.toolbar-brand strong {
  color: var(--campus-text);
  font-size: 0.98rem;
  font-weight: 700;
}

.toolbar-brand small {
  margin-top: 0.1rem;
  color: var(--campus-muted);
  font-size: 0.7rem;
  font-weight: 500;
}

.sign-out-button {
  --border-radius: 10px;
  --color: var(--campus-muted);
  font-size: 0.82rem;
}

.student-content {
  --background: var(--campus-bg);
}

.student-shell {
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
  padding: clamp(1.25rem, 4vw, 2.5rem) 0 4rem;
}

.centered {
  display: grid;
  min-height: 70vh;
  place-items: center;
}

.loading-state {
  display: grid;
  justify-items: center;
  gap: 0.8rem;
  color: var(--campus-muted);
  font-size: 0.9rem;
}

.loading-state ion-spinner {
  width: 2rem;
  height: 2rem;
  color: var(--campus-accent);
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--campus-muted);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}

.campus-surface {
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius-lg);
  background: var(--campus-surface);
  box-shadow: var(--campus-shadow);
}

.registration-layout {
  display: grid;
  grid-template-columns: minmax(250px, 0.75fr) minmax(420px, 1.25fr);
  gap: clamp(1.5rem, 5vw, 4.25rem);
  align-items: start;
  padding-top: clamp(0.5rem, 5vw, 3rem);
}

.registration-intro {
  position: sticky;
  top: 2rem;
  padding: 1.25rem 0;
}

.registration-intro h1,
.welcome-banner h1 {
  margin: 0;
  color: var(--campus-text);
  font-size: clamp(1.8rem, 4vw, 2.55rem);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.1;
}

.registration-intro > p:not(.eyebrow),
.welcome-banner p:not(.eyebrow) {
  max-width: 38rem;
  margin: 0.9rem 0 0;
  color: var(--campus-muted);
  font-size: 0.98rem;
  line-height: 1.65;
}

.setup-steps {
  display: grid;
  gap: 0.15rem;
  margin: 2rem 0 0;
  padding: 0;
  list-style: none;
}

.setup-steps li {
  position: relative;
  display: grid;
  grid-template-columns: 2.2rem 1fr;
  gap: 0.75rem;
  align-items: center;
  min-height: 4rem;
  color: var(--campus-muted);
}

.setup-steps li:not(:last-child)::after {
  position: absolute;
  top: 2.75rem;
  bottom: -0.75rem;
  left: 1.05rem;
  width: 2px;
  background: var(--campus-border);
  content: '';
}

.setup-steps li > span {
  z-index: 1;
  display: grid;
  width: 2.15rem;
  height: 2.15rem;
  place-items: center;
  border-radius: 50%;
  background: #e5ebef;
  font-size: 0.78rem;
  font-weight: 750;
}

.setup-steps li.is-active > span {
  background: var(--campus-accent);
  color: #fff;
}

.setup-steps li div,
.setup-steps strong,
.setup-steps small {
  display: block;
}

.setup-steps strong {
  color: var(--campus-text);
  font-size: 0.9rem;
}

.setup-steps small {
  margin-top: 0.18rem;
  font-size: 0.76rem;
}

.registration-card,
.attendance-panel,
.join-panel {
  padding: clamp(1.1rem, 3vw, 1.65rem);
}

.surface-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.surface-heading h2,
.join-panel h2 {
  margin: 0;
  color: var(--campus-text);
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.surface-heading > div > p:not(.eyebrow) {
  max-width: 39rem;
  margin: 0.4rem 0 0;
  color: var(--campus-muted);
  font-size: 0.85rem;
  line-height: 1.45;
}

.secure-chip,
.capture-state,
.status-chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.35rem;
  padding: 0.42rem 0.62rem;
  border-radius: 999px;
  background: var(--campus-green-soft);
  color: var(--campus-green);
  font-size: 0.72rem;
  font-weight: 700;
}

.registration-form {
  display: grid;
  gap: 1rem;
  margin-top: 1.35rem;
}

.campus-input,
.join-code-input {
  --border-color: var(--campus-border);
  --border-color-focused: var(--campus-accent);
  --border-radius: 12px;
  --highlight-color-focused: var(--campus-accent);
}

.scan-methods {
  display: grid;
  gap: 0.85rem;
  margin-top: 0.25rem;
  padding-top: 1.15rem;
  border-top: 1px solid var(--campus-border);
}

.field-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.field-heading strong,
.field-heading span {
  display: block;
}

.field-heading strong {
  color: var(--campus-text);
  font-size: 0.9rem;
}

.field-heading div > span {
  margin-top: 0.2rem;
  color: var(--campus-muted);
  font-size: 0.77rem;
}

.capture-state {
  background: #edf1f4;
  color: var(--campus-muted);
}

.capture-state.is-complete {
  background: var(--campus-green-soft);
  color: var(--campus-green);
}

.camera-scan-button {
  min-height: 46px;
  margin: 0;
  --border-color: var(--campus-border);
  --border-radius: 11px;
  --color: var(--campus-accent);
}

.primary-action,
.check-in-button,
.join-button {
  min-height: 46px;
  margin: 0;
  --background: var(--campus-accent);
  --background-hover: var(--campus-navy);
  --border-radius: 11px;
  --box-shadow: none;
  font-weight: 700;
}

.welcome-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: clamp(0.5rem, 2vw, 1rem) 0 clamp(1.5rem, 3vw, 2.2rem);
}

.availability-summary {
  display: flex;
  min-width: 176px;
  align-items: center;
  gap: 0.8rem;
  padding: 0.85rem 1rem;
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius-md);
  background: var(--campus-surface);
}

.availability-summary.has-meetings {
  border-color: var(--campus-warning);
  background: var(--campus-warning-soft);
}

.summary-icon {
  display: grid;
  width: 2.5rem;
  height: 2.5rem;
  place-items: center;
  border-radius: 0.75rem;
  background: var(--campus-green-soft);
  color: var(--campus-green);
  font-size: 1.15rem;
}

.has-meetings .summary-icon {
  border: 1px solid var(--campus-warning);
  background: var(--campus-surface);
  color: var(--campus-warning);
}

.availability-summary strong,
.availability-summary small {
  display: block;
}

.availability-summary strong {
  color: var(--campus-text);
  font-size: 1.35rem;
}

.availability-summary small {
  color: var(--campus-muted);
  font-size: 0.7rem;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.65fr) minmax(270px, 0.75fr);
  gap: 1.25rem;
  align-items: start;
}

.dashboard-grid.courses-layout {
  grid-template-columns: minmax(0, 1.45fr) minmax(270px, 0.65fr);
}

.dashboard-grid.single-section {
  grid-template-columns: minmax(0, 1fr);
}

.attendance-heading {
  padding-bottom: 1.15rem;
  border-bottom: 1px solid var(--campus-border);
}

.icon-action {
  width: 2.65rem;
  height: 2.65rem;
  margin: 0;
  border-radius: 0.75rem;
  background: var(--campus-surface-subtle);
  color: var(--campus-accent);
  font-size: 1.15rem;
}

.meeting-list {
  display: grid;
}

.course-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 12px;
  padding-top: 18px;
}

.course-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius-md);
  background: var(--campus-surface-subtle);
}

.course-card h3,
.course-card p {
  margin: 0;
}

.course-card h3 {
  color: var(--campus-text);
  font-size: 0.9rem;
}

.course-card p {
  margin-top: 4px;
  color: var(--campus-muted);
  font-size: 0.75rem;
}

.compact-empty {
  padding-top: 2.4rem;
  padding-bottom: 1.2rem;
}

.meeting-card {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 0.95rem;
  padding: 1.2rem 0;
  border-bottom: 1px solid var(--campus-border);
}

.meeting-card:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.meeting-icon,
.panel-icon,
.empty-icon {
  display: grid;
  width: 3rem;
  height: 3rem;
  place-items: center;
  border-radius: 0.9rem;
  background: var(--campus-accent-soft);
  color: var(--campus-accent);
  font-size: 1.3rem;
}

.meeting-icon.mode-self_online {
  background: #ede9fb;
  color: #7255b4;
}

.meeting-copy {
  min-width: 0;
}

.meeting-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.75rem;
}

.class-name {
  color: var(--campus-accent);
  font-size: 0.72rem;
  font-weight: 750;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.meeting-title-row h3 {
  margin: 0.2rem 0 0;
  color: var(--campus-text);
  font-size: 1.03rem;
  font-weight: 700;
}

.status-chip.is-open {
  background: var(--campus-green-soft);
  color: var(--campus-green);
}

.status-chip.is-complete {
  background: #edf1f4;
  color: var(--campus-muted);
}

.live-dot {
  width: 0.42rem;
  height: 0.42rem;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px rgba(20, 122, 80, 0.12);
}

.meeting-details {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem 1rem;
  margin-top: 0.75rem;
}

.meeting-details span {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: var(--campus-muted);
  font-size: 0.77rem;
}

.meeting-details ion-icon {
  color: var(--campus-accent);
}

.meeting-copy > p {
  margin: 0.55rem 0 0;
  color: var(--campus-muted);
  font-size: 0.82rem;
  line-height: 1.45;
}

.meeting-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: 0.9rem;
}

.check-in-button {
  min-height: 40px;
  font-size: 0.78rem;
}

.submitted-time {
  color: var(--campus-green);
  font-size: 0.76rem;
  font-weight: 650;
}

.empty-state {
  display: grid;
  max-width: 420px;
  justify-items: center;
  gap: 0.45rem;
  margin: 0 auto;
  padding: clamp(2.5rem, 8vw, 5rem) 1rem;
  text-align: center;
}

.empty-icon {
  width: 4rem;
  height: 4rem;
  margin-bottom: 0.55rem;
  border-radius: 1.25rem;
  background: var(--campus-green-soft);
  color: var(--campus-green);
  font-size: 1.8rem;
}

.empty-state h3 {
  margin: 0;
  color: var(--campus-text);
  font-size: 1.1rem;
}

.empty-state p {
  margin: 0 0 0.65rem;
  color: var(--campus-muted);
  font-size: 0.84rem;
  line-height: 1.55;
}

.student-sidebar {
  display: grid;
  gap: 1rem;
}

.join-panel .panel-icon {
  margin-bottom: 1rem;
}

.join-panel > p:not(.eyebrow) {
  margin: 0.45rem 0 0;
  color: var(--campus-muted);
  font-size: 0.84rem;
  line-height: 1.5;
}

.join-form {
  display: grid;
  gap: 0.75rem;
  margin-top: 1.2rem;
}

.join-code-input {
  text-transform: uppercase;
}

.privacy-card,
.face-setup-card {
  display: flex;
  gap: 0.8rem;
  padding: 1rem;
  border-radius: var(--campus-radius-md);
  background: var(--campus-green-soft);
  color: var(--campus-accent);
}

.face-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.face-setup-card {
  border: 1px solid color-mix(in srgb, var(--campus-gold) 55%, var(--campus-border));
  background: var(--campus-gold-soft);
}

.privacy-card > ion-icon,
.face-setup-card > ion-icon {
  flex: 0 0 auto;
  margin-top: 0.08rem;
  font-size: 1.25rem;
}

.privacy-card strong,
.face-setup-card strong {
  color: var(--campus-text);
  font-size: 0.82rem;
}

.privacy-card p,
.face-setup-card p {
  margin: 0.3rem 0 0;
  color: var(--campus-muted);
  font-size: 0.75rem;
  line-height: 1.45;
}

.message-box {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  padding: 0.75rem 0.85rem;
  border-radius: 11px;
  font-size: 0.82rem;
  line-height: 1.4;
}

.message-box ion-icon {
  flex: 0 0 auto;
  margin-top: 0.08rem;
  font-size: 1rem;
}

.message-box.is-error {
  background: var(--campus-red-soft);
  color: var(--campus-red);
}

.message-box.is-success {
  background: var(--campus-green-soft);
  color: var(--campus-green);
}

.message-box.compact {
  margin-top: 0.75rem;
  padding: 0.65rem 0.7rem;
  font-size: 0.76rem;
}

.page-message {
  margin-bottom: 1rem;
}

@media (max-width: 820px) {
  .registration-layout,
  .dashboard-grid {
    grid-template-columns: 1fr;
  }

  .registration-intro {
    position: static;
    padding-bottom: 0;
  }

  .setup-steps {
    grid-template-columns: repeat(3, 1fr);
  }

  .setup-steps li {
    grid-template-columns: 1fr;
    justify-items: center;
    align-content: start;
    text-align: center;
  }

  .setup-steps li:not(:last-child)::after {
    top: 1.05rem;
    right: -50%;
    bottom: auto;
    left: 50%;
    width: 100%;
    height: 2px;
  }

  .student-sidebar {
    grid-template-columns: minmax(0, 1fr) minmax(230px, 0.8fr);
  }
}

@media (max-width: 600px) {
  .student-shell {
    width: min(100% - 1rem, 1120px);
    padding-top: 1rem;
  }

  .sign-out-label,
  .toolbar-brand small {
    display: none;
  }

  .brand-mark {
    width: 2.15rem;
    height: 2.15rem;
  }

  .welcome-banner {
    display: grid;
  }

  .availability-summary {
    width: 100%;
  }

  .student-sidebar {
    grid-template-columns: 1fr;
  }

  .meeting-card {
    grid-template-columns: 1fr;
  }

  .meeting-icon {
    width: 2.6rem;
    height: 2.6rem;
  }

  .meeting-title-row {
    gap: 0.5rem;
  }

  .meeting-actions,
  .check-in-button {
    width: 100%;
  }

  .field-heading {
    display: grid;
  }

  .capture-state {
    width: fit-content;
  }
}

@media (max-width: 390px) {
  .toolbar-brand strong {
    font-size: 0.86rem;
  }

  .meeting-title-row {
    display: grid;
  }

  .status-chip {
    width: fit-content;
  }
}
</style>
