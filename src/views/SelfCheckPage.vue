<template>
  <ion-page class="self-check-page">
    <ion-header class="campus-header" :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/student" text="" aria-label="Back to student dashboard" />
        </ion-buttons>
        <ion-title>
          <span class="toolbar-title">
            <strong>Student self-check</strong>
            <small>MinSU Attendance</small>
          </span>
        </ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="self-check-content" :fullscreen="true">
      <div
        v-if="loading"
        class="centered"
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Loading attendance self-check"
      >
        <div class="loading-state">
          <ion-spinner name="crescent" />
          <span>Loading your attendance window...</span>
        </div>
      </div>

      <main v-else-if="!meeting" class="self-check-shell narrow-shell">
        <section class="campus-surface unavailable-state">
          <div class="unavailable-icon"><ion-icon :icon="timeOutline" /></div>
          <p class="eyebrow">Attendance unavailable</p>
          <h1>This self-check cannot be opened</h1>
          <p>{{ message || 'This attendance window is closed or is not assigned to you.' }}</p>
          <ion-button class="primary-action" router-link="/student">
            Return to student dashboard
            <ion-icon slot="end" :icon="arrowForwardOutline" />
          </ion-button>
        </section>
      </main>

      <main v-else class="self-check-shell">
        <section class="meeting-banner">
          <div class="meeting-heading">
            <div class="meeting-mark" aria-hidden="true">
              <ion-icon :icon="meeting.attendance_mode === 'self_online' ? cloudOutline : schoolOutline" />
            </div>
            <div>
              <p class="eyebrow">{{ meeting.class_name }}</p>
              <h1>{{ meeting.title }}</h1>
              <p>{{ formatMode(meeting.attendance_mode) }}</p>
            </div>
          </div>
          <div class="open-status">
            <span class="live-dot"></span>
            <span><strong>Attendance open</strong><small>Closes {{ formatDateTime(meeting.attendance_closes_at) }}</small></span>
          </div>
        </section>

        <div class="check-in-layout">
          <section class="campus-surface flow-card" aria-labelledby="current-step-title">
            <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">
              {{ stageAnnouncement }}
            </p>
            <ol
              class="stepper"
              :style="{ '--step-count': String(checkInSteps.length) }"
              aria-label="Check-in progress"
            >
              <li
                v-for="(step, index) in checkInSteps"
                :key="step.key"
                :class="{
                  'is-current': index === currentStepIndex,
                  'is-complete': index < currentStepIndex,
                }"
                :aria-current="index === currentStepIndex ? 'step' : undefined"
              >
                <span class="step-number">
                  <ion-icon v-if="index < currentStepIndex" :icon="checkmarkOutline" />
                  <template v-else>{{ index + 1 }}</template>
                </span>
                <small>{{ step.label }}</small>
              </li>
            </ol>

            <div v-if="message" class="message-box is-error" role="alert">
              <ion-icon :icon="alertCircleOutline" />
              <span>{{ message }}</span>
            </div>

            <section v-if="currentStage === 'barcode'" class="check-in-stage">
              <div class="stage-icon"><ion-icon :icon="scanOutline" /></div>
              <p class="eyebrow">Step {{ currentStepIndex + 1 }} of {{ checkInSteps.length }}</p>
              <h2 id="current-step-title" ref="stageTitle" tabindex="-1">Scan your school ID</h2>
              <p class="stage-copy">
                Scan the long barcode on your physical ID using your camera or the connected barcode reader.
                The ID number remains hidden.
              </p>

              <div class="stage-actions barcode-actions">
                <ion-button
                  class="primary-action"
                  size="large"
                  :disabled="submitting || scanningCamera"
                  @click="scanWithCamera"
                >
                  <ion-spinner v-if="scanningCamera" name="crescent" />
                  <template v-else>
                    <ion-icon slot="start" :icon="cameraOutline" />
                    Scan with camera
                  </template>
                </ion-button>

                <div class="method-divider"><span>or use a connected reader</span></div>

                <barcode-capture
                  :disabled="submitting || scanningCamera"
                  @scan="acceptBarcode"
                  @invalid="showError"
                />
              </div>
            </section>

            <section v-else-if="currentStage === 'selfie'" class="check-in-stage">
              <div class="stage-icon"><ion-icon :icon="cameraOutline" /></div>
              <p class="eyebrow">Step {{ currentStepIndex + 1 }} of {{ checkInSteps.length }}</p>
              <h2 id="current-step-title" ref="stageTitle" tabindex="-1">Take a clear selfie</h2>
              <p class="stage-copy">
                Face the camera in good lighting. A new photo is required so your teacher can verify this check-in.
              </p>

              <div v-if="selfie" class="selfie-frame">
                <img :src="selfie.previewUrl" alt="Captured attendance selfie" />
                <span><ion-icon :icon="checkmarkCircleOutline" /> Photo captured</span>
              </div>

              <ion-button
                class="primary-action stage-main-action"
                size="large"
                :disabled="submitting || takingSelfie || Boolean(uploadedSelfiePath)"
                @click="takeSelfie"
              >
                <ion-spinner v-if="takingSelfie" name="crescent" />
                <template v-else>
                  <ion-icon slot="start" :icon="cameraOutline" />
                  {{ selfie ? 'Retake selfie' : 'Open camera' }}
                </template>
              </ion-button>
            </section>

            <section v-else-if="currentStage === 'location'" class="check-in-stage">
              <div class="stage-icon"><ion-icon :icon="locationOutline" /></div>
              <p class="eyebrow">Step {{ currentStepIndex + 1 }} of {{ checkInSteps.length }}</p>
              <h2 id="current-step-title" ref="stageTitle" tabindex="-1">Confirm your location</h2>
              <p class="stage-copy">
                Allow precise location while you are at school. The server securely checks whether you are within
                the approved 180-meter school area.
              </p>

              <div class="location-tip">
                <ion-icon :icon="informationCircleOutline" />
                <span>For the best result, turn on location services and move near a window or outdoors.</span>
              </div>

              <ion-button
                class="primary-action stage-main-action"
                size="large"
                :disabled="submitting || locating"
                @click="captureLocation"
              >
                <ion-spinner v-if="locating" name="crescent" />
                <template v-else>
                  <ion-icon slot="start" :icon="locationOutline" />
                  {{ location ? 'Refresh location' : 'Use current location' }}
                </template>
              </ion-button>
            </section>

            <section v-else class="check-in-stage review-stage">
              <div class="stage-icon is-complete"><ion-icon :icon="checkmarkCircleOutline" /></div>
              <p class="eyebrow">Final step</p>
              <h2 id="current-step-title" ref="stageTitle" tabindex="-1">Ready to submit</h2>
              <p class="stage-copy">Review the captured evidence below, then submit your attendance once.</p>

              <div class="evidence-review">
                <div v-if="requiresBarcode" class="evidence-item">
                  <span class="evidence-icon"><ion-icon :icon="barcodeOutline" /></span>
                  <div><strong>School ID</strong><small>Barcode captured securely</small></div>
                  <ion-icon class="evidence-check" :icon="checkmarkCircleOutline" />
                </div>

                <div class="evidence-item">
                  <span class="evidence-icon"><ion-icon :icon="cameraOutline" /></span>
                  <div><strong>Attendance selfie</strong><small>New photo captured</small></div>
                  <ion-icon class="evidence-check" :icon="checkmarkCircleOutline" />
                </div>

                <div v-if="requiresLocation" class="evidence-item">
                  <span class="evidence-icon"><ion-icon :icon="locationOutline" /></span>
                  <div>
                    <strong>Current location</strong>
                    <small>About {{ Math.round(location?.accuracyM ?? 0) }} m accuracy</small>
                  </div>
                  <ion-icon class="evidence-check" :icon="checkmarkCircleOutline" />
                </div>
              </div>

              <div v-if="selfie" class="review-photo">
                <img :src="selfie.previewUrl" alt="Attendance selfie ready for submission" />
              </div>

              <div class="review-edits">
                <button v-if="requiresBarcode" type="button" :disabled="submitting" @click="rescanBarcode">
                  Rescan ID
                </button>
                <button
                  type="button"
                  :disabled="submitting || takingSelfie || Boolean(uploadedSelfiePath)"
                  :aria-label="
                    uploadedSelfiePath
                      ? 'Selfie already uploaded. Retry attendance submission with this photo.'
                      : 'Retake selfie'
                  "
                  @click="takeSelfie"
                >
                  {{ uploadedSelfiePath ? 'Selfie uploaded' : 'Retake selfie' }}
                </button>
                <button v-if="requiresLocation" type="button" :disabled="submitting || locating" @click="captureLocation">
                  Refresh location
                </button>
              </div>

              <p v-if="uploadedSelfiePath" class="upload-retry-note" role="status">
                Your photo is already uploaded. If submission failed, use Submit attendance again to retry with
                this photo.
              </p>

              <ion-button
                class="primary-action submit-action"
                expand="block"
                size="large"
                :disabled="!canSubmit || submitting"
                @click="submitAttendance"
              >
                <ion-spinner v-if="submitting" name="crescent" />
                <template v-else>
                  Submit attendance
                  <ion-icon slot="end" :icon="arrowForwardOutline" />
                </template>
              </ion-button>

              <p class="submit-note"><ion-icon :icon="lockClosedOutline" /> Evidence is securely sent to your teacher for verification.</p>
            </section>
          </section>

          <aside class="check-in-sidebar">
            <section class="campus-surface requirement-card">
              <p class="eyebrow">Check-in requirements</p>
              <h2>{{ requiresLocation ? 'On-site verification' : 'Online verification' }}</h2>
              <div class="requirement-list">
                <div v-if="requiresBarcode" :class="{ 'is-complete': barcodeCaptured }">
                  <span><ion-icon :icon="barcodeOutline" /></span>
                  <div><strong>Physical school ID</strong><small>Long barcode scan</small></div>
                  <ion-icon v-if="barcodeCaptured" class="requirement-check" :icon="checkmarkCircleOutline" />
                </div>
                <div :class="{ 'is-complete': Boolean(selfie) }">
                  <span><ion-icon :icon="cameraOutline" /></span>
                  <div><strong>New selfie</strong><small>Teacher verification</small></div>
                  <ion-icon v-if="selfie" class="requirement-check" :icon="checkmarkCircleOutline" />
                </div>
                <div v-if="requiresLocation" :class="{ 'is-complete': Boolean(location) }">
                  <span><ion-icon :icon="locationOutline" /></span>
                  <div><strong>Precise location</strong><small>Within the school area</small></div>
                  <ion-icon v-if="location" class="requirement-check" :icon="checkmarkCircleOutline" />
                </div>
              </div>
            </section>

            <section class="privacy-card">
              <ion-icon :icon="shieldCheckmarkOutline" />
              <div>
                <strong>Private attendance evidence</strong>
                <p>Your photo and location are visible only to authorized school staff and your linked parent.</p>
              </div>
            </section>
          </aside>
        </div>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonBackButton,
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
  arrowForwardOutline,
  barcodeOutline,
  cameraOutline,
  checkmarkCircleOutline,
  checkmarkOutline,
  cloudOutline,
  informationCircleOutline,
  locationOutline,
  lockClosedOutline,
  scanOutline,
  schoolOutline,
  shieldCheckmarkOutline,
  timeOutline,
} from 'ionicons/icons'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
type CheckInStage = 'barcode' | 'selfie' | 'location' | 'submit'

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
const stageTitle = ref<HTMLElement | null>(null)

const meetingId = computed(() => {
  const value = route.params.meetingId
  return Array.isArray(value) ? value[0] : value
})
const requiresBarcode = computed(() => meeting.value?.attendance_mode !== 'self_online')
const requiresLocation = computed(() => meeting.value?.attendance_mode !== 'self_online')
const barcodeCaptured = computed(() => Boolean(rawBarcode.value))
const checkInSteps = computed<Array<{ key: CheckInStage; label: string }>>(() =>
  requiresBarcode.value
    ? [
        { key: 'barcode', label: 'Scan ID' },
        { key: 'selfie', label: 'Selfie' },
        { key: 'location', label: 'Location' },
        { key: 'submit', label: 'Submit' },
      ]
    : [
        { key: 'selfie', label: 'Selfie' },
        { key: 'submit', label: 'Submit' },
      ],
)
const currentStage = computed<CheckInStage>(() => {
  if (requiresBarcode.value && !rawBarcode.value) return 'barcode'
  if (!selfie.value) return 'selfie'
  if (requiresLocation.value && !location.value) return 'location'
  return 'submit'
})
const currentStepIndex = computed(() => {
  const index = checkInSteps.value.findIndex((step) => step.key === currentStage.value)
  return Math.max(index, 0)
})
const stageAnnouncement = computed(() => {
  if (scanningCamera.value) return 'Opening the camera to scan your school ID.'
  if (takingSelfie.value) return 'Opening the camera to take your attendance selfie.'
  if (locating.value) return 'Getting your current location.'
  if (submitting.value) return 'Submitting your attendance.'

  const step = checkInSteps.value[currentStepIndex.value]
  return `Step ${currentStepIndex.value + 1} of ${checkInSteps.value.length}: ${step?.label ?? 'Check-in'}.`
})
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

function rescanBarcode() {
  rawBarcode.value = null
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
  if (submitting.value || uploadedSelfiePath.value) return

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
  if (mode === 'self_online') return 'Online class - a new selfie is required.'
  if (mode === 'self_event') return 'School event - ID, selfie, and verified location required.'
  return 'On-site class - ID, selfie, and verified location required.'
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

watch(
  () => [loading.value, currentStage.value] as const,
  async ([isLoading, stage], [wasLoading, previousStage]) => {
    if (isLoading || (!wasLoading && stage === previousStage)) return
    await nextTick()
    stageTitle.value?.focus()
  },
)

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
.self-check-page {
  --campus-accent: var(--campus-blue, #245f86);
  --campus-accent-soft: var(--campus-blue-soft, #e1edf5);
  --campus-surface-subtle: var(--campus-surface-soft, #f5f8fa);
  --campus-green: var(--campus-success, #147a50);
  --campus-green-soft: var(--campus-success-soft, #e1f4eb);
  --campus-red: var(--campus-danger, #b73542);
  --campus-red-soft: var(--campus-danger-soft, #fae9ea);
  --campus-radius-lg: var(--campus-radius, 20px);
  --campus-radius-md: var(--campus-radius-sm, 14px);
}

.campus-header ion-toolbar {
  --background: rgba(255, 255, 255, 0.96);
  --border-color: var(--campus-border);
  --min-height: 68px;
}

.campus-header ion-back-button {
  --color: var(--campus-accent);
}

.toolbar-title strong,
.toolbar-title small {
  display: block;
}

.toolbar-title strong {
  color: var(--campus-text);
  font-size: 0.98rem;
  font-weight: 700;
}

.toolbar-title small {
  margin-top: 0.1rem;
  color: var(--campus-muted);
  font-size: 0.68rem;
  font-weight: 500;
}

.self-check-content {
  --background: var(--campus-bg);
}

.self-check-shell {
  width: min(1080px, calc(100% - 2rem));
  margin: 0 auto;
  padding: clamp(1.2rem, 4vw, 2.4rem) 0 4rem;
}

.narrow-shell {
  display: grid;
  min-height: 75vh;
  place-items: center;
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

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.eyebrow {
  margin: 0 0 0.35rem;
  color: var(--campus-muted);
  font-size: 0.7rem;
  font-weight: 750;
  letter-spacing: 0.075em;
  text-transform: uppercase;
}

.campus-surface {
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius-lg);
  background: var(--campus-surface);
  box-shadow: 0 14px 40px rgba(21, 54, 78, 0.065);
}

.meeting-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  margin-bottom: 1.25rem;
}

.meeting-heading {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  min-width: 0;
}

.meeting-mark {
  display: grid;
  flex: 0 0 auto;
  width: 3.4rem;
  height: 3.4rem;
  place-items: center;
  border-radius: 1rem;
  background: var(--campus-accent-soft);
  color: var(--campus-accent);
  font-size: 1.5rem;
}

.meeting-heading h1 {
  margin: 0;
  color: var(--campus-text);
  font-size: clamp(1.35rem, 3vw, 1.85rem);
  font-weight: 700;
  letter-spacing: -0.025em;
}

.meeting-heading > div > p:last-child {
  margin: 0.35rem 0 0;
  color: var(--campus-muted);
  font-size: 0.8rem;
}

.open-status {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0.7rem 0.85rem;
  border-radius: var(--campus-radius-md);
  background: var(--campus-green-soft);
  color: var(--campus-green);
}

.live-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 4px rgba(20, 122, 80, 0.12);
}

.open-status strong,
.open-status small {
  display: block;
}

.open-status strong {
  font-size: 0.76rem;
}

.open-status small {
  margin-top: 0.12rem;
  font-size: 0.68rem;
  opacity: 0.82;
}

.check-in-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(250px, 0.65fr);
  gap: 1.25rem;
  align-items: start;
}

.flow-card {
  min-height: 595px;
  padding: clamp(1.15rem, 3vw, 1.75rem);
}

.stepper {
  display: grid;
  grid-template-columns: repeat(var(--step-count), minmax(0, 1fr));
  margin: 0 0 clamp(2rem, 5vw, 3.3rem);
  padding: 0;
  list-style: none;
}

.stepper li {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 0.45rem;
  color: var(--campus-muted);
}

.stepper li::after {
  position: absolute;
  top: 0.92rem;
  left: calc(50% + 1.15rem);
  width: calc(100% - 2.3rem);
  height: 2px;
  background: var(--campus-border);
  content: '';
}

.stepper li:last-child::after {
  display: none;
}

.step-number {
  z-index: 1;
  display: grid;
  width: 1.9rem;
  height: 1.9rem;
  place-items: center;
  border-radius: 50%;
  background: #edf1f4;
  font-size: 0.72rem;
  font-weight: 750;
}

.stepper small {
  font-size: 0.68rem;
  font-weight: 650;
}

.stepper li.is-current {
  color: var(--campus-accent);
}

.stepper li.is-current .step-number {
  background: var(--campus-accent);
  color: #fff;
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--campus-accent) 12%, transparent);
}

.stepper li.is-complete {
  color: var(--campus-green);
}

.stepper li.is-complete .step-number {
  background: var(--campus-green-soft);
  color: var(--campus-green);
}

.stepper li.is-complete::after {
  background: var(--campus-green);
}

.check-in-stage {
  display: grid;
  max-width: 540px;
  justify-items: center;
  gap: 0.35rem;
  margin: 0 auto;
  text-align: center;
}

.stage-icon {
  display: grid;
  width: 5rem;
  height: 5rem;
  place-items: center;
  margin-bottom: 0.65rem;
  border-radius: 1.55rem;
  background: var(--campus-accent-soft);
  color: var(--campus-accent);
  font-size: 2.15rem;
}

.stage-icon.is-complete {
  background: var(--campus-green-soft);
  color: var(--campus-green);
}

.check-in-stage h2,
.requirement-card h2,
.unavailable-state h1 {
  margin: 0;
  color: var(--campus-text);
  font-size: clamp(1.35rem, 3vw, 1.7rem);
  font-weight: 700;
  letter-spacing: -0.025em;
}

.stage-copy {
  max-width: 440px;
  margin: 0.4rem 0 0;
  color: var(--campus-muted);
  font-size: 0.88rem;
  line-height: 1.6;
}

.stage-actions {
  display: grid;
  width: 100%;
  gap: 0.85rem;
  margin-top: 1.4rem;
}

.stage-main-action {
  min-width: min(100%, 245px);
  margin-top: 1.25rem;
}

.primary-action {
  min-height: 47px;
  margin-right: 0;
  margin-left: 0;
  --background: var(--campus-accent);
  --background-hover: #1c506f;
  --border-radius: 11px;
  --box-shadow: none;
  font-weight: 700;
}

.method-divider {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  color: var(--campus-muted);
  font-size: 0.68rem;
  text-transform: uppercase;
}

.method-divider::before,
.method-divider::after {
  flex: 1;
  height: 1px;
  background: var(--campus-border);
  content: '';
}

.barcode-actions :deep(.barcode-reader) {
  text-align: left;
}

.location-tip {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 0.55rem;
  margin-top: 1rem;
  padding: 0.75rem 0.85rem;
  border-radius: 11px;
  background: var(--campus-surface-subtle);
  color: var(--campus-muted);
  font-size: 0.77rem;
  line-height: 1.45;
  text-align: left;
}

.location-tip ion-icon {
  flex: 0 0 auto;
  color: var(--campus-accent);
  font-size: 1rem;
}

.selfie-frame {
  position: relative;
  width: min(100%, 310px);
  margin: 1rem auto 0;
  overflow: hidden;
  border: 3px solid #fff;
  border-radius: 1.1rem;
  box-shadow: 0 10px 30px rgba(21, 54, 78, 0.16);
}

.selfie-frame img,
.review-photo img {
  display: block;
  width: 100%;
  max-height: 330px;
  object-fit: cover;
}

.selfie-frame span {
  position: absolute;
  right: 0.55rem;
  bottom: 0.55rem;
  display: flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.35rem 0.55rem;
  border-radius: 999px;
  background: rgba(20, 122, 80, 0.92);
  color: #fff;
  font-size: 0.7rem;
  font-weight: 700;
}

.review-stage {
  max-width: 570px;
}

.evidence-review {
  display: grid;
  width: 100%;
  margin-top: 1rem;
  overflow: hidden;
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius-md);
  text-align: left;
}

.evidence-item {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.7rem;
  padding: 0.8rem;
  border-bottom: 1px solid var(--campus-border);
}

.evidence-item:last-child {
  border-bottom: 0;
}

.evidence-icon {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border-radius: 0.7rem;
  background: var(--campus-accent-soft);
  color: var(--campus-accent);
}

.evidence-item strong,
.evidence-item small {
  display: block;
}

.evidence-item strong {
  color: var(--campus-text);
  font-size: 0.8rem;
}

.evidence-item small {
  margin-top: 0.15rem;
  color: var(--campus-muted);
  font-size: 0.7rem;
}

.evidence-check {
  color: var(--campus-green);
  font-size: 1.2rem;
}

.review-photo {
  width: min(100%, 180px);
  margin-top: 0.8rem;
  overflow: hidden;
  border-radius: 0.9rem;
}

.review-photo img {
  max-height: 180px;
}

.review-edits {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 0.35rem 0.9rem;
  margin-top: 0.65rem;
}

.review-edits button {
  min-height: 44px;
  padding: 0.65rem 0.35rem;
  border: 0;
  background: transparent;
  color: var(--campus-accent);
  font: inherit;
  font-size: 0.73rem;
  font-weight: 700;
}

.review-edits button:disabled {
  opacity: 0.5;
}

.upload-retry-note {
  max-width: 430px;
  margin: 0.5rem 0 0;
  color: var(--campus-muted);
  font-size: 0.72rem;
  line-height: 1.45;
}

.submit-action {
  width: 100%;
  margin-top: 0.9rem;
}

.submit-note {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  margin: 0.4rem 0 0;
  color: var(--campus-muted);
  font-size: 0.68rem;
}

.check-in-sidebar {
  display: grid;
  gap: 1rem;
}

.requirement-card {
  padding: 1.2rem;
}

.requirement-card h2 {
  font-size: 1.1rem;
}

.requirement-list {
  display: grid;
  margin-top: 1rem;
}

.requirement-list > div {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0.8rem 0;
  border-top: 1px solid var(--campus-border);
}

.requirement-list > div > span {
  display: grid;
  width: 2.25rem;
  height: 2.25rem;
  place-items: center;
  border-radius: 0.7rem;
  background: var(--campus-surface-subtle);
  color: var(--campus-muted);
}

.requirement-list > div.is-complete > span {
  background: var(--campus-green-soft);
  color: var(--campus-green);
}

.requirement-list strong,
.requirement-list small {
  display: block;
}

.requirement-list strong {
  color: var(--campus-text);
  font-size: 0.78rem;
}

.requirement-list small {
  margin-top: 0.15rem;
  color: var(--campus-muted);
  font-size: 0.68rem;
}

.requirement-check {
  color: var(--campus-green);
  font-size: 1.1rem;
}

.privacy-card {
  display: flex;
  gap: 0.75rem;
  padding: 1rem;
  border-radius: var(--campus-radius-md);
  background: #e7f1f6;
  color: var(--campus-accent);
}

.privacy-card > ion-icon {
  flex: 0 0 auto;
  margin-top: 0.08rem;
  font-size: 1.2rem;
}

.privacy-card strong {
  color: var(--campus-text);
  font-size: 0.79rem;
}

.privacy-card p {
  margin: 0.28rem 0 0;
  color: var(--campus-muted);
  font-size: 0.71rem;
  line-height: 1.45;
}

.message-box {
  display: flex;
  align-items: flex-start;
  gap: 0.55rem;
  margin: -1.5rem 0 1.5rem;
  padding: 0.75rem 0.85rem;
  border-radius: 11px;
  font-size: 0.8rem;
  line-height: 1.4;
}

.message-box ion-icon {
  flex: 0 0 auto;
  margin-top: 0.08rem;
}

.message-box.is-error {
  background: var(--campus-red-soft);
  color: var(--campus-red);
}

.unavailable-state {
  display: grid;
  max-width: 520px;
  justify-items: center;
  gap: 0.55rem;
  padding: clamp(2rem, 7vw, 3.5rem);
  text-align: center;
}

.unavailable-icon {
  display: grid;
  width: 4.6rem;
  height: 4.6rem;
  place-items: center;
  margin-bottom: 0.55rem;
  border-radius: 1.4rem;
  background: var(--campus-red-soft);
  color: var(--campus-red);
  font-size: 2rem;
}

.unavailable-state > p:not(.eyebrow) {
  margin: 0.2rem 0 1rem;
  color: var(--campus-muted);
  font-size: 0.88rem;
  line-height: 1.55;
}

@media (prefers-color-scheme: dark) {
  .campus-header ion-toolbar {
    --background: rgba(17, 29, 39, 0.97);
  }

  .step-number {
    background: #22313c;
  }

  .privacy-card {
    background: #132b3c;
  }

  .selfie-frame {
    border-color: #263746;
  }
}

@media (max-width: 800px) {
  .check-in-layout {
    grid-template-columns: 1fr;
  }

  .check-in-sidebar {
    grid-template-columns: minmax(0, 1fr) minmax(230px, 0.8fr);
  }
}

@media (max-width: 620px) {
  .self-check-shell {
    width: min(100% - 1rem, 1080px);
    padding-top: 1rem;
  }

  .meeting-banner {
    display: grid;
  }

  .open-status {
    width: 100%;
  }

  .flow-card {
    min-height: 0;
    padding: 1rem;
  }

  .stepper {
    margin-bottom: 2.3rem;
  }

  .stepper small {
    font-size: 0.62rem;
  }

  .stage-icon {
    width: 4.25rem;
    height: 4.25rem;
    border-radius: 1.25rem;
    font-size: 1.8rem;
  }

  .check-in-sidebar {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 390px) {
  .meeting-mark {
    display: none;
  }

  .stepper small {
    max-width: 3.5rem;
    text-align: center;
  }
}
</style>
