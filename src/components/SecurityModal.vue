<template>
  <app-modal :open="open && !dialog" title="Security" @close="!dialog && $emit('close')">
    <div class="security-content">
      <p class="security-intro">Manage how you sign in to your MinSU Attendance account.</p>
      <section class="security-setting">
        <div><h3>Linked accounts</h3><p>{{ methods.length ? methods.join(' · ') : 'No methods available' }}</p></div>
        <ion-button fill="outline" size="small" @click="dialog = 'links'">Manage accounts</ion-button>
      </section>
      <section class="security-setting">
        <div><h3>Email address</h3><p>{{ user?.email }}</p><p v-if="pendingEmail.status === 'pending'" class="pending-email">Pending: {{ pendingEmail.address }}. Check your new inbox. The confirmation link expires 30 minutes after the request.</p><template v-else-if="pendingEmail.status === 'expired'"><p class="pending-email">Previous requested address: {{ pendingEmail.address }}</p><p class="expired-email">Previous email-change link expired. Request a new link. Your current email has not changed.</p></template><p v-else-if="pendingEmail.status === 'unknown'" class="pending-email">Previous requested address: {{ pendingEmail.address }}. Its request time could not be verified. Request a new confirmation link.</p></div>
        <ion-button fill="outline" size="small" @click="dialog = 'email'">Change email</ion-button>
      </section>
      <section class="security-setting">
        <div><h3>Password</h3><p>Set or update your email sign-in password.</p></div>
        <ion-button fill="outline" size="small" @click="dialog = 'password'">Change password</ion-button>
      </section>
      <p v-if="returnedProvider && identityFor(returnedProvider)" class="security-feedback" role="status">{{ providerName(returnedProvider) }} is linked to your account.</p>
    </div>
  </app-modal>
  <app-modal :open="open && dialog === 'links' && !confirmProvider" title="Linked accounts" :busy="Boolean(busyProvider)" @close="!confirmProvider && closeChild()">
    <div class="linked-content">
      <p>Connect Google or Facebook to sign in to this same account. Your role, classes, and attendance stay unchanged.</p>
      <p v-if="loading" role="status">Checking your linked accounts…</p>
      <section v-for="provider in socialProviders" :key="provider" class="provider-row">
        <ion-icon :icon="provider === 'google' ? logoGoogle : logoFacebook" aria-hidden="true" />
        <div><h3>{{ providerName(provider) }}</h3><p>{{ identityFor(provider) ? 'Linked' : 'Not linked' }}</p><p v-if="identityFor(provider)?.identity_data?.email" class="identity-email">{{ identityFor(provider)?.identity_data?.email }}</p></div>
        <ion-button v-if="!identityFor(provider)" size="small" fill="outline" :disabled="loading || Boolean(busyProvider)" @click="link(provider)">{{ busyProvider === provider ? 'Connecting…' : 'Link account' }}</ion-button>
        <ion-button v-else size="small" fill="outline" :disabled="loading || Boolean(busyProvider) || identities.length < 2" @click="confirmProvider = provider">Remove</ion-button>
      </section>
      <section v-for="identity in otherIdentities" :key="identity.id" class="other-method"><strong>{{ providerName(identity.provider) }}</strong><span>Linked sign-in method</span></section>
      <p v-if="identities.length < 2" class="last-method">Your only sign-in method cannot be removed. Link another account first.</p>
      <p v-if="message" class="security-feedback" :class="{ error: failed }" :role="failed ? 'alert' : 'status'">{{ message }}</p>
    </div>
    <template #actions><ion-button fill="outline" :disabled="Boolean(busyProvider)" @click="closeChild">Back to security</ion-button></template>
  </app-modal>
  <account-change-modal :open="open && (dialog === 'email' || dialog === 'password')" :kind="dialog === 'email' ? 'email' : 'password'" @close="closeChild" />
  <app-modal :open="Boolean(confirmProvider)" title="Remove sign-in method?" :busy="Boolean(busyProvider)" @close="confirmProvider = null">
    <p class="removal-copy">You will no longer be able to sign in using {{ providerName(confirmProvider || '') }}. Your account and saved records will remain available through your other linked method.</p>
    <template #actions><ion-button fill="outline" :disabled="Boolean(busyProvider)" @click="confirmProvider = null">Cancel</ion-button><ion-button color="danger" :disabled="Boolean(busyProvider)" @click="removeIdentity">{{ busyProvider ? 'Removing…' : 'Remove method' }}</ion-button></template>
  </app-modal>
</template>

<script setup lang="ts">
import { IonButton, IonIcon } from '@ionic/vue'
import { logoFacebook, logoGoogle } from 'ionicons/icons'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { UserIdentity } from '@supabase/supabase-js'
import AppModal from '@/components/AppModal.vue'
import AccountChangeModal from '@/components/AccountChangeModal.vue'
import { useSession } from '@/composables/useSession'
import { usePendingEmailChange } from '@/composables/usePendingEmailChange'
import { authActionError, linkedAuthMethods, unlinkAccountIdentity } from '@/services/account'
import { beginIdentityLink, type SocialProvider } from '@/services/oauth'

const props = defineProps<{ open: boolean; linkedProvider?: string }>()
defineEmits<{ close: [] }>()
const { user, profile, refreshAuthUser } = useSession()
const pendingEmail = usePendingEmailChange(() => user.value, () => props.open)
const dialog = ref<'links' | 'email' | 'password' | null>(null)
const identities = computed(() => user.value?.identities ?? [])
const methods = computed(() => linkedAuthMethods(user.value))
const socialProviders: SocialProvider[] = ['google', 'facebook']
const otherIdentities = computed(() => identities.value.filter(identity => !socialProviders.includes(identity.provider as SocialProvider)))
const loading = ref(false), busyProvider = ref<SocialProvider | null>(null), confirmProvider = ref<SocialProvider | null>(null)
const message = ref(''), failed = ref(false), returnedProvider = ref('')
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
let request = 0
const providerName = (provider: string) => ({ google: 'Google', facebook: 'Facebook', email: 'Email', phone: 'Phone' }[provider] ?? provider)
const identityFor = (provider: string): Readonly<UserIdentity> | undefined => identities.value.find(identity => identity.provider === provider)

watch(() => props.open, async open => {
  request++
  clearTimeout(feedbackTimer)
  if (!open) { dialog.value = null; confirmProvider.value = null; returnedProvider.value = ''; return }
  dialog.value = null; message.value = ''; failed.value = false
  returnedProvider.value = socialProviders.includes(props.linkedProvider as SocialProvider) ? props.linkedProvider! : ''
  if (returnedProvider.value) feedbackTimer = setTimeout(() => { returnedProvider.value = '' }, 6000)
  loading.value = true
  const attempt = request
  try { await refreshAuthUser() }
  catch (error) { if (attempt === request) { message.value = authActionError(error); failed.value = true; dialog.value = 'links' } }
  finally { if (attempt === request) loading.value = false }
}, { immediate: true })
onBeforeUnmount(() => { request++; clearTimeout(feedbackTimer) })

function closeChild() { if (!busyProvider.value) { dialog.value = null; message.value = ''; confirmProvider.value = null } }
async function link(provider: SocialProvider) {
  if (!user.value || !profile.value || busyProvider.value || loading.value) return
  busyProvider.value = provider; message.value = ''; failed.value = false
  try {
    await beginIdentityLink(provider, user.value.id, `/${profile.value.role}`)
    message.value = 'Complete the connection in the provider window. Return here after authorization.'
  } catch (error) { failed.value = true; message.value = authActionError(error) }
  finally { busyProvider.value = null }
}
async function removeIdentity() {
  const provider = confirmProvider.value
  if (!provider || !user.value || busyProvider.value) return
  busyProvider.value = provider; message.value = ''; failed.value = false
  try {
    await unlinkAccountIdentity(provider, user.value.id)
    await refreshAuthUser({ force: true })
    confirmProvider.value = null
    message.value = `${providerName(provider)} was removed from your sign-in methods.`
    feedbackTimer = setTimeout(() => { if (!failed.value) message.value = '' }, 6000)
  } catch (error) { confirmProvider.value = null; failed.value = true; message.value = authActionError(error) }
  finally { busyProvider.value = null }
}
</script>

<style scoped>
.security-content, .linked-content { display: grid; gap: 18px; }
p { margin: 0; color: var(--campus-muted); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
h3 { margin: 0 0 6px; color: var(--campus-text); font-size: 14px; font-weight: 650; }
.security-setting { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-top: 18px; border-top: 1px solid var(--campus-border); }
.security-setting > div, .provider-row > div { min-width: 0; flex: 1; }
ion-button { margin: 0; flex-shrink: 0; text-transform: none; min-height: 38px; }
.provider-row { display: flex; align-items: center; gap: 12px; padding: 16px 0; border-top: 1px solid var(--campus-border); }
.provider-row > ion-icon { width: 24px; height: 24px; color: var(--campus-text); flex-shrink: 0; }
.provider-row p, .other-method { font-size: 12px; }
.identity-email { margin-top: 3px; }
.other-method { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 13px 0; border-top: 1px solid var(--campus-border); color: var(--campus-muted); }
.other-method strong { color: var(--campus-text); font-weight: 600; }
.last-method { padding: 12px; background: var(--campus-surface-soft); border-radius: 9px; }
.security-feedback { padding: 12px; border-radius: 9px; color: var(--campus-green); background: var(--campus-green-soft); }
.security-feedback.error { color: var(--campus-danger); background: var(--campus-danger-soft); }
.pending-email { margin-top: 5px; color: var(--campus-muted); }
.expired-email { margin-top: 6px; color: var(--campus-warning); }
.removal-copy { max-width: 55ch; }
@media (max-width: 480px) { .security-setting { align-items: start; flex-direction: column; gap: 10px; } .provider-row { gap: 9px; } .provider-row > ion-icon { width: 20px; height: 20px; } }
</style>
