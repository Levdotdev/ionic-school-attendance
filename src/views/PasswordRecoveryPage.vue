<template>
  <ion-page>
    <ion-content :fullscreen="true" class="recovery-background">
      <main class="recovery-shell">
        <form class="password-card" @submit.prevent="savePassword">
          <img src="/minsu-logo.png" alt="Mindoro State University seal" />
          <p class="eyebrow">Account recovery</p>
          <h1>Choose a new password.</h1>
          <p>Use at least 8 characters. Choose a password you do not use elsewhere.</p>
          <ion-input v-model="password" type="password" label="New password" label-placement="stacked" fill="outline" autocomplete="new-password" :minlength="8" :disabled="busy" required />
          <ion-input v-model="confirmation" type="password" label="Confirm new password" label-placement="stacked" fill="outline" autocomplete="new-password" :minlength="8" :disabled="busy" required />
          <p v-if="message" class="password-message" :class="{ 'is-error': hasError }" :role="hasError ? 'alert' : 'status'">{{ message }}</p>
          <ion-button v-if="!saved" type="submit" expand="block" :disabled="busy"><ion-spinner v-if="busy" name="crescent" /><template v-else>Save new password</template></ion-button>
          <ion-button v-else expand="block" @click="continueToAccount">Continue to my account</ion-button>
          <ion-button fill="clear" :disabled="busy" @click="leave">Return to sign in</ion-button>
        </form>
      </main>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonButton, IonContent, IonInput, IonPage, IonSpinner, onIonViewWillEnter } from '@ionic/vue'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { accountPathForProfile, useSession } from '@/composables/useSession'
import { authActionError, changeAccountPassword } from '@/services/account'
import { toUserFacingErrorMessage } from '@/utils/errors'

const router = useRouter()
const { refreshProfile, signOut, finishPasswordRecovery } = useSession()
const password = ref('')
const confirmation = ref('')
const busy = ref(false)
const message = ref('')
const hasError = ref(false)
const saved = ref(false)
onIonViewWillEnter(() => { password.value = ''; confirmation.value = ''; message.value = ''; hasError.value = false; saved.value = false })

async function savePassword() {
  if (busy.value || saved.value) return
  hasError.value = false
  if (password.value.length < 8 || password.value !== confirmation.value) {
    hasError.value = true
    message.value = password.value.length < 8 ? 'Use at least 8 characters.' : 'The passwords do not match.'
    return
  }
  busy.value = true
  try {
    await changeAccountPassword(password.value)
    password.value = ''
    confirmation.value = ''
    saved.value = true
    finishPasswordRecovery()
    message.value = 'Your password has been updated.'
  } catch (error) { hasError.value = true; message.value = authActionError(error, 'Your reset link may have expired. Request a new link from the sign-in page.') }
  finally { busy.value = false }
}
async function continueToAccount() {
  try { const profile = await refreshProfile(); await router.replace(profile ? accountPathForProfile(profile) : '/account/setup') }
  catch (error) { hasError.value = true; message.value = toUserFacingErrorMessage(error) }
}
async function leave() {
  try { await signOut(); await router.replace('/login') }
  catch (error) { hasError.value = true; message.value = toUserFacingErrorMessage(error) }
}
</script>

<style scoped>
.recovery-background { --background: var(--campus-bg); }
.recovery-shell { min-height: 100%; display: grid; place-items: center; padding: 24px; }
.password-card { width: min(100%, 460px); background: var(--campus-surface); border: 1px solid var(--campus-border); border-radius: 20px; padding: 32px; display: grid; gap: 18px; }
.password-card img { width: 64px; }
.password-card .eyebrow { margin: 0; color: var(--campus-green); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; }
h1 { margin: 0; font: 34px/1.15 Georgia, serif; color: var(--campus-text); }
p { margin: 0; color: var(--campus-muted); line-height: 1.6; font-size: 13px; }
.password-message { color: var(--campus-green); }
.password-message.is-error { color: var(--campus-danger); }
ion-button { text-transform: none; margin: 0; }
</style>
