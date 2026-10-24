<template>
  <ion-page>
    <ion-content :fullscreen="true" class="setup-background">
      <main class="setup-waiting"><img src="/minsu-logo.png" alt="Mindoro State University" /></main>
      <ion-modal class="account-setup-modal" :is-open="open" :backdrop-dismiss="false" :can-dismiss="canDismiss">
        <section class="setup-dialog-shell">
        <ion-header class="ion-no-border"><ion-toolbar><ion-title>Complete your account</ion-title><ion-buttons slot="end"><ion-button :disabled="busy" @click="leave">Sign out</ion-button></ion-buttons></ion-toolbar></ion-header>
        <div class="setup-content">
          <form class="setup-form" @submit.prevent="submit">
            <img src="/minsu-logo.png" alt="" class="setup-logo" />
            <p class="setup-eyebrow">One account, your campus</p>
            <h1>Make yourself at home.</h1>
            <p class="setup-description">Choose how you use MinSU Attendance. This works the same whether you signed in with email, Google, or Facebook.</p>
            <p class="signed-in-email">{{ profile?.email || user?.email }}</p>
            <ion-input v-model="fullName" label="Full name" label-placement="stacked" fill="outline" autocomplete="name" :maxlength="120" :disabled="busy" required />
            <fieldset class="role-picker" :disabled="busy">
              <legend>I am a</legend>
              <label v-for="option in availableRoles" :key="option.value" class="role-option" :class="{ selected: role === option.value }">
                <input v-model="role" type="radio" name="account-role" :value="option.value" required />
                <ion-icon :icon="option.icon" aria-hidden="true" />
                <span><strong>{{ option.title }}</strong><small>{{ option.description }}</small></span>
                <ion-icon v-if="role === option.value" :icon="checkmarkCircleOutline" class="selected-icon" aria-hidden="true" />
              </label>
            </fieldset>
            <p v-if="invitedParent" class="setup-note">This invitation is for a parent / guardian account. Student links will still require your explicit approval.</p>
            <p v-if="role === 'teacher'" class="approval-note"><ion-icon :icon="shieldCheckmarkOutline" />Your teacher account goes to the administrator for approval before class tools are enabled.</p>
            <p v-else-if="role === 'student'" class="setup-note">Next, scan your school ID and enroll your face in your student profile.</p>
            <p v-else-if="role === 'parent'" class="setup-note">Review and approve your child’s link request after setup. Your attendance access begins only after you approve.</p>
            <p v-if="errorMessage" class="setup-error" role="alert">{{ errorMessage }}</p>
            <ion-button type="submit" expand="block" :disabled="busy || !role || !invitationChecked"><ion-spinner v-if="busy" name="crescent" /><template v-else>Continue<ion-icon slot="end" :icon="arrowForwardOutline" /></template></ion-button>
            <p class="setup-note">Your role is saved securely. Contact the administrator if you later need it changed.</p>
          </form>
        </div>
        </section>
      </ion-modal>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonModal, IonPage, IonSpinner, IonTitle, IonToolbar, onIonViewWillEnter } from '@ionic/vue'
import { arrowForwardOutline, bookOutline, checkmarkCircleOutline, peopleOutline, schoolOutline, shieldCheckmarkOutline } from 'ionicons/icons'
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { accountPathForProfile, useSession } from '@/composables/useSession'
import { supabase } from '@/lib/supabase'
import { toUserFacingErrorMessage } from '@/utils/errors'

type RegistrationRole = 'student' | 'teacher' | 'parent'
const router = useRouter()
const { profile, user, initializeSession, refreshProfile, signOut } = useSession()
const open = ref(true)
const busy = ref(false)
const fullName = ref('')
const role = ref<RegistrationRole | ''>('')
const errorMessage = ref('')
const invitedParent = ref(false)
const invitationChecked = ref(false)
let unmounting = false
const canDismiss = () => unmounting || !open.value || (!busy.value && (!user.value || Boolean(profile.value?.onboarding_completed_at)))
onBeforeUnmount(() => { unmounting = true })
const roleOptions = [
  { value: 'student', title: 'Student', description: 'Check in, view classes, and plan tasks.', icon: bookOutline },
  { value: 'teacher', title: 'Teacher', description: 'Manage classes, schedules, and attendance.', icon: schoolOutline },
  { value: 'parent', title: 'Parent / guardian', description: 'Stay informed about your child’s attendance.', icon: peopleOutline },
] as const
const availableRoles = computed(() => invitedParent.value ? roleOptions.filter(option => option.value === 'parent') : roleOptions)

async function leave() {
  if (busy.value) return
  busy.value = true
  try {
    await signOut()
    open.value = false
    await router.replace('/login')
  } catch (error) { errorMessage.value = toUserFacingErrorMessage(error) }
  finally { busy.value = false }
}

async function submit() {
  if (busy.value) return
  if (!invitationChecked.value) { errorMessage.value = 'Wait while your invitation is checked.'; return }
  if (invitedParent.value && role.value !== 'parent') { errorMessage.value = 'This invitation requires a parent / guardian account.'; return }
  if (fullName.value.trim().length < 2) { errorMessage.value = 'Enter your full name (at least 2 characters).'; return }
  if (!role.value) { errorMessage.value = 'Choose how you will use your account.'; return }
  busy.value = true
  errorMessage.value = ''
  try {
    const { error } = await supabase.rpc('complete_account_setup', { p_full_name: fullName.value.trim(), p_role: role.value })
    if (error) throw error
    const currentProfile = await refreshProfile()
    if (!currentProfile?.onboarding_completed_at) throw new Error('Your account was not saved. Please try again.')
    open.value = false
    await router.replace(accountPathForProfile(currentProfile))
  } catch (error) {
    const message = toUserFacingErrorMessage(error)
    errorMessage.value = message.includes('complete_account_setup') || message.includes('onboarding_completed_at')
      ? 'Account setup is being updated. Please try again in a moment.' : message
  } finally { busy.value = false }
}

onIonViewWillEnter(async () => {
  open.value = true
  role.value = ''
  invitationChecked.value = false
  invitedParent.value = false
  errorMessage.value = ''
  try {
    await initializeSession()
    const currentProfile = await refreshProfile()
    if (currentProfile?.onboarding_completed_at) { open.value = false; await router.replace(accountPathForProfile(currentProfile)); return }
    if (!currentProfile) { errorMessage.value = 'Your account profile could not be loaded. Sign out and try again.'; return }
    const invitation = await supabase.rpc('my_parent_invitation')
    if (invitation.error) throw invitation.error
    invitedParent.value = invitation.data === true
    if (invitedParent.value) role.value = 'parent'
    invitationChecked.value = true
    const suggestedName = user.value?.user_metadata?.full_name ?? user.value?.user_metadata?.name
    fullName.value = typeof suggestedName === 'string' ? suggestedName : ''
  } catch (error) { errorMessage.value = toUserFacingErrorMessage(error) }
})
</script>

<style scoped>
.setup-background { --background: var(--campus-bg); }
.setup-waiting { min-height: 100%; display: grid; place-items: center; }
.setup-waiting img { width: 90px; opacity: .25; }
.account-setup-modal { --width: min(560px, calc(100% - 24px)); --height: auto; --max-height: calc(100dvh - 32px - env(safe-area-inset-top) - env(safe-area-inset-bottom)); --border-radius: 22px; }
.setup-dialog-shell { display: flex; flex-direction: column; overflow: hidden; max-height: var(--max-height); background: var(--campus-surface); color: var(--campus-text); }
.setup-dialog-shell > ion-header { flex: 0 0 auto; }
.setup-dialog-shell ion-toolbar { --background: var(--campus-surface); --color: var(--campus-text); }
.setup-content { background: var(--campus-surface); min-height: 0; overflow: auto; overscroll-behavior: contain; }
.setup-form { padding: 24px 30px 30px; display: grid; gap: 18px; color: var(--campus-text); }
.setup-logo { width: 58px; height: 58px; }
.setup-eyebrow { color: var(--campus-green); margin: 0; text-transform: uppercase; letter-spacing: .13em; font-size: 11px; font-weight: 700; }
h1 { font: 34px/1.1 Georgia, serif; letter-spacing: -.02em; margin: -6px 0 0; }
.setup-description { color: var(--campus-muted); line-height: 1.65; margin: -3px 0 0; font-size: 14px; }
.signed-in-email { font-size: 12px; margin: -8px 0 0; color: var(--campus-green); overflow-wrap: anywhere; }
.role-picker { display: grid; gap: 10px; border: 0; padding: 0; margin: 0; min-width: 0; }
.role-picker legend { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
.role-option { display: flex; align-items: center; gap: 12px; border: 1px solid var(--campus-border); border-radius: 12px; padding: 14px; cursor: pointer; }
.role-option.selected { border-color: var(--campus-green); background: var(--campus-green-soft); }
.role-option input { width: 16px; height: 16px; accent-color: var(--campus-green); }
.role-option > ion-icon { font-size: 22px; color: var(--campus-green); flex: 0 0 auto; }
.role-option span { flex: 1; }
.role-option strong, .role-option small { display: block; }
.role-option strong { font-size: 14px; font-weight: 650; }
.role-option small { font-size: 11px; color: var(--campus-muted); line-height: 1.5; margin-top: 3px; }
.approval-note { display: flex; gap: 10px; border-radius: 10px; padding: 12px; background: var(--campus-gold-soft); color: var(--campus-warning); font-size: 12px; line-height: 1.6; margin: 0; }
.approval-note ion-icon { font-size: 19px; flex: 0 0 auto; }
.setup-note { font-size: 12px; color: var(--campus-muted); line-height: 1.6; margin: 0; }
.setup-error { font-size: 13px; color: var(--campus-danger); background: var(--campus-danger-soft); border-radius: 10px; padding: 12px; line-height: 1.5; margin: 0; }
ion-button[type=submit] { margin: 0; min-height: 46px; --border-radius: 12px; text-transform: none; }
ion-input { --border-color: var(--campus-border); --border-radius: 12px; }
@media (max-width: 575px) { .account-setup-modal { --width: calc(100% - 20px); --border-radius: 18px; } .setup-form { padding: 20px; } }
</style>
