<template>
  <ion-modal :is-open="open" :can-dismiss="!saving" class="face-enrollment-modal" @did-dismiss="closeModal">
    <ion-header>
      <ion-toolbar>
        <ion-title>Set up face verification</ion-title>
        <ion-buttons slot="end">
          <ion-button :disabled="saving" @click="closeModal">Later</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="enrollment-shell">
        <img class="enrollment-logo" src="/minsu-logo.png" alt="Mindoro State University seal" />
        <p class="eyebrow">Student identity</p>
        <h2>{{ samples.length ? prompts[samples.length] ?? 'Review enrollment' : 'Register your face once' }}</h2>
        <p class="intro">
          Take three new photos in good light. A numerical face template is saved privately and used to compare future
          self-check selfies. The photos used here are not uploaded.
        </p>

        <div class="sample-grid" aria-label="Face enrollment progress">
          <div v-for="index in 3" :key="index" class="sample" :class="{ complete: samples.length >= index }">
            <img v-if="previews[index - 1]" :src="previews[index - 1]" alt="Captured face enrollment sample" />
            <span v-else>{{ index }}</span>
            <small>{{ labels[index - 1] }}</small>
          </div>
        </div>

        <div v-if="message" class="face-message" role="alert">{{ message }}</div>

        <ion-button
          v-if="samples.length < 3"
          expand="block"
          size="large"
          :disabled="capturing || saving"
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
          :disabled="!consented || saving"
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
    </ion-content>
  </ion-modal>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonButtons,
  IonCheckbox,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { cameraOutline, shieldCheckmarkOutline } from 'ionicons/icons'
import { onBeforeUnmount, ref } from 'vue'

import { supabase } from '@/lib/supabase'
import { analyzeFace, FACE_MODEL_VERSION, validateEnrollmentSamples, type FaceAnalysis } from '@/services/faceRecognition'
import { captureSelfie, releaseSelfiePreview, type CapturedSelfie } from '@/services/selfie'
import { toUserFacingErrorMessage } from '@/utils/errors'

defineProps<{ open: boolean }>()

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

async function captureSample() {
  capturing.value = true
  message.value = ''
  try {
    const photo = await captureSelfie()
    const analysis = await analyzeFace(photo.blob)
    captured.value.push(photo)
    previews.value.push(photo.previewUrl)
    samples.value.push(analysis)
  } catch (error) {
    message.value = toUserFacingErrorMessage(error, 'The face photo could not be processed.')
  } finally {
    capturing.value = false
  }
}

async function saveEnrollment() {
  if (!consented.value || samples.value.length !== 3) return
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
  if (saving.value) return
  reset()
  emit('close')
}

onBeforeUnmount(reset)
</script>

<style scoped>
.face-enrollment-modal {
  --height: min(760px, 94vh);
  --max-width: 560px;
  --width: min(560px, 96vw);
  --border-radius: 22px;
}

.enrollment-shell {
  width: min(100%, 500px);
  margin: 0 auto;
  padding: 28px 22px calc(30px + env(safe-area-inset-bottom));
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
