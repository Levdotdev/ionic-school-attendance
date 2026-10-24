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
            <ion-icon :icon="alertCircleOutline" class="error-icon" />
            <h1>Sign in was not completed</h1>
            <p role="alert">{{ errorMessage }}</p>
            <ion-button expand="block" @click="returnToLogin">Return to sign in</ion-button>
          </template>
        </section>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonButton, IonContent, IonIcon, IonPage, IonSpinner } from '@ionic/vue'
import { alertCircleOutline } from 'ionicons/icons'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { accountPathForProfile, useSession } from '@/composables/useSession'
import { clearOAuthAttempt, completeSocialSignIn } from '@/services/oauth'
import { toUserFacingErrorMessage } from '@/utils/errors'

const router = useRouter()
const { initializeSession, refreshProfile, passwordRecovery, signOut } = useSession()
const processing = ref(true)
const errorMessage = ref('')

async function returnToLogin() {
  try {
    await signOut()
    clearOAuthAttempt()
    await router.replace('/login')
  } catch (error) {
    errorMessage.value = toUserFacingErrorMessage(error, 'Unable to return to sign in. Please try again.')
  }
}

onMounted(async () => {
  try {
    await completeSocialSignIn()
    await initializeSession()
    clearOAuthAttempt()
    if (passwordRecovery.value) {
      await router.replace('/account/recover')
      return
    }
    const currentProfile = await refreshProfile()
    if (!currentProfile) throw new Error('Your profile could not be loaded. Return to sign in and try again.')
    await router.replace(accountPathForProfile(currentProfile))
  } catch (error) {
    processing.value = false
    errorMessage.value = toUserFacingErrorMessage(error, 'Sign in could not be completed. Please try again.')
  }
})
</script>

<style scoped>
.callback-content { --background: var(--campus-bg); }
.callback-shell { display: grid; min-height: 100%; padding: 24px; place-items: center; }
.callback-card { width: min(100%, 430px); padding: 40px; border: 1px solid var(--campus-border); border-radius: 20px; background: var(--campus-surface); color: var(--campus-text); text-align: center; }
.callback-logo { width: 72px; height: 72px; margin-bottom: 24px; }
.callback-card ion-spinner { display: block; margin: 0 auto; color: var(--campus-green); }
.callback-card h1 { font: 32px Georgia, serif; margin: 20px 0 12px; }
.callback-card p { color: var(--campus-muted); line-height: 1.6; }
.error-icon { font-size: 32px; color: var(--campus-danger); }
</style>
