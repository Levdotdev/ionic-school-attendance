<template>
  <ion-page>
    <ion-content :fullscreen="true" class="callback-content">
      <main class="callback-shell">
        <section class="callback-card" aria-live="polite">
          <img src="/minsu-logo.png" alt="Mindoro State University seal" class="callback-logo" />
          <template v-if="processing">
            <ion-spinner name="crescent" />
            <h1>{{ linking ? 'Connecting your sign-in method' : 'Completing sign in' }}</h1>
            <p>Please wait while we securely connect your account.</p>
          </template>
          <template v-else-if="emailConfirmationPending">
            <h1>Confirm your other email address</h1>
            <p>The first confirmation was accepted. Your email has not changed yet. Open the confirmation link sent to your other email address within 30 minutes of the original request.</p>
            <ion-button expand="block" @click="returnToSecurity">Return to your account</ion-button>
          </template>
          <template v-else-if="errorMessage">
            <ion-icon :icon="alertCircleOutline" class="error-icon" />
            <h1>{{ linking ? 'Account was not linked' : 'Sign in was not completed' }}</h1>
            <p role="alert">{{ errorMessage }}</p>
            <ion-button expand="block" @click="linking ? returnToSecurity() : returnToLogin()">{{ linking ? 'Return to security' : 'Return to sign in' }}</ion-button>
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
import { clearIdentityLinkAttempt, clearOAuthAttempt, completeIdentityLink, completeSocialSignIn, pendingIdentityLink } from '@/services/oauth'
import { toUserFacingErrorMessage } from '@/utils/errors'

const router = useRouter()
const { initializeSession, refreshProfile, refreshAuthUser, passwordRecovery, finishPasswordRecovery, signOut } = useSession()
const processing = ref(true)
const errorMessage = ref('')
const emailConfirmationPending = ref(false)
const callbackUrl = new URL(window.location.href)
const isEmailAction = callbackUrl.searchParams.has('token_hash')
const emailActionType = callbackUrl.searchParams.get('type')
const linking = !isEmailAction && Boolean(pendingIdentityLink())

async function returnToSecurity() {
  clearIdentityLinkAttempt()
  const current = await refreshProfile().catch(() => null)
  await router.replace(current ? `${accountPathForProfile(current)}?account=security` : '/login')
}

async function returnToLogin() {
  try {
    await signOut()
    clearOAuthAttempt()
    clearIdentityLinkAttempt()
    await router.replace('/login')
  } catch (error) {
    errorMessage.value = toUserFacingErrorMessage(error, 'Unable to return to sign in. Please try again.')
  }
}

onMounted(async () => {
  try {
    const result = await completeSocialSignIn()
    if ('emailChangeConfirmationPending' in result) {
      clearOAuthAttempt(); clearIdentityLinkAttempt()
      emailConfirmationPending.value = true
      processing.value = false
      return
    }
    await initializeSession()
    clearOAuthAttempt()
    if (isEmailAction && emailActionType !== 'recovery') finishPasswordRecovery?.()
    if (passwordRecovery.value && (!isEmailAction || emailActionType === 'recovery')) {
      clearIdentityLinkAttempt()
      await router.replace('/account/recover')
      return
    }
    if (linking) {
      const destination = await completeIdentityLink()
      await refreshAuthUser()
      await router.replace(destination)
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
