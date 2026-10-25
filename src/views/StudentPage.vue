<template>
  <ion-page class="student-page">
    <portal-header portal="Student portal" :busy="signingOut" @logout="logout" />

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
              Register your physical school ID, then ask your registered parent or guardian to approve your link before joining classes.
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
                v-model="firstName"
                class="campus-input"
                label="First name"
                label-placement="stacked"
                fill="outline"
                autocomplete="given-name"
                :disabled="savingRegistration"
                required
              />
              <ion-input v-model="lastName" class="campus-input" label="Last name" label-placement="stacked" fill="outline" autocomplete="family-name" :disabled="savingRegistration" required />
              <p class="guardian-help">Names are saved in uppercase and class lists are sorted by last name.</p>

              <ion-input
                v-model="guardianEmail"
                class="campus-input"
                type="email"
                label="Registered parent email (optional for now)"
                label-placement="stacked"
                fill="outline"
                autocomplete="email"
                :disabled="savingRegistration"
              />
              <p class="guardian-help">Only registered parent accounts can be linked. Your parent must approve before you can join a class. If they have no account yet, invite them first.</p>
              <ion-button type="button" fill="outline" :disabled="savingRegistration" @click="parentInviteOpen = true">Invite a parent</ion-button>

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
              <h1>{{ sectionTitle }}</h1>
              <p>{{ sectionDescription }}</p>
            </div>
            <div v-if="activeSection === 'overview'" class="availability-summary" :class="{ 'has-meetings': meetings.length > 0 }">
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
              'single-section': activeSection !== 'overview',
            }"
          >
            <section v-if="activeSection === 'overview'" class="campus-surface attendance-panel" aria-labelledby="self-checks-title">
              <div class="surface-heading attendance-heading">
                <div>
                  <p class="eyebrow">Attendance</p>
                  <h2 id="self-checks-title">Available self-checks</h2>
                  <p>Your next unsubmitted check-in appears here when class starts. After you submit, the next available check-in is shown automatically.</p>
                </div>
                <span class="live-update-label"><span class="live-dot"></span> Live</span>
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
                        <h3>Class attendance</h3>
                      </div>
                      <span class="status-chip is-open"><span class="live-dot"></span> Open</span>
                    </div>

                    <div class="meeting-details">
                      <span><ion-icon :icon="calendarOutline" /> {{ formatMeetingTime(meeting) }}</span>
                      <span><ion-icon :icon="meetingModeMeta(meeting.attendance_mode).icon" /> {{ meetingModeMeta(meeting.attendance_mode).label }}</span>
                    </div>
                    <p>{{ meetingModeMeta(meeting.attendance_mode).detail }}</p>

                    <div class="meeting-actions">
                      <ion-button
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
                <p>No unsubmitted self-checks are open right now. New meetings appear here automatically.</p>
                <ion-button fill="outline" size="small" @click="showHistory">View attendance history</ion-button>
              </div>
            </section>

            <section v-if="activeSection === 'courses'" class="campus-surface attendance-panel" aria-labelledby="student-courses-title">
              <div class="surface-heading attendance-heading">
                <div>
                  <p class="eyebrow">Subjects</p>
                  <h2 id="student-courses-title">My courses</h2>
                  <p>Tasks can be connected directly to any course listed here.</p>
                </div>
                <div class="course-heading-actions"><span class="status-chip is-complete">{{ courses.length }} enrolled</span><ion-button size="small" @click="openJoinModal"><ion-icon slot="start" :icon="peopleOutline" />Join a class</ion-button></div>
              </div>

              <div v-if="courses.length" class="course-list">
                <article v-for="course in courses" :key="course.id" class="course-card">
                  <div class="course-card-heading"><div class="meeting-icon"><ion-icon :icon="schoolOutline" /></div><span class="status-chip is-complete">Enrolled</span></div>
                  <div class="course-card-copy">
                    <h3>{{ course.name }}</h3>
                    <p>Your subject, attendance, and connected tasks in one place.</p>
                  </div>
                  <div class="course-card-actions"><ion-button size="small" @click="openCourseTasks(course.id)">View tasks<ion-icon slot="end" :icon="arrowForwardOutline" /></ion-button><ion-button fill="clear" size="small" @click="showSchedule">Schedule & reminders</ion-button></div>
                </article>
              </div>
              <div v-else class="empty-state compact-empty">
                <div class="empty-icon"><ion-icon :icon="schoolOutline" /></div>
                <h3>No courses yet</h3>
                <p>{{ hasApprovedParent ? "Use your teacher's join code to enroll." : 'A registered parent must approve your link before you can join a class.' }}</p>
                <ion-button @click="openJoinModal">{{ hasApprovedParent ? 'Join your first class' : 'Link your parent first' }}</ion-button>
              </div>
            </section>

            <student-schedule-panel v-if="activeSection === 'schedule' && user" :student-id="user.id" :courses="courses" />
            <student-history-panel v-if="activeSection === 'history' && user" :student-id="user.id" :student-name="profile?.full_name || 'Student'" />
            <aside v-if="activeSection === 'overview'" class="student-sidebar">
              <section class="campus-surface join-panel guardian-overview">
                <p class="eyebrow">Parent / guardian</p>
                <h2>{{ hasApprovedParent ? 'Parent link approved' : 'Parent approval needed' }}</h2>
                <p>{{ hasApprovedParent ? 'Your approved parent can follow your attendance and class calendar.' : guardianLinks.some(link => link.status === 'pending') ? 'Your request is waiting for your parent to approve it from their account.' : 'Link a registered parent before joining classes. Invite them if they do not have an account yet.' }}</p>
                <ion-button fill="outline" expand="block" @click="openGuardianModal">{{ hasApprovedParent ? 'Manage parent link' : 'Link a parent' }}</ion-button>
              </section>
              <section v-if="activeSection === 'overview'" class="face-setup-card">
                <ion-icon :icon="personCircleOutline" />
                <div>
                  <strong>{{ faceEnrolled ? 'Face verification is active' : 'Face verification is not set up' }}</strong>
                  <p>{{ faceRetakeAllowed ? 'An administrator has approved one face enrollment retake.' : faceEnrolled ? 'Your one-time enrollment is locked. Contact an administrator if you need to retake it.' : 'Enroll once before using student self-check attendance.' }}</p>
                  <div class="face-actions">
                    <ion-button v-if="!faceEnrolled || faceRetakeAllowed" size="small" fill="outline" @click="faceEnrollmentOpen = true">
                      {{ faceRetakeAllowed ? 'Retake face enrollment' : 'Set up now' }}
                    </ion-button>
                  </div>
                </div>
              </section>

              <section v-if="activeSection === 'overview'" class="privacy-card">
                <ion-icon :icon="shieldCheckmarkOutline" />
                <div>
                  <strong>Your evidence is private</strong>
                  <p>Authorized teachers and linked parents can view attendance photos. Only verified linked parents can see your online check-in location.</p>
                </div>
              </section>
            </aside>
          </div>
        </template>
      </main>
    </ion-content>

    <app-modal :open="joinModalOpen" title="Join a class" :busy="joiningClass" @close="closeJoinModal">
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
    </app-modal>

    <app-modal :open="guardianModalOpen" title="Parent / guardian" :busy="parentLinkBusy" @close="guardianModalOpen = false">
      <p class="guardian-help">Request a link using a registered parent’s email. The parent must sign in and approve it; an invitation alone does not grant access.</p>
      <div v-if="guardianLinks.length" class="guardian-links">
        <article v-for="link in guardianLinks" :key="link.request_id">
          <div><strong>{{ link.parent_name }}</strong><small>{{ link.parent_email }}</small></div>
          <span :class="`guardian-status is-${link.status}`">{{ link.status === 'approved' ? 'Approved by parent' : link.status === 'rejected' ? 'Declined by parent' : 'Waiting for parent' }}</span>
        </article>
      </div>
      <form class="join-form" @submit.prevent="requestParentLink">
        <ion-input v-model="parentLinkEmail" type="email" label="Parent’s registered email" label-placement="stacked" fill="outline" autocomplete="email" :disabled="parentLinkBusy" required />
        <ion-button type="submit" :disabled="parentLinkBusy || !parentLinkEmail.trim()">{{ parentLinkBusy ? 'Requesting…' : 'Request parent approval' }}</ion-button>
      </form>
      <p v-if="guardianMessage" :class="guardianError ? 'guardian-error' : 'guardian-success'" :role="guardianError ? 'alert' : 'status'">{{ guardianMessage }}</p>
      <template #actions><ion-button fill="outline" :disabled="parentLinkBusy" @click="guardianModalOpen = false; parentInviteOpen = true">Invite a parent</ion-button><ion-button fill="outline" :disabled="parentLinkBusy" @click="guardianModalOpen = false">Close</ion-button></template>
    </app-modal>
    <invite-parent-modal :open="parentInviteOpen" @close="parentInviteOpen = false" @invited="handleParentInvited" />

    <face-enrollment-modal
      :open="faceEnrollmentOpen"
      @close="faceEnrollmentOpen = false"
      @enrolled="handleFaceEnrolled"
    />
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonPage,
  IonSpinner,
  onIonViewWillEnter,
} from '@ionic/vue'
import {
  alertCircleOutline,
  arrowForwardOutline,
  barcodeOutline,
  calendarOutline,
  checkmarkCircleOutline,
  cloudOutline,
  peopleOutline,
  personCircleOutline,
  scanOutline,
  schoolOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from 'ionicons/icons'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import FaceEnrollmentModal from '@/components/FaceEnrollmentModal.vue'
import PortalHeader from '@/components/PortalHeader.vue'
import AppModal from '@/components/AppModal.vue'
import StudentHistoryPanel from '@/components/StudentHistoryPanel.vue'
import StudentSchedulePanel from '@/components/StudentSchedulePanel.vue'
import InviteParentModal from '@/components/InviteParentModal.vue'
import { useSession } from '@/composables/useSession'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
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
  archived_at?: string | null
}
interface GuardianSummary {
  request_id: string; parent_id: string; parent_name: string; parent_email: string
  status: 'pending' | 'approved' | 'rejected'; requested_at?: string; responded_at?: string | null
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
const firstName = ref('')
const lastName = ref('')
const guardianEmail = ref('')
const rawBarcode = ref<string | null>(null)
const joinCode = ref('')
const joinMessage = ref('')
const joinFailed = ref(false)
const registrationMessage = ref('')
const pageMessage = ref('')
const faceEnrolled = ref(false)
const faceRetakeAllowed = ref(false)
const faceEnrollmentOpen = ref(false)
const joinModalOpen = ref(false)
const guardianLinks = ref<GuardianSummary[]>([])
const guardianModalOpen = ref(false)
const parentInviteOpen = ref(false)
const parentLinkEmail = ref('')
const parentLinkBusy = ref(false)
const guardianMessage = ref('')
const guardianError = ref(false)
const hasApprovedParent = computed(() => guardianLinks.value.some(link => link.status === 'approved'))
const feedbackTimers = new Set<ReturnType<typeof setTimeout>>()
function expireFeedback(read: () => string, clear: () => void, message: string) {
  if (!message) return
  const timer = setTimeout(() => { feedbackTimers.delete(timer); if (read() === message) clear() }, 5000)
  feedbackTimers.add(timer)
}
watch(guardianMessage, message => { if (!guardianError.value) expireFeedback(() => guardianMessage.value, () => { guardianMessage.value = '' }, message) })
watch(joinMessage, message => { if (!joinFailed.value) expireFeedback(() => joinMessage.value, () => { joinMessage.value = '' }, message) })
onBeforeUnmount(() => { feedbackTimers.forEach(clearTimeout); feedbackTimers.clear() })

const registrationCompleted = computed(() => Boolean(studentProfile.value?.registration_completed_at))
const barcodeCaptured = computed(() => Boolean(rawBarcode.value))
const studentFirstName = computed(() => profile.value?.full_name?.trim().split(/\s+/)[0] || 'student')
const dashboardDate = computed(() =>
  new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()),
)
const activeSection = computed(() => {
  const value = typeof route.query.section === 'string' ? route.query.section : 'overview'
  return value === 'courses' || value === 'schedule' || value === 'history' ? value : 'overview'
})
const sectionTitle = computed(() => activeSection.value === 'courses' ? 'My courses' : activeSection.value === 'schedule' ? 'My calendar' : activeSection.value === 'history' ? 'Attendance history' : `Welcome back, ${studentFirstName.value}`)
const sectionDescription = computed(() => activeSection.value === 'courses' ? 'Your subjects, attendance, and connected coursework.' : activeSection.value === 'schedule' ? 'Your classes and task deadlines together. Choose the reminders that work for you.' : activeSection.value === 'history' ? 'Review your past attendance, teacher updates, and submitted photos.' : 'Open self-checks update automatically. Your completed attendance is saved in history.')

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
  let { data, error } = await supabase.rpc('my_face_enrollment_access')
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') {
      const fallback = await supabase.rpc('my_face_enrollment_status')
      data = fallback.data
      error = fallback.error
    }
  }
  if (error) {
    if (error.code === '42883' || error.code === 'PGRST202') return
    throw error
  }

  const status = Array.isArray(data) ? data[0] : data
  faceEnrolled.value = Boolean(status?.is_enrolled ?? status?.enrolled)
  faceRetakeAllowed.value = Boolean(status?.can_retake)
}

async function loadAvailableMeetings() {
  refreshing.value = true
  pageMessage.value = ''

  try {
    const { data, error } = await supabase
      .from('student_available_meetings')
      .select(
        'id, class_id, class_name, meeting_date, starts_at, ends_at, attendance_mode, attendance_enabled, attendance_opens_at, attendance_closes_at, existing_status, submitted_at',
      )
      .order('attendance_opens_at', { ascending: true })

    if (error) throw error
    meetings.value = ((data ?? []) as AvailableMeeting[]).filter(meeting => !meeting.existing_status && !meeting.submitted_at).slice(0, 1)
  } catch (error) {
    pageMessage.value = toUserFacingErrorMessage(error, 'Unable to load attendance meetings.')
  } finally {
    refreshing.value = false
  }
}

async function loadCoursesAndSchedule() {
  if (!user.value) return
  refreshingSchedule.value = true

  try {
    const enrollmentResult = await supabase
        .from('class_enrollments')
        .select('class:classes(id,name,timezone,archived_at)')
        .eq('student_id', user.value.id)
        .eq('is_active', true)
    if (enrollmentResult.error) throw enrollmentResult.error

    const enrollmentRows = (enrollmentResult.data ?? []) as unknown as Array<{
      class: StudentCourse | StudentCourse[] | null
    }>
    courses.value = enrollmentRows
      .flatMap((row) => Array.isArray(row.class) ? row.class : row.class ? [row.class] : [])
      .filter(course => !course.archived_at)
      .sort((first, second) => first.name.localeCompare(second.name))
  } catch (error) {
    pageMessage.value = toUserFacingErrorMessage(error, 'Unable to load your courses.')
  } finally {
    refreshingSchedule.value = false
  }
}

async function completeRegistration() {
  registrationMessage.value = ''
  const first = firstName.value.trim().toUpperCase()
  const last = lastName.value.trim().toUpperCase()
  const email = guardianEmail.value.trim().toLowerCase()

  if (!first || !last || `${first} ${last}`.length > 120) {
    registrationMessage.value = 'Enter your first name and last name (up to 120 characters combined).'
    return
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
      p_first_name: first,
      p_last_name: last,
      p_raw_barcode: rawBarcode.value,
      p_guardian_email: email || null,
    })
    if (error) throw error

    // Erase the raw credential from client memory as soon as the secure RPC has used it.
    rawBarcode.value = null
    await Promise.all([loadStudentProfile(), refreshProfile()])
    await Promise.all([loadAvailableMeetings(), loadCoursesAndSchedule(), loadGuardianLinks()])
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
  if (!hasApprovedParent.value) {
    joinFailed.value = true
    joinMessage.value = 'Your parent must approve your link before you can join a class.'
    return
  }

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
  if (!hasApprovedParent.value) {
    openGuardianModal()
    guardianMessage.value = 'Link a registered parent and wait for their approval before joining a class.'
    return
  }
  joinMessage.value = ''
  joinFailed.value = false
  joinModalOpen.value = true
}

async function loadGuardianLinks() {
  const actor = user.value?.id
  if (!actor) { guardianLinks.value = []; return }
  const { data, error } = await supabase.rpc('student_guardian_summary', { p_student_id: actor })
  if (user.value?.id !== actor) return
  if (error) { guardianLinks.value = []; throw error }
  guardianLinks.value = Array.isArray(data) ? data : []
}
function openGuardianModal() {
  parentLinkEmail.value = ''
  guardianMessage.value = ''
  guardianError.value = false
  guardianModalOpen.value = true
}
async function requestParentLink() {
  if (parentLinkBusy.value || !user.value) return
  parentLinkBusy.value = true; guardianMessage.value = ''; guardianError.value = false
  try {
    const { error } = await supabase.rpc('request_student_parent_link', { p_parent_email: parentLinkEmail.value.trim().toLowerCase() })
    if (error) throw error
    await loadGuardianLinks()
    guardianMessage.value = 'Request sent. Your parent must approve it from their account before you can join a class.'
    parentLinkEmail.value = ''
  } catch (error) { guardianError.value = true; guardianMessage.value = toUserFacingErrorMessage(error, 'The parent link could not be requested.') }
  finally { parentLinkBusy.value = false }
}
async function handleParentInvited() {
  try { await loadGuardianLinks() }
  catch (error) { pageMessage.value = toUserFacingErrorMessage(error, 'Unable to update parent connections.') }
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
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatMeetingTime(meeting: Pick<AvailableMeeting, 'starts_at' | 'ends_at'>): string {
  const dateAndTime = new Intl.DateTimeFormat(undefined, {
    timeZone: 'Asia/Manila',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(meeting.starts_at))
  const endTime = new Intl.DateTimeFormat(undefined, {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(meeting.ends_at))
  return `${dateAndTime} - ${endTime}`
}

function meetingModeMeta(mode: SelfAttendanceMode) {
  if (mode === 'self_online') {
    return {
      label: 'Online class',
      detail: 'Take a timestamped selfie and share your location privately with your linked parents.',
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
  faceRetakeAllowed.value = false
  faceEnrollmentOpen.value = false
  pageMessage.value = ''
}

function showHistory() { void router.push({ path: '/student', query: { section: 'history' } }) }
function showSchedule() { void router.push({ path: '/student', query: { section: 'schedule' } }) }
function openCourseTasks(classId: string) { void router.push({ path: '/student/tasks', query: { course: classId } }) }

async function logout() {
  signingOut.value = true
  try {
    await signOut()
    await router.replace('/login')
  } finally {
    signingOut.value = false
  }
}

async function loadStudentDashboard(promptForFaceEnrollment = false) {
  try {
    await initializeSession()
    if (!user.value || profile.value?.role !== 'student') return

    firstName.value = profile.value.first_name || ''
    lastName.value = profile.value.last_name || ''
    await loadStudentProfile()
    if (registrationCompleted.value) {
      await Promise.all([
        loadAvailableMeetings(),
        loadCoursesAndSchedule(),
        loadFaceEnrollmentStatus(),
        loadGuardianLinks(),
      ])
      if (promptForFaceEnrollment) faceEnrollmentOpen.value = !faceEnrolled.value
    }
  } catch (error) {
    pageMessage.value = toUserFacingErrorMessage(error, 'Unable to load the student account.')
  } finally {
    loading.value = false
  }
}

onMounted(() => loadStudentDashboard(true))
useRealtimeRefresh({ channel: 'student-dashboard', enabled: () => registrationCompleted.value && !savingRegistration.value && !signingOut.value, onChange: () => loadStudentDashboard() })
onIonViewWillEnter(async () => {
  if (loading.value || !registrationCompleted.value || refreshing.value || refreshingSchedule.value || signingOut.value || savingRegistration.value || joiningClass.value || faceEnrollmentOpen.value || joinModalOpen.value) return
  await loadStudentDashboard()
})
</script>

<style scoped>
.guardian-help { color: var(--campus-muted); font-size: 13px; line-height: 1.65; margin: 0; }
.guardian-links { display: grid; gap: 10px; margin: 18px 0; }
.guardian-links article { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; border: 1px solid var(--campus-border); border-radius: 12px; }
.guardian-links article > div { display: grid; gap: 4px; min-width: 0; }
.guardian-links small { color: var(--campus-muted); overflow-wrap: anywhere; }
.guardian-status { padding: 6px 9px; border-radius: 20px; font-size: 11px; background: var(--campus-warning-soft); color: var(--campus-warning); }
.guardian-status.is-approved { color: var(--campus-success); background: var(--campus-success-soft); }
.guardian-status.is-rejected, .guardian-error { color: var(--campus-danger); }
.guardian-success { color: var(--campus-success); }
.guardian-overview h2 { font-size: 19px; }
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
  background: var(--campus-surface-soft);
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
  background: var(--campus-surface-soft);
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
  grid-template-columns: minmax(0, 1fr);
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
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: 18px;
  padding-top: 18px;
}

.course-card {
  display: grid;
  align-content: start;
  gap: 18px;
  padding: 20px;
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
  font-size: 1.1rem;
  overflow-wrap: anywhere;
}

.course-card p {
  margin-top: 4px;
  color: var(--campus-muted);
  font-size: 0.75rem;
  line-height: 1.6;
}
.course-card-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; }
.course-card-actions { display:grid; gap:5px; margin-top:3px; }
.course-card-actions ion-button { margin:0; min-height:40px; }
.course-heading-actions { display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:flex-end; }
.live-update-label { display:inline-flex; align-items:center; gap:7px; margin-top:4px; color:var(--campus-success); font-size:11px; font-weight:650; }

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
  background: var(--campus-accent-soft);
  color: var(--campus-accent);
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
  background: var(--campus-surface-soft);
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
