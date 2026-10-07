<template>
  <ion-page class="auth-page">
    <ion-content :fullscreen="true" class="auth-content">
      <main class="auth-shell">
        <section class="auth-story" aria-labelledby="product-name">
          <div class="brand-lockup">
            <div class="brand-mark" aria-hidden="true">
              <ion-icon :icon="schoolOutline" />
            </div>
            <div>
              <strong id="product-name">MinSU Attendance</strong>
              <span>School attendance system</span>
            </div>
          </div>

          <div class="story-copy">
            <p class="eyebrow">Mindoro State University</p>
            <h1>Attendance everyone can trust.</h1>
            <p>
              A secure place for teachers to manage classes, students to check in,
              and families to stay informed.
            </p>
          </div>

          <ul class="trust-list" aria-label="System features">
            <li>
              <span class="trust-icon"><ion-icon :icon="scanOutline" /></span>
              <span><strong>Verified student check-ins</strong><small>School ID barcode and fresh photo evidence</small></span>
            </li>
            <li>
              <span class="trust-icon"><ion-icon :icon="locationOutline" /></span>
              <span><strong>Location-aware attendance</strong><small>On-site submissions checked against the school area</small></span>
            </li>
            <li>
              <span class="trust-icon"><ion-icon :icon="shieldCheckmarkOutline" /></span>
              <span><strong>Role-protected access</strong><small>Private views for students, families, teachers, and admins</small></span>
            </li>
          </ul>

          <p class="story-foot"><span aria-hidden="true"></span> Secure system online</p>
        </section>

        <section class="auth-panel" aria-labelledby="auth-heading">
          <div class="mobile-brand">
            <div class="brand-mark" aria-hidden="true">
              <ion-icon :icon="schoolOutline" />
            </div>
            <div>
              <strong>MinSU Attendance</strong>
              <span>School attendance system</span>
            </div>
          </div>

          <div class="auth-card">
            <div class="auth-heading">
              <p class="eyebrow">Welcome</p>
              <h2 id="auth-heading">{{ mode === 'signin' ? 'Sign in to your account' : 'Create your account' }}</h2>
              <p>
                {{ mode === 'signin'
                  ? 'Use your registered email and password to continue.'
                  : 'Choose your role and enter your information to get started.' }}
              </p>
            </div>

            <ion-segment v-model="mode" :disabled="busy" class="auth-mode" aria-label="Account action">
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
                  class="form-control"
                  label="Full name"
                  label-placement="stacked"
                  fill="outline"
                  autocomplete="name"
                  :disabled="busy"
                  required
                />

                <ion-select
                  v-model="registrationRole"
                  class="form-control"
                  label="Account type"
                  label-placement="stacked"
                  fill="outline"
                  interface="popover"
                  :disabled="busy"
                >
                  <ion-select-option value="student">Student</ion-select-option>
                  <ion-select-option value="teacher">Teacher</ion-select-option>
                  <ion-select-option value="parent">Parent / guardian</ion-select-option>
                </ion-select>

                <p v-if="registrationRole === 'teacher'" class="role-notice">
                  <ion-icon :icon="shieldCheckmarkOutline" aria-hidden="true" />
                  Teacher accounts require administrator approval before class tools become available.
                </p>
              </template>

              <ion-input
                v-model="email"
                class="form-control"
                type="email"
                label="Email address"
                label-placement="stacked"
                fill="outline"
                autocomplete="email"
                :disabled="busy"
                required
              />

              <ion-input
                v-model="password"
                class="form-control"
                type="password"
                label="Password"
                label-placement="stacked"
                fill="outline"
                :autocomplete="mode === 'signin' ? 'current-password' : 'new-password'"
                :disabled="busy"
                required
              />

              <ion-input
                v-if="mode === 'signup'"
                v-model="passwordConfirmation"
                class="form-control"
                type="password"
                label="Confirm password"
                label-placement="stacked"
                fill="outline"
                autocomplete="new-password"
                :disabled="busy"
                required
              />

              <div
                v-if="message"
                class="form-message"
                :class="hasError ? 'is-error' : 'is-success'"
                :role="hasError ? 'alert' : 'status'"
              >
                <ion-icon :icon="hasError ? alertCircleOutline : checkmarkCircleOutline" aria-hidden="true" />
                <span>{{ message }}</span>
              </div>

              <ion-button expand="block" type="submit" :disabled="busy" class="submit-button">
                <ion-spinner v-if="busy" name="crescent" />
                <template v-else>
                  <span>{{ mode === 'signin' ? 'Sign in securely' : 'Create account' }}</span>
                  <ion-icon slot="end" :icon="arrowForwardOutline" aria-hidden="true" />
                </template>
              </ion-button>
            </form>

            <p class="privacy-note">
              <ion-icon :icon="lockClosedOutline" aria-hidden="true" />
              Your attendance information is protected and visible only to authorized users.
            </p>
          </div>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonLabel,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonSpinner,
} from '@ionic/vue'
import {
  alertCircleOutline,
  arrowForwardOutline,
  checkmarkCircleOutline,
  locationOutline,
  lockClosedOutline,
  scanOutline,
  schoolOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons'
import { onMounted, ref } from 'vue'
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
.auth-page {
  --campus-accent-local: var(--campus-accent, #245f86);
  --campus-navy-local: var(--campus-navy, #15364e);
  --campus-bg-local: var(--campus-bg, #eef3f7);
  --campus-surface-local: var(--campus-surface, #ffffff);
  --campus-text-local: var(--campus-text, #182632);
  --campus-muted-local: var(--campus-muted, #62727f);
  --campus-border-local: var(--campus-border, #d9e2e9);
  --campus-success-local: var(--campus-success, #147a50);
  --campus-success-soft-local: var(--campus-success-soft, #e1f4eb);
  --campus-danger-local: var(--campus-danger, #bb3e45);
  --campus-danger-soft-local: var(--campus-danger-soft, #fae9ea);
  color: var(--campus-text-local);
}

.auth-content {
  --background: var(--campus-bg-local);
}

.auth-shell {
  min-height: 100%;
  display: grid;
  grid-template-columns: minmax(340px, 0.88fr) minmax(500px, 1.12fr);
}

.auth-story {
  position: relative;
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  overflow: hidden;
  padding: clamp(32px, 5vw, 68px);
  background: var(--campus-navy-local);
  color: #f4f9fc;
}

.auth-story::before,
.auth-story::after {
  position: absolute;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 50%;
  content: '';
  pointer-events: none;
}

.auth-story::before {
  width: 380px;
  height: 380px;
  right: -210px;
  top: -130px;
}

.auth-story::after {
  width: 520px;
  height: 520px;
  left: -330px;
  bottom: -270px;
}

.brand-lockup,
.mobile-brand {
  display: flex;
  align-items: center;
  gap: 12px;
}

.brand-mark {
  display: grid;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.13);
  color: #ffffff;
}

.brand-mark ion-icon {
  font-size: 23px;
}

.brand-lockup strong,
.brand-lockup span,
.mobile-brand strong,
.mobile-brand span {
  display: block;
}

.brand-lockup strong,
.mobile-brand strong {
  font-size: 16px;
  font-weight: 650;
}

.brand-lockup span,
.mobile-brand span {
  margin-top: 2px;
  font-size: 12px;
  opacity: 0.68;
}

.story-copy {
  position: relative;
  z-index: 1;
  max-width: 560px;
  margin: auto 0 44px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--campus-muted-local);
  font-size: 12px;
  font-weight: 650;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.auth-story .eyebrow {
  color: rgba(244, 249, 252, 0.62);
}

.story-copy h1 {
  max-width: 520px;
  margin: 0;
  font-size: clamp(38px, 5vw, 62px);
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1.03;
}

.story-copy > p:last-child {
  max-width: 510px;
  margin: 22px 0 0;
  color: rgba(244, 249, 252, 0.73);
  font-size: 16px;
  line-height: 1.7;
}

.trust-list {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 10px;
  max-width: 540px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.trust-list li {
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 13px 15px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 15px;
  background: rgba(255, 255, 255, 0.055);
}

.trust-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.1);
}

.trust-list strong,
.trust-list small {
  display: block;
}

.trust-list strong {
  font-size: 13px;
  font-weight: 600;
}

.trust-list small {
  margin-top: 3px;
  color: rgba(244, 249, 252, 0.64);
  font-size: 11px;
  line-height: 1.4;
}

.story-foot {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 28px 0 0;
  color: rgba(244, 249, 252, 0.64);
  font-size: 12px;
}

.story-foot span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #55d99b;
  box-shadow: 0 0 0 4px rgba(85, 217, 155, 0.11);
}

.auth-panel {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: clamp(24px, 6vw, 84px);
}

.mobile-brand {
  display: none;
}

.auth-card {
  width: min(100%, 510px);
  padding: clamp(26px, 4vw, 42px);
  border: 1px solid var(--campus-border-local);
  border-radius: var(--campus-radius, 22px);
  background: var(--campus-surface-local);
  box-shadow: 0 24px 70px rgba(21, 54, 78, 0.1);
}

.auth-heading h2 {
  margin: 0;
  color: var(--campus-text-local);
  font-size: clamp(26px, 3vw, 34px);
  font-weight: 600;
  letter-spacing: -0.035em;
  line-height: 1.12;
}

.auth-heading > p:last-child {
  margin: 12px 0 0;
  color: var(--campus-muted-local);
  font-size: 14px;
  line-height: 1.55;
}

.auth-mode {
  margin: 28px 0 22px;
  padding: 4px;
  border-radius: 13px;
  background: var(--campus-bg-local);
}

.auth-mode ion-segment-button {
  --border-radius: 10px;
  --indicator-color: var(--campus-surface-local);
  --color: var(--campus-muted-local);
  --color-checked: var(--campus-accent-local);
  min-height: 40px;
  font-size: 13px;
  font-weight: 600;
}

.auth-form {
  display: grid;
  gap: 15px;
}

.form-control {
  --border-color: var(--campus-border-local);
  --border-radius: 12px;
  --highlight-color-focused: var(--campus-accent-local);
  --padding-start: 14px;
  --padding-end: 14px;
  color: var(--campus-text-local);
}

.role-notice,
.privacy-note,
.form-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: -3px 0 1px;
  font-size: 12px;
  line-height: 1.5;
}

.role-notice {
  padding: 11px 12px;
  border-radius: 11px;
  background: #fff3d5;
  color: #77500d;
}

.role-notice ion-icon,
.privacy-note ion-icon,
.form-message ion-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  font-size: 16px;
}

.form-message {
  padding: 11px 12px;
  border-radius: 11px;
}

.form-message.is-error {
  background: var(--campus-danger-soft-local);
  color: var(--campus-danger-local);
}

.form-message.is-success {
  background: var(--campus-success-soft-local);
  color: var(--campus-success-local);
}

.submit-button {
  --background: var(--campus-accent-local);
  --background-hover: #1d5276;
  --border-radius: 12px;
  --box-shadow: none;
  min-height: 48px;
  margin: 4px 0 0;
  font-weight: 600;
  text-transform: none;
}

.privacy-note {
  justify-content: center;
  margin: 20px 0 0;
  color: var(--campus-muted-local);
  text-align: center;
}

@media (max-width: 900px) {
  .auth-shell {
    grid-template-columns: 1fr;
  }

  .auth-story {
    display: none;
  }

  .auth-panel {
    align-content: start;
    padding: 28px 20px 48px;
  }

  .mobile-brand {
    display: flex;
    width: min(100%, 510px);
    margin-bottom: 24px;
    color: var(--campus-text-local);
  }

  .mobile-brand .brand-mark {
    background: var(--campus-navy-local);
  }

  .auth-card {
    padding: clamp(24px, 7vw, 38px);
  }
}

@media (max-width: 480px) {
  .auth-panel {
    padding: 20px 14px 36px;
  }

  .auth-card {
    border-radius: 18px;
    box-shadow: 0 15px 45px rgba(21, 54, 78, 0.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
  }
}
</style>
