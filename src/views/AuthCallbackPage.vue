<template>
  <ion-page>
    <ion-content :fullscreen="true" class="callback-content">
      <main class="callback-shell">
        <section class="callback-card" aria-live="polite">
          <img src="/minsu-logo.png" alt="Mindoro State University seal" class="callback-logo" />

          <template v-if="processing">
            <ion-spinner name="crescent" />
            <h1>Completing sign in</h1>
            <p>Please wait while we securely connect your account.</p>
          </template>

          <template v-else-if="errorMessage">
            <span class="status-icon is-error" aria-hidden="true">
              <ion-icon :icon="alertCircleOutline" />
            </span>
            <h1>Sign in was not completed</h1>
            <p>{{ errorMessage }}</p>
            <ion-button expand="block" @click="returnToLogin">Return to sign in</ion-button>
          </template>
        </section>
      </main>

      <ion-modal :is-open="showOnboarding" :backdrop-dismiss="false">
        <ion-header>
          <ion-toolbar>
            <ion-title>Welcome to MinSU Attendance</ion-title>
          </ion-toolbar>
        </ion-header>

        <ion-content class="onboarding-content ion-padding">
          <div class="onboarding-body">
            <img src="/minsu-logo.png" alt="" class="onboarding-logo" aria-hidden="true" />
            <p class="eyebrow">Student account created</p>
            <h2>Your social sign-in is ready.</h2>
            <p>
              New Google and Facebook accounts begin as student accounts. Continue to complete your
              student information and attendance verification setup.
            </p>

            <div class="role-note">
              <ion-icon :icon="informationCircleOutline" aria-hidden="true" />
              <span>
                Teachers and parents should use email registration for now so the correct protected
                role and approval process can be applied.
              </span>
            </div>

            <ion-button expand="block" @click="continueToAccount">
              Continue as student
              <ion-icon slot="end" :icon="arrowForwardOutline" aria-hidden="true" />
            </ion-button>
          </div>
        </ion-content>
      </ion-modal>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonPage,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'
import {
  alertCircleOutline,
  arrowForwardOutline,
  informationCircleOutline,
} from 'ionicons/icons'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { homePathForRole, type AppRole } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import {
  clearOAuthAttempt,
  completeSocialSignIn,
  isRecentlyCreatedSocialAccount,
} from '@/services/oauth'

const router = useRouter()
const processing = ref(true)
const errorMessage = ref('')
const showOnboarding = ref(false)
const destination = ref('/student')

function isAppRole(value: unknown): value is AppRole {
  return value === 'admin' || value === 'teacher' || value === 'student' || value === 'parent'
}

async function continueToAccount() {
  showOnboarding.value = false
  clearOAuthAttempt()
  await router.replace(destination.value)
}

async function returnToLogin() {
  clearOAuthAttempt()
  await router.replace('/login')
}

onMounted(async () => {
  try {
    const session = await completeSocialSignIn()
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', session.user.id)
      .maybeSingle()

    if (error) throw error
    if (!profile || !isAppRole(profile.role)) {
      throw new Error('Your account profile is not ready yet. Please return to sign in and try again.')
    }

    destination.value = homePathForRole(profile.role)
    processing.value = false

    if (profile.role === 'student' && isRecentlyCreatedSocialAccount(session)) {
      showOnboarding.value = true
      return
    }

    clearOAuthAttempt()
    await router.replace(destination.value)
  } catch (error) {
    processing.value = false
    errorMessage.value = error instanceof Error
      ? error.message
      : 'The social sign-in could not be completed. Please try again.'
  }
})
</script>

<style scoped>
.callback-content {
  --background: var(--campus-bg);
}

.callback-shell {
  display: grid;
  min-height: 100%;
  padding: 24px;
  place-items: center;
}

.callback-card {
  width: min(100%, 430px);
  padding: clamp(30px, 7vw, 48px);
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius);
  background: var(--campus-surface);
  box-shadow: var(--campus-shadow);
  color: var(--campus-text);
  text-align: center;
}

.callback-logo,
.onboarding-logo {
  display: block;
  width: 82px;
  height: 82px;
  margin: 0 auto 24px;
  border-radius: 50%;
  object-fit: contain;
}

.callback-card ion-spinner {
  width: 34px;
  height: 34px;
  color: var(--campus-green);
}

.callback-card h1,
.onboarding-body h2 {
  margin: 18px 0 0;
  color: var(--campus-text);
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.03em;
}

.callback-card p,
.onboarding-body > p {
  margin: 12px 0 24px;
  color: var(--campus-muted);
  line-height: 1.6;
}

.status-icon {
  display: grid;
  width: 46px;
  height: 46px;
  margin: 0 auto;
  place-items: center;
  border-radius: 50%;
  font-size: 25px;
}

.status-icon.is-error {
  background: var(--campus-danger-soft);
  color: var(--campus-danger);
}

.onboarding-content {
  --background: var(--campus-bg);
}

.onboarding-body {
  width: min(100%, 520px);
  margin: 42px auto;
  padding: clamp(26px, 6vw, 42px);
  border: 1px solid var(--campus-border);
  border-radius: var(--campus-radius);
  background: var(--campus-surface);
  box-shadow: var(--campus-shadow);
  text-align: center;
}

.onboarding-logo {
  width: 94px;
  height: 94px;
  margin-bottom: 20px;
}

.eyebrow {
  margin: 0 !important;
  color: var(--campus-green) !important;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.onboarding-body h2 {
  margin-top: 8px;
}

.role-note {
  display: flex;
  gap: 10px;
  margin: 24px 0;
  padding: 14px;
  border: 1px solid color-mix(in srgb, var(--campus-gold) 48%, transparent);
  border-radius: 12px;
  background: var(--campus-gold-soft);
  color: var(--campus-text);
  font-size: 13px;
  line-height: 1.55;
  text-align: left;
}

.role-note ion-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--campus-warning);
  font-size: 18px;
}

ion-button {
  --background: var(--campus-green);
  --background-hover: var(--campus-navy);
  --border-radius: 12px;
  --box-shadow: none;
  min-height: 48px;
  font-weight: 650;
  text-transform: none;
}
</style>
