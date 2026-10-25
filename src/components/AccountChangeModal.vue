<template>
  <app-modal :open="open" :title="kind === 'email' ? 'Change email address' : 'Change password'" :busy="busy" @close="$emit('close')">
    <form class="account-form" @submit.prevent="save">
      <p v-if="securityLoading" role="status">Checking your account security…</p>
      <password-input v-if="hasPassword" v-model="currentPassword" label="Current password" label-placement="stacked" fill="outline" autocomplete="current-password" :disabled="busy || saved || securityLoading" required />
      <p v-if="kind === 'email' && hasPassword === false" role="status">Set an email sign-in password in Security before changing your email address.</p>
      <template v-if="kind === 'email'">
        <p>Your current email is <strong>{{ user?.email }}</strong>. Confirm the change using the link sent to your new email address. The link expires 30 minutes after the request; your current email stays active until you confirm.</p>
        <p v-if="pendingEmail.status === 'pending'" class="request-state">Pending address: {{ pendingEmail.address }}. Check your new inbox before this request’s 30-minute expiry.</p>
        <p v-else-if="pendingEmail.status === 'expired'" class="request-state expired">Previous email-change link expired. Request a new link.<br>Previous requested address: {{ pendingEmail.address }}. Your current email has not changed.</p>
        <p v-else-if="pendingEmail.status === 'unknown'" class="request-state">Previous requested address: {{ pendingEmail.address }}. Its request time could not be verified. Enter the address below to request a fresh confirmation.</p>
        <ion-input v-model="email" type="email" label="New email address" label-placement="stacked" fill="outline" autocomplete="email" :disabled="busy || saved" required />
      </template>
      <template v-else>
        <p>Use at least 8 characters. A password lets you sign in with email as well as your linked accounts.</p>
        <password-input v-model="password" label="New password" label-placement="stacked" fill="outline" autocomplete="new-password" :minlength="8" :disabled="busy || saved" required />
        <password-input v-model="confirmation" label="Confirm new password" label-placement="stacked" fill="outline" autocomplete="new-password" :minlength="8" :disabled="busy || saved" required />
        <section v-if="needsVerification" class="verification-fields">
          <p>For this change, confirm your identity with the code sent to your account email.</p>
          <ion-button fill="outline" :disabled="busy || codeBusy || codeCooldown > 0" @click="sendCode">{{ codeBusy ? 'Requesting code…' : codeCooldown ? `Request another code in ${codeCooldown}s` : 'Send verification code' }}</ion-button>
          <ion-input v-model="nonce" type="text" inputmode="numeric" label="Verification code" label-placement="stacked" fill="outline" autocomplete="one-time-code" :disabled="busy" required />
        </section>
      </template>
      <p v-if="message" class="account-message" :class="{ error: failed }" :role="failed ? 'alert' : 'status'">{{ message }}</p>
      <div class="form-actions">
        <ion-button fill="outline" :disabled="busy" @click="$emit('close')">{{ saved ? 'Done' : 'Cancel' }}</ion-button>
        <ion-button v-if="!saved" type="submit" :disabled="busy || securityLoading || hasPassword === null || (hasPassword && !currentPassword) || (kind === 'email' && (hasPassword === false || email.trim().toLowerCase() === user?.email?.toLowerCase())) || (kind === 'password' && needsVerification && !nonce.trim())"><ion-spinner v-if="busy" name="crescent" /><template v-else>{{ kind === 'email' ? 'Confirm email change' : 'Save password' }}</template></ion-button>
      </div>
    </form>
  </app-modal>
</template>

<script setup lang="ts">
import { IonButton, IonInput, IonSpinner } from '@ionic/vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import AppModal from '@/components/AppModal.vue'
import PasswordInput from '@/components/PasswordInput.vue'
import { useSession } from '@/composables/useSession'
import { usePendingEmailChange } from '@/composables/usePendingEmailChange'
import { authActionError, changeAccountEmail, changeAccountPassword, readAccountSecurity } from '@/services/account'
import { supabase } from '@/lib/supabase'

const props = defineProps<{ open: boolean; kind: 'email' | 'password' }>()
defineEmits<{ close: [] }>()
const { user, refreshAuthUser, refreshProfile } = useSession()
const pendingEmail = usePendingEmailChange(() => user.value, () => props.open && props.kind === 'email')
const email = ref(''), password = ref(''), confirmation = ref(''), nonce = ref(''), message = ref(''), currentPassword = ref('')
const hasPassword = ref<boolean | null>(null), securityLoading = ref(false)
const busy = ref(false), failed = ref(false), saved = ref(false), needsVerification = ref(false), codeBusy = ref(false), codeCooldown = ref(0)
let cooldown: ReturnType<typeof setInterval> | undefined
let securityRequest = 0
watch(() => [props.open, props.kind] as const, async ([open]) => {
  const request = ++securityRequest
  clearInterval(cooldown)
  codeCooldown.value = 0
  if (!open) { password.value = ''; confirmation.value = ''; nonce.value = ''; currentPassword.value = ''; return }
  email.value = ''; password.value = ''; confirmation.value = ''; nonce.value = ''; message.value = ''; currentPassword.value = ''
  hasPassword.value = null; securityLoading.value = true
  failed.value = false; saved.value = false; needsVerification.value = false
  const actorId = user.value?.id
  try {
    const security = await readAccountSecurity()
    if (request !== securityRequest || actorId !== user.value?.id) return
    hasPassword.value = security.hasPassword
    needsVerification.value = props.kind === 'password' && !security.hasPassword
  } catch (error) { if (request === securityRequest) { failed.value = true; message.value = authActionError(error) } }
  finally { if (request === securityRequest) securityLoading.value = false }
}, { immediate: true })
onBeforeUnmount(() => { securityRequest++; clearInterval(cooldown) })

async function sendCode() {
  if (codeBusy.value || codeCooldown.value) return
  codeBusy.value = true; message.value = ''; failed.value = false
  try {
    const { error } = await supabase.auth.reauthenticate()
    if (error) throw error
    message.value = 'Verification requested. Check your account email for the code.'
    codeCooldown.value = 60
    clearInterval(cooldown)
    cooldown = setInterval(() => { codeCooldown.value--; if (codeCooldown.value <= 0) clearInterval(cooldown) }, 1000)
  } catch (error) { failed.value = true; message.value = authActionError(error) }
  finally { codeBusy.value = false }
}

async function save() {
  if (busy.value || saved.value || securityLoading.value || hasPassword.value === null) return
  failed.value = false; message.value = ''
  if (props.kind === 'password' && password.value !== confirmation.value) { failed.value = true; message.value = 'The passwords do not match.'; return }
  busy.value = true
  try {
    if (props.kind === 'email') {
      await changeAccountEmail(email.value, currentPassword.value, user.value?.id)
      message.value = 'Email change requested. Check your new inbox for the confirmation link within 30 minutes. Your current address remains active until the change is confirmed.'
    } else {
      await changeAccountPassword(password.value, nonce.value, currentPassword.value, user.value?.id)
      message.value = 'Your password has been updated.'
      password.value = ''; confirmation.value = ''; nonce.value = ''
    }
    saved.value = true
    currentPassword.value = ''
    await refreshAuthUser({ force: true }).catch(() => undefined)
    await refreshProfile({ force: true }).catch(() => undefined)
  } catch (error) {
    failed.value = true; message.value = authActionError(error)
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'reauthentication_needed') needsVerification.value = true
  } finally { busy.value = false }
}
</script>

<style scoped>
.account-form, .verification-fields { display: grid; gap: 18px; }
p { margin: 0; color: var(--campus-muted); font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
strong { color: var(--campus-text); font-weight: 600; }
.form-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; padding-top: 4px; }
ion-button { margin: 0; min-height: 42px; text-transform: none; }
.account-message { padding: 12px; border-radius: 10px; color: var(--campus-green); background: var(--campus-green-soft); }
.account-message.error { color: var(--campus-danger); background: var(--campus-danger-soft); }
.verification-fields { border-top: 1px solid var(--campus-border); padding-top: 16px; }
.request-state { padding: 12px; border: 1px solid var(--campus-border); border-radius: 10px; background: var(--campus-surface-soft); }
.request-state.expired { color: var(--campus-warning); }
</style>
