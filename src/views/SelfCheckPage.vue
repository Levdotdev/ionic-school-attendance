<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/student" />
        </ion-buttons>
        <ion-title>Attendance self-check</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <div v-if="loading" class="centered">
        <ion-spinner name="crescent" />
      </div>

      <ion-card v-else-if="!meeting">
        <ion-card-header>
          <ion-card-title>Self-check unavailable</ion-card-title>
        </ion-card-header>
        <ion-card-content>
          <p>{{ message || 'This attendance window is closed or is not assigned to you.' }}</p>
          <ion-button router-link="/student">Return to student page</ion-button>
        </ion-card-content>
      </ion-card>

      <template v-else>
        <ion-card>
          <ion-card-header>
            <ion-card-title>{{ meeting.class_name }} — {{ meeting.title }}</ion-card-title>
            <ion-card-subtitle>{{ formatMode(meeting.attendance_mode) }}</ion-card-subtitle>
          </ion-card-header>
          <ion-card-content>
            Attendance closes {{ formatDateTime(meeting.attendance_closes_at) }}.
          </ion-card-content>
        </ion-card>

        <div class="evidence-stack">
          <ion-card v-if="requiresBarcode">
            <ion-card-header>
              <ion-card-title>1. Scan your student ID</ion-card-title>
              <ion-card-subtitle>The barcode value is hidden and cannot be typed manually.</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content class="stack">
              <ion-button
                type="button"
                fill="outline"
                :disabled="submitting || scanningCamera"
                @click="scanWithCamera"
              >
                <ion-spinner v-if="scanningCamera" name="crescent" />
                <span v-else>Scan ID with camera</span>
              </ion-button>
              <barcode-capture
                :disabled="submitting || scanningCamera"
                @scan="acceptBarcode"
                @invalid="showError"
              />
              <ion-note :color="barcodeCaptured ? 'success' : 'medium'">
                {{ barcodeCaptured ? 'Student ID barcode captured.' : 'Student ID barcode still required.' }}
              </ion-note>
            </ion-card-content>
          </ion-card>

          <ion-card>
            <ion-card-header>
              <ion-card-title>{{ requiresBarcode ? '2' : '1' }}. Take a selfie</ion-card-title>
              <ion-card-subtitle>Take a new photo now so your teacher can verify attendance.</ion-card-subtitle>
            </ion-card-header>
            <ion-card-content class="stack">
              <img v-if="selfie" class="selfie-preview" :src="selfie.previewUrl" alt="Captured attendance selfie" />
              <ion-button
                type="button"
                fill="outline"
                :disabled="submitting || takingSelfie || Boolean(uploadedSelfiePath)"
                @click="takeSelfie"
              >
                <ion-spinner v-if="takingSelfie" name="crescent" />
                <span v-else>{{ selfie ? 'Retake selfie' : 'Open camera' }}</span>
              </ion-button>
              <ion-note v-if="uploadedSelfiePath" color="success">
                Selfie uploaded securely. It will be reused if you retry submission.
              </ion-note>
            </ion-card-content>
          </ion-card>

          <ion-card v-if="requiresLocation">
            <ion-card-header>
              <ion-card-title>3. Confirm your location</ion-card-title>
              <ion-card-subtitle>
                Precise location is checked by the server against the location and radius set by your teacher.
              </ion-card-subtitle>
            </ion-card-header>
            <ion-card-content class="stack">
              <ion-button
                type="button"
                fill="outline"
                :disabled="submitting || locating"
                @click="captureLocation"
              >
                <ion-spinner v-if="locating" name="crescent" />
                <span v-else>{{ location ? 'Refresh location' : 'Get current location' }}</span>
              </ion-button>
              <ion-note :color="location ? 'success' : 'medium'">
                <template v-if="location">
                  Location captured with about {{ Math.round(location.accuracyM) }} m accuracy.
                </template>
                <template v-else>Current location is still required.</template>
              </ion-note>
            </ion-card-content>
          </ion-card>

          <ion-note v-if="message" color="danger" role="alert">{{ message }}</ion-note>

          <ion-button expand="block" size="large" :disabled="!canSubmit || submitting" @click="submitAttendance">
            <ion-spinner v-if="submitting" name="crescent" />
            <span v-else>Submit attendance</span>
          </ion-button>
        </div>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonBackButton,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonNote,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BarcodeCapture from '@/components/BarcodeCapture.vue'
import { useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import { scanStudentBarcode } from '@/services/barcode'
import { captureAttendanceLocation, type AttendanceLocation } from '@/services/location'
import {
  captureSelfie,
  releaseSelfiePreview,
  uploadAttendanceSelfie,
  type CapturedSelfie,
} from '@/services/selfie'
import { toUserFacingErrorMessage } from '@/utils/errors'

type SelfAttendanceMode = 'self_on_site' | 'self_event' | 'self_online'

interface AvailableMeeting {
  id: string
  class_name: string
  title: string
  attendance_mode: SelfAttendanceMode
  attendance_closes_at: string
  max_accuracy_m: number | null
  existing_status: 'present' | 'absent' | null
}

const route = useRoute()
const router = useRouter()
const { initializeSession, user } = useSession()

const loading = ref(true)
const scanningCamera = ref(false)
const takingSelfie = ref(false)
const locating = ref(false)
const submitting = ref(false)
const meeting = ref<AvailableMeeting | null>(null)
const rawBarcode = ref<string | null>(null)
const selfie = ref<CapturedSelfie | null>(null)
const uploadedSelfiePath = ref<string | null>(null)
const location = ref<AttendanceLocation | null>(null)
const message = ref('')

const meetingId = computed(() => {
  const value = route.params.meetingId
  return Array.isArray(value) ? value[0] : value
})
const requiresBarcode = computed(() => meeting.value?.attendance_mode !== 'self_online')
const requiresLocation = computed(() => meeting.value?.attendance_mode !== 'self_online')
const barcodeCaptured = computed(() => Boolean(rawBarcode.value))
const canSubmit = computed(() => {
  if (!meeting.value || !selfie.value) return false
  if (requiresBarcode.value && !rawBarcode.value) return false
  if (requiresLocation.value && !location.value) return false
  return true
})

function showError(error: unknown) {
  message.value = toUserFacingErrorMessage(error)
}

function acceptBarcode(value: string) {
  rawBarcode.value = value
  message.value = ''
}

async function scanWithCamera() {
  scanningCamera.value = true
  message.value = ''
  try {
    acceptBarcode(await scanStudentBarcode())
  } catch (error) {
    showError(error)
  } finally {
    scanningCamera.value = false
  }
}

async function takeSelfie() {
  takingSelfie.value = true
  message.value = ''

  try {
    const nextSelfie = await captureSelfie()
    releaseSelfiePreview(selfie.value)
    selfie.value = nextSelfie
    uploadedSelfiePath.value = null
  } catch (error) {
    showError(error)
  } finally {
    takingSelfie.value = false
  }
}

async function captureLocation() {
  locating.value = true
  message.value = ''

  try {
    const nextLocation = await captureAttendanceLocation()
    const maxAccuracy = meeting.value?.max_accuracy_m

    if (maxAccuracy && nextLocation.accuracyM > maxAccuracy) {
      location.value = null
      throw new Error(
        `Location accuracy is ${Math.round(nextLocation.accuracyM)} m; ${Math.round(maxAccuracy)} m or better is required. Move outdoors and try again.`,
      )
    }

    location.value = nextLocation
  } catch (error) {
    showError(error)
  } finally {
    locating.value = false
  }
}

async function loadMeeting() {
  if (!meetingId.value) throw new Error('The meeting ID is missing.')

  const { data, error } = await supabase
    .from('student_available_meetings')
    .select('id, class_name, title, attendance_mode, attendance_closes_at, max_accuracy_m, existing_status')
    .eq('id', meetingId.value)
    .maybeSingle()

  if (error) throw error
  if (!data) {
    meeting.value = null
    return
  }

  if (data.existing_status) {
    meeting.value = null
    message.value = 'Attendance has already been submitted for this meeting.'
    return
  }

  meeting.value = data as AvailableMeeting
}

async function submitAttendance() {
  if (!canSubmit.value || !meeting.value || !selfie.value || !user.value) return

  submitting.value = true
  message.value = ''

  try {
    if (!uploadedSelfiePath.value) {
      uploadedSelfiePath.value = await uploadAttendanceSelfie(
        selfie.value,
        user.value.id,
        meeting.value.id,
      )
    }

    const { error } = await supabase.rpc('submit_self_attendance', {
      p_meeting_id: meeting.value.id,
      p_selfie_path: uploadedSelfiePath.value,
      p_raw_barcode: requiresBarcode.value ? rawBarcode.value : null,
      p_latitude: requiresLocation.value ? location.value?.latitude ?? null : null,
      p_longitude: requiresLocation.value ? location.value?.longitude ?? null : null,
      p_accuracy_m: requiresLocation.value ? location.value?.accuracyM ?? null : null,
    })
    if (error) throw error

    rawBarcode.value = null
    await router.replace('/student')
  } catch (error) {
    showError(error)
  } finally {
    submitting.value = false
  }
}

function formatMode(mode: SelfAttendanceMode): string {
  if (mode === 'self_online') return 'Online class: selfie required; barcode and location are not collected.'
  if (mode === 'self_event') return 'Event: student ID barcode, selfie, and verified location are required.'
  return 'On-site class: student ID barcode, selfie, and verified location are required.'
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

onMounted(async () => {
  try {
    await initializeSession()
    await loadMeeting()
  } catch (error) {
    showError(error)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => releaseSelfiePreview(selfie.value))
</script>

<style scoped>
.centered {
  display: grid;
  min-height: 50vh;
  place-items: center;
}

.evidence-stack,
.stack {
  display: grid;
  gap: 1rem;
}

.selfie-preview {
  display: block;
  width: min(100%, 360px);
  max-height: 420px;
  margin: 0 auto;
  object-fit: cover;
  border-radius: 0.5rem;
}
</style>
