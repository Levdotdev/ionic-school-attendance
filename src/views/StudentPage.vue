<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Student attendance</ion-title>
        <ion-buttons slot="end">
          <ion-button :disabled="signingOut" @click="logout">Sign out</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div v-if="loading" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <template v-else>
        <ion-card v-if="!registrationCompleted">
          <ion-card-header>
            <ion-card-title>Complete student registration</ion-card-title>
            <ion-card-subtitle>
              Your physical school ID is required. Its barcode value remains hidden and cannot be typed manually.
            </ion-card-subtitle>
          </ion-card-header>

          <ion-card-content>
            <form class="stack" @submit.prevent="completeRegistration">
              <ion-input
                v-model="fullName"
                label="Student full name"
                label-placement="stacked"
                autocomplete="name"
                :disabled="savingRegistration"
                required
              />

              <ion-input
                v-model="guardianEmail"
                type="email"
                label="Parent / guardian email"
                label-placement="stacked"
                autocomplete="email"
                :disabled="savingRegistration"
                required
              />

              <div class="scan-actions">
                <ion-button
                  type="button"
                  fill="outline"
                  :disabled="savingRegistration || scanningCamera"
                  @click="scanWithCamera"
                >
                  <ion-spinner v-if="scanningCamera" name="crescent" />
                  <span v-else>Scan ID with camera</span>
                </ion-button>

                <ion-note :color="barcodeCaptured ? 'success' : 'medium'">
                  {{ barcodeCaptured ? 'ID barcode captured.' : 'No ID barcode captured yet.' }}
                </ion-note>
              </div>

              <barcode-capture
                :disabled="savingRegistration || scanningCamera"
                @scan="acceptBarcode"
                @invalid="showRegistrationError"
              />

              <ion-note v-if="registrationMessage" color="danger" role="alert">
                {{ registrationMessage }}
              </ion-note>

              <ion-button expand="block" type="submit" :disabled="savingRegistration || !barcodeCaptured">
                <ion-spinner v-if="savingRegistration" name="crescent" />
                <span v-else>Finish registration</span>
              </ion-button>
            </form>
          </ion-card-content>
        </ion-card>

        <section v-else class="meetings">
          <ion-card>
            <ion-card-header>
              <ion-card-title>Join a class</ion-card-title>
              <ion-card-subtitle>Enter the join code shared by your teacher.</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content>
              <form class="join-form" @submit.prevent="joinClass">
                <ion-input
                  v-model="joinCode"
                  label="Class join code"
                  label-placement="stacked"
                  fill="outline"
                  :maxlength="16"
                  :disabled="joiningClass"
                  required
                />
                <ion-button type="submit" :disabled="joiningClass || joinCode.trim().length < 6">
                  <ion-spinner v-if="joiningClass" name="crescent" />
                  <span v-else>Join class</span>
                </ion-button>
              </form>
              <ion-note v-if="joinMessage" :color="joinFailed ? 'danger' : 'success'" role="status">
                {{ joinMessage }}
              </ion-note>
            </ion-card-content>
          </ion-card>

          <div class="section-heading">
            <div>
              <h2>Available self-checks</h2>
              <p>Only attendance windows assigned to you and currently open are shown.</p>
            </div>
            <ion-button fill="outline" size="small" :disabled="refreshing" @click="loadAvailableMeetings">
              Refresh
            </ion-button>
          </div>

          <ion-note v-if="pageMessage" color="danger" role="alert">{{ pageMessage }}</ion-note>

          <ion-list v-if="meetings.length">
            <ion-item v-for="meeting in meetings" :key="meeting.id">
              <ion-label class="ion-text-wrap">
                <h2>{{ meeting.class_name }} — {{ meeting.title }}</h2>
                <p>{{ formatMeetingTime(meeting) }}</p>
                <p>{{ formatMode(meeting.attendance_mode) }}</p>
                <p v-if="meeting.existing_status">
                  Recorded: {{ meeting.existing_status }}
                  <span v-if="meeting.submitted_at">({{ formatDateTime(meeting.submitted_at) }})</span>
                </p>
              </ion-label>

              <ion-button
                slot="end"
                :disabled="Boolean(meeting.existing_status)"
                @click="openSelfCheck(meeting.id)"
              >
                {{ meeting.existing_status ? 'Submitted' : 'Check in' }}
              </ion-button>
            </ion-item>
          </ion-list>

          <ion-card v-else>
            <ion-card-content>No self-check attendance is open right now.</ion-card-content>
          </ion-card>
        </section>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import BarcodeCapture from '@/components/BarcodeCapture.vue'
import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import { scanStudentBarcode } from '@/services/barcode'

type SelfAttendanceMode = 'self_on_site' | 'self_event' | 'self_online'

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

const router = useRouter()
const { initializeSession, profile, refreshProfile, signOut, user } = useSession()

const loading = ref(true)
const refreshing = ref(false)
const signingOut = ref(false)
const savingRegistration = ref(false)
const scanningCamera = ref(false)
const joiningClass = ref(false)
const studentProfile = ref<StudentProfileRow | null>(null)
const meetings = ref<AvailableMeeting[]>([])
const fullName = ref('')
const guardianEmail = ref('')
const rawBarcode = ref<string | null>(null)
const joinCode = ref('')
const joinMessage = ref('')
const joinFailed = ref(false)
const registrationMessage = ref('')
const pageMessage = ref('')

const registrationCompleted = computed(() => Boolean(studentProfile.value?.registration_completed_at))
const barcodeCaptured = computed(() => Boolean(rawBarcode.value))

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
    showRegistrationError(error instanceof Error ? error.message : 'The barcode scan failed.')
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
    pageMessage.value = error instanceof Error ? error.message : 'Unable to load attendance meetings.'
  } finally {
    refreshing.value = false
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
    await loadAvailableMeetings()
  } catch (error) {
    registrationMessage.value = error instanceof Error ? error.message : 'Registration could not be completed.'
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
    await loadAvailableMeetings()
  } catch (error) {
    joinFailed.value = true
    joinMessage.value = error instanceof Error ? error.message : 'The class could not be joined.'
  } finally {
    joiningClass.value = false
  }
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatMeetingTime(meeting: AvailableMeeting): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  return `${formatter.format(new Date(meeting.starts_at))}–${new Intl.DateTimeFormat(undefined, {
    timeStyle: 'short',
  }).format(new Date(meeting.ends_at))}`
}

function formatMode(mode: SelfAttendanceMode): string {
  if (mode === 'self_online') return 'Online class — selfie required'
  if (mode === 'self_event') return 'School event — ID barcode, selfie, and location required'
  return 'On-site class — ID barcode, selfie, and location required'
}

async function openSelfCheck(meetingId: string) {
  await router.push(`/student/check-in/${meetingId}`)
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
    if (registrationCompleted.value) await loadAvailableMeetings()
  } catch (error) {
    pageMessage.value = error instanceof Error ? error.message : 'Unable to load the student account.'
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.centered {
  display: grid;
  min-height: 50vh;
  place-items: center;
}

.stack,
.meetings {
  display: grid;
  gap: 1rem;
}

.scan-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: center;
}

.join-form {
  display: grid;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: start;
}

.section-heading h2,
.section-heading p {
  margin: 0 0 0.25rem;
}
</style>
