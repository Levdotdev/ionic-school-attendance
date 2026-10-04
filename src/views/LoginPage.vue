<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>School Attendance</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-card class="login-card">
        <ion-card-header>
          <ion-card-title>{{ mode === 'signin' ? 'Sign in' : 'Create account' }}</ion-card-title>
          <ion-card-subtitle>
            Students, parents, and teachers may register. Teacher accounts need administrator approval.
          </ion-card-subtitle>
        </ion-card-header>

        <ion-card-content>
          <ion-segment v-model="mode" :disabled="busy">
            <ion-segment-button value="signin">
              <ion-label>Sign in</ion-label>
            </ion-segment-button>
            <ion-segment-button value="signup">
              <ion-label>Register</ion-label>
            </ion-segment-button>
          </ion-segment>

          <form class="auth-form" @submit.prevent="submit">
            <template v-if="mode === 'signup'">
              <ion-input
                v-model="fullName"
                label="Full name"
                label-placement="stacked"
                autocomplete="name"
                :disabled="busy"
                required
              />

              <ion-select
                v-model="registrationRole"
                label="Account type"
                label-placement="stacked"
                interface="popover"
                :disabled="busy"
              >
                <ion-select-option value="student">Student</ion-select-option>
                <ion-select-option value="teacher">Teacher</ion-select-option>
                <ion-select-option value="parent">Parent / guardian</ion-select-option>
              </ion-select>
            </template>

            <ion-input
              v-model="email"
              type="email"
              label="Email"
              label-placement="stacked"
              autocomplete="email"
              :disabled="busy"
              required
            />

            <ion-input
              v-model="password"
              type="password"
              label="Password"
              label-placement="stacked"
              :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
              :disabled="busy"
              required
            />

            <ion-input
              v-if="mode === 'signup'"
              v-model="passwordConfirmation"
              type="password"
              label="Confirm password"
              label-placement="stacked"
              autocomplete="new-password"
              :disabled="busy"
              required
            />

            <ion-note v-if="message" :color="messageColor" role="status">{{ message }}</ion-note>

            <ion-button expand="block" type="submit" :disabled="busy">
              <ion-spinner v-if="busy" name="crescent" />
              <span v-else>{{ mode === 'signin' ? 'Sign in' : 'Create account' }}</span>
            </ion-button>
          </form>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardSubtitle,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonLabel,
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { homePathForRole, useSession, type AppRole } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'

type AuthMode = 'signin' | 'signup'
type RegistrationRole = Extract<AppRole, 'student' | 'teacher' | 'parent'>

const router = useRouter()
const { initializeSession, refreshProfile, profile } = useSession()

const mode = ref<AuthMode>('signin')
const registrationRole = ref<RegistrationRole>('student')
const fullName = ref('')
const email = ref('')
const password = ref('')
const passwordConfirmation = ref('')
const busy = ref(false)
const message = ref('')
const hasError = ref(false)

const messageColor = computed(() => (hasError.value ? 'danger' : 'success'))

function validate(): string | null {
  if (!email.value.trim() || !email.value.includes('@')) return 'Enter a valid email address.'
  if (password.value.length < 8) return 'Password must contain at least 8 characters.'

  if (mode.value === 'signup') {
    if (fullName.value.trim().length < 2) return 'Enter your full name.'
    if (password.value !== passwordConfirmation.value) return 'The passwords do not match.'
  }

  return null
}

async function redirectSignedInUser() {
  const currentProfile = await refreshProfile()
  if (!currentProfile) {
    throw new Error('Your account profile is not ready. Please sign in again in a moment.')
  }
  await router.replace(homePathForRole(currentProfile.role))
}

async function submit() {
  const validationMessage = validate()
  if (validationMessage) {
    hasError.value = true
    message.value = validationMessage
    return
  }

  busy.value = true
  hasError.value = false
  message.value = ''

  try {
    if (mode.value === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.value.trim().toLowerCase(),
        password: password.value,
      })
      if (error) throw error

      await redirectSignedInUser()
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email: email.value.trim().toLowerCase(),
      password: password.value,
      options: {
        data: {
          full_name: fullName.value.trim(),
          role: registrationRole.value,
        },
      },
    })
    if (error) throw error

    if (data.session) {
      await redirectSignedInUser()
      return
    }

    message.value = registrationRole.value === 'teacher'
      ? 'Teacher account created. Confirm your email, then sign in to check the administrator approval status.'
      : 'Account created. Check your email to confirm it, then return here to sign in.'
    password.value = ''
    passwordConfirmation.value = ''
  } catch (error) {
    hasError.value = true
    message.value = error instanceof Error ? error.message : 'Authentication failed. Please try again.'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await initializeSession()
  if (profile.value) await router.replace(homePathForRole(profile.value.role))
})
</script>

<style scoped>
.login-card {
  max-width: 520px;
  margin: 2rem auto;
}

.auth-form {
  display: grid;
  gap: 1rem;
  margin-top: 1rem;
}
</style>
