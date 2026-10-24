<template>
  <app-modal :open="open" :title="retaking ? 'Retake face enrollment' : 'Face verification'" :busy="saving || capturing" @close="closeModal">
      <div class="enrollment-shell">
        <img class="enrollment-logo" src="/minsu-logo.png" alt="Mindoro State University seal" />
        <p class="eyebrow">Student identity</p>
        <h2>{{ locked ? 'Your face is already enrolled' : samples.length ? prompts[samples.length] ?? 'Review enrollment' : retaking ? 'Your retake is authorized' : 'Register your face once' }}</h2>
        <p v-if="loadingAccess" class="intro" role="status"><ion-spinner name="crescent" /> Checking enrollment access…</p>
        <p v-else-if="locked" class="intro">Face enrollment is completed once. Ask an administrator to authorize a retake if your saved enrollment needs to change.</p>
        <p v-if="!locked" class="intro">
          Take three new photos in good light. A numerical face template is saved privately and used to compare future
          self-check selfies. The photos used here are not uploaded.
        </p>
        <p v-if="retaking" class="retake-note">Your administrator authorized one replacement. Your current enrollment stays active until you save the new one.</p>

        <div v-if="!locked" class="sample-grid" aria-label="Face enrollment progress">
          <div v-for="index in 3" :key="index" class="sample" :class="{ complete: samples.length >= index }">
            <img v-if="previews[index - 1]" :src="previews[index - 1]" alt="Captured face enrollment sample" />
            <span v-else>{{ index }}</span>
            <small>{{ labels[index - 1] }}</small>
          </div>
        </div>

        <div v-if="message" class="face-message" role="alert">{{ message }}</div>

        <ion-button
          v-if="!locked && samples.length < 3"
          expand="block"
          size="large"
          :disabled="capturing || saving || loadingAccess || !accessReady"
          @click="captureSample"
        >
          <ion-spinner v-if="capturing" name="crescent" />
          <template v-else>
            <ion-icon slot="start" :icon="cameraOutline" />
            Take photo {{ samples.length + 1 }} of 3
          </template>
        </ion-button>

        <label v-if="samples.length === 3" class="consent-row">
          <ion-checkbox v-model="consented" />
          <span>I consent to storing my private face template for school attendance verification.</span>
        </label>

        <ion-button
          v-if="samples.length === 3"
          expand="block"
          size="large"
          :disabled="!consented || saving || loadingAccess || !accessReady || locked"
          @click="saveEnrollment"
        >
          <ion-spinner v-if="saving" name="crescent" />
          <template v-else>
            <ion-icon slot="start" :icon="shieldCheckmarkOutline" />
            Save face enrollment
          </template>
        </ion-button>

        <ion-button v-if="samples.length" expand="block" fill="clear" :disabled="capturing || saving" @click="reset">
          Start over
        </ion-button>

        <p class="fallback-note">
          If face verification is unavailable or you do not consent, ask your teacher to mark attendance manually.
        </p>
      </div>
  </app-modal>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonCheckbox,
  IonIcon,
  IonSpinner,
} from '@ionic/vue'
import { cameraOutline, shieldCheckmarkOutline } from 'ionicons/icons'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import AppModal from '@/components/AppModal.vue'

import { supabase } from '@/lib/supabase'
import { analyzeFace, FACE_MODEL_VERSION, validateEnrollmentSamples, type FaceAnalysis } from '@/services/faceRecognition'
import { captureSelfie, releaseSelfiePreview, type CapturedSelfie } from '@/services/selfie'
import { toUserFacingErrorMessage } from '@/utils/errors'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  close: []
  enrolled: []
}>()

const prompts = ['Look directly at the camera', 'Turn slightly to your left', 'Turn slightly to your right', 'Ready to save']
const labels = ['Front', 'Left', 'Right']
const samples = ref<FaceAnalysis[]>([])
const captured = ref<CapturedSelfie[]>([])
const previews = ref<string[]>([])
const capturing = ref(false)
const saving = ref(false)
const consented = ref(false)
const message = ref('')
const loadingAccess = ref(false), accessReady = ref(false)
const access = ref({ is_enrolled: false, can_retake: false })
const locked = computed(() => access.value.is_enrolled && !access.value.can_retake)
const retaking = computed(() => access.value.is_enrolled && access.value.can_retake)
let accessRequest = 0
let disposed = false
watch(() => props.open, async open => {
  const request = ++accessRequest
  reset(); accessReady.value = false
  if (!open) { loadingAccess.value = false; return }
  loadingAccess.value = true
  try {
    const { data, error } = await supabase.rpc('my_face_enrollment_access')
    if (request !== accessRequest) return
    if (error) throw error
    const current = Array.isArray(data) ? data[0] : data
    if (!current || typeof current.is_enrolled !== 'boolean') throw new Error('Your face enrollment access could not be checked. Close this dialog and try again.')
    access.value = { is_enrolled: current.is_enrolled, can_retake: Boolean(current.can_retake) }
    accessReady.value = true
  } catch (error) { if (request === accessRequest) message.value = toUserFacingErrorMessage(error, 'Unable to check face enrollment access.') }
  finally { if (request === accessRequest) loadingAccess.value = false }
}, { immediate: true })

async function captureSample() {
  if (capturing.value || saving.value || samples.value.length >= 3 || locked.value || !accessReady.value || loadingAccess.value) return
  capturing.value = true
  message.value = ''
  let photo: CapturedSelfie | null = null
  try {
    photo = await captureSelfie()
    const analysis = await analyzeFace(photo.blob)
    if (disposed || !props.open) { releaseSelfiePreview(photo); return }
    captured.value.push(photo)
    previews.value.push(photo.previewUrl)
    samples.value.push(analysis)
  } catch (error) {
    releaseSelfiePreview(photo)
    message.value = toUserFacingErrorMessage(error, 'The face photo could not be processed.')
  } finally {
    capturing.value = false
  }
}

async function saveEnrollment() {
  if (saving.value || capturing.value || !consented.value || samples.value.length !== 3 || locked.value || !accessReady.value) return
  saving.value = true
  message.value = ''
  try {
    const embedding = await validateEnrollmentSamples(samples.value)
    const { error } = await supabase.rpc('enroll_my_face', {
      p_embedding: embedding,
      p_model_version: FACE_MODEL_VERSION,
      p_sample_count: samples.value.length,
    })
    if (error) throw error
    access.value = { is_enrolled: true, can_retake: false }
    emit('enrolled')
    reset()
  } catch (error) {
    message.value = toUserFacingErrorMessage(error, 'Face enrollment could not be saved.')
  } finally {
    saving.value = false
  }
}

function reset() {
  captured.value.forEach((photo) => releaseSelfiePreview(photo))
  captured.value = []
  previews.value = []
  samples.value = []
  consented.value = false
  message.value = ''
}

function closeModal() {
  if (saving.value || capturing.value) return
  reset()
  emit('close')
}

onBeforeUnmount(() => { disposed = true; accessRequest++; reset() })
</script>

<style scoped>
.enrollment-shell {
  width: min(100%, 500px);
  margin: 0 auto;
  padding: 0;
  text-align: center;
}

.enrollment-logo {
  width: 76px;
  height: 76px;
  object-fit: contain;
}

.eyebrow {
  margin: 12px 0 4px;
  color: var(--campus-green);
  font-size: 0.7rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

h2 {
  margin: 0;
  color: var(--campus-text);
}

.intro,
.fallback-note {
  color: var(--campus-muted);
  line-height: 1.6;
}
.retake-note { margin: 12px 0; padding: 12px; border-radius: 10px; color: var(--campus-green); background: var(--campus-green-soft); font-size: 12px; line-height: 1.6; }

.sample-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 24px 0;
}

.sample {
  display: grid;
  min-width: 0;
  gap: 7px;
  place-items: center;
  color: var(--campus-muted);
}

.sample > span,
.sample > img {
  display: grid;
  width: 88px;
  max-width: 100%;
  aspect-ratio: 1;
  place-items: center;
  border: 2px dashed var(--campus-border);
  border-radius: 50%;
  object-fit: cover;
  background: var(--campus-surface-soft);
  font-weight: 800;
}

.sample.complete > span,
.sample.complete > img {
  border-color: var(--campus-green);
}

.sample small {
  font-weight: 700;
}

.consent-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin: 18px 0;
  color: var(--campus-text);
  text-align: left;
  line-height: 1.45;
}

.face-message {
  margin: 0 0 16px;
  padding: 12px;
  border-radius: 12px;
  background: var(--campus-danger-soft);
  color: var(--campus-danger);
}

.fallback-note {
  margin-top: 20px;
  font-size: 0.76rem;
}
</style>
