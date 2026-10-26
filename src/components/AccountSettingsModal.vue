<template>
  <app-modal :open="open" title="Profile" :busy="saving || pictureBusy" @close="$emit('close')">
    <div v-if="profile" class="settings-content">
      <section>
        <p class="settings-label">Your profile</p>
        <h2>{{ profile.full_name }}</h2>
        <p class="account-email">{{ profile.email }}</p>
        <span class="role-badge">{{ profile.role === 'admin' ? 'Administrator' : profile.role }}</span>
      </section>
      <section class="picture-settings" aria-label="Profile picture">
        <div class="picture-preview" :class="{ 'is-cropping': selectedPicture }">
          <img v-if="picturePreview || avatarUrl" :src="picturePreview || avatarUrl" alt="Profile picture preview" :style="{ transform: picturePreview ? `scale(${pictureZoom})` : undefined }" referrerpolicy="no-referrer" @error="!picturePreview && onAvatarError()" />
          <span v-else>{{ initials }}</span>
        </div>
        <div class="picture-options">
          <h3>Profile picture</h3><p>Choose a JPG, PNG, or WebP picture up to 5 MB. Without an uploaded picture, your linked Google or Facebook photo is used.</p>
          <input ref="pictureInput" class="file-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile picture" @change="choosePicture" />
          <div class="picture-actions"><ion-button size="small" fill="outline" :disabled="pictureBusy" @click="pictureInput?.click()">Choose picture</ion-button><ion-button v-if="nativeCamera" size="small" fill="outline" :disabled="pictureBusy" @click="takePicture">Use camera</ion-button><ion-button v-if="profile.avatar_path && !selectedPicture" size="small" fill="clear" :disabled="pictureBusy" @click="deletePicture">Remove</ion-button></div>
        </div>
        <div v-if="selectedPicture" class="picture-crop"><label for="avatar-zoom">Adjust crop</label><input id="avatar-zoom" v-model.number="pictureZoom" type="range" min="1" max="3" step="0.05" :disabled="pictureBusy" /><div class="picture-actions"><ion-button size="small" :disabled="pictureBusy" @click="savePicture">{{ pictureBusy ? 'Saving…' : 'Save picture' }}</ion-button><ion-button size="small" fill="clear" :disabled="pictureBusy" @click="clearPicture">Cancel</ion-button></div></div>
      </section>
      <form class="name-form" @submit.prevent="saveName">
        <p v-if="profile.name_review_required" class="name-review">Please confirm your first and last name. Your older single-field name was split automatically, so a compound last name may need correction.</p>
        <div class="profile-name-fields"><ion-input v-model="firstName" label="First name" label-placement="stacked" fill="outline" autocomplete="given-name" autocapitalize="characters" required :maxlength="80" /><ion-input v-model="lastName" label="Last name" label-placement="stacked" fill="outline" autocomplete="family-name" autocapitalize="characters" required :maxlength="80" /></div>
        <p class="name-help">Names are saved in uppercase and class lists are sorted by last name.</p>
        <ion-button type="submit" :disabled="saving || !firstName.trim() || !lastName.trim() || (!profile.name_review_required && firstName.trim().toUpperCase() === profile.first_name && lastName.trim().toUpperCase() === profile.last_name)">
          {{ saving ? 'Saving…' : 'Save name' }}
        </ion-button>
      </form>
      <section v-if="profile.role === 'teacher' || profile.role === 'student' || profile.role === 'parent'" class="notification-settings">
        <h3>{{ profile.role === 'parent' ? 'Push notifications' : 'Class reminders' }}</h3>
        <p>{{ profile.role === 'parent' ? 'Receive attendance updates for children whose links you have approved.' : profile.role === 'teacher' ? 'Teacher reminders are sent 5 minutes before class and at the start.' : 'Choose your reminder times on each course’s weekly schedule. Your choices apply to its upcoming meetings.' }}</p>
        <p class="notification-status" :class="{ enabled: remindersEnabled }" role="status">{{ remindersEnabled ? 'Enabled' : 'Disabled' }}</p>
        <p v-if="!native" class="availability-note">{{ profile.role === 'parent' ? 'Attendance push notifications are delivered through the installed Android app. Your child’s attendance remains available here in the browser.' : 'Class push reminders are delivered through the installed Android app. Your weekly schedules are available here in the browser.' }}</p>
      </section>
      <p v-if="message" class="settings-message" :class="{ error: failed }" :role="failed ? 'alert' : 'status'">{{ message }}</p>
    </div>
  </app-modal>
</template>

<script setup lang="ts">
import { IonButton, IonInput } from '@ionic/vue'
import { Capacitor } from '@capacitor/core'
import { onBeforeUnmount, ref, watch } from 'vue'
import { captureSelfie, releaseSelfiePreview } from '@/services/selfie'
import AppModal from '@/components/AppModal.vue'
import { useSession } from '@/composables/useSession'
import { useProfileAvatar } from '@/composables/useProfileAvatar'
import { removeAvatar, uploadAvatar, validateAvatar } from '@/services/account'
import { supabase } from '@/lib/supabase'
import { getDeviceNotificationStatus } from '@/services/notifications'
import { toUserFacingErrorMessage } from '@/utils/errors'

const props = defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()
const { profile, refreshProfile, refreshAuthUser } = useSession()
const { avatarUrl, initials, onAvatarError } = useProfileAvatar()
const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
const nativeCamera = Capacitor.isNativePlatform()
const firstName = ref('')
const lastName = ref('')
const saving = ref(false)
const remindersEnabled = ref(false)
const message = ref('')
const failed = ref(false)
const pictureInput = ref<HTMLInputElement>()
const selectedPicture = ref<Blob | null>(null)
const picturePreview = ref('')
const pictureZoom = ref(1)
const pictureBusy = ref(false)
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
let notificationStatusRequest = 0

watch(message, value => {
  clearTimeout(feedbackTimer)
  if (value && !failed.value) feedbackTimer = setTimeout(() => { message.value = '' }, 6000)
})

watch(() => props.open, open => {
  const request = ++notificationStatusRequest
  remindersEnabled.value = false
  if (open) {
    const legacy = (profile.value?.full_name ?? '').trim().split(/\s+/).filter(Boolean)
    firstName.value = (profile.value?.first_name || legacy.slice(0, -1).join(' ') || (legacy.length === 1 ? legacy[0] : '')).toUpperCase()
    lastName.value = (profile.value?.last_name || (legacy.length > 1 ? legacy.at(-1) : '') || '').toUpperCase()
    message.value = ''; clearPicture(); void refreshAuthUser().catch(() => undefined)
    const owner = profile.value?.id
    if (native) void getDeviceNotificationStatus().then(enabled => { if (request === notificationStatusRequest && props.open && owner === profile.value?.id) remindersEnabled.value = enabled }).catch(() => { if (request === notificationStatusRequest) remindersEnabled.value = false })
  }
  else clearPicture()
})
onBeforeUnmount(() => { notificationStatusRequest++; clearPicture(); clearTimeout(feedbackTimer) })

function clearPicture() {
  if (picturePreview.value) URL.revokeObjectURL(picturePreview.value)
  selectedPicture.value = null; picturePreview.value = ''; pictureZoom.value = 1
  if (pictureInput.value) pictureInput.value.value = ''
}
function setPicture(file: Blob) {
  validateAvatar(file); clearPicture(); selectedPicture.value = file; picturePreview.value = URL.createObjectURL(file)
  message.value = ''; failed.value = false
}
function choosePicture(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  try { setPicture(file) }
  catch (error) { failed.value = true; message.value = toUserFacingErrorMessage(error) }
}
async function takePicture() {
  pictureBusy.value = true
  let photo: Awaited<ReturnType<typeof captureSelfie>> | null = null
  try {
    photo = await captureSelfie()
    if (props.open) setPicture(photo.blob)
  } catch (error) {
    const text = toUserFacingErrorMessage(error)
    if (!/cancel/i.test(text)) { failed.value = true; message.value = text }
  } finally { releaseSelfiePreview(photo); pictureBusy.value = false }
}
async function savePicture() {
  if (!profile.value || !selectedPicture.value || pictureBusy.value) return
  pictureBusy.value = true; message.value = ''
  try {
    await uploadAvatar(profile.value.id, selectedPicture.value, pictureZoom.value, profile.value.avatar_path)
    await refreshProfile({ force: true }); clearPicture(); failed.value = false; message.value = 'Your profile picture has been updated.'
  } catch (error) { failed.value = true; message.value = toUserFacingErrorMessage(error) }
  finally { pictureBusy.value = false }
}
async function deletePicture() {
  if (!profile.value?.avatar_path || pictureBusy.value) return
  pictureBusy.value = true; message.value = ''
  try {
    await removeAvatar(profile.value.id, profile.value.avatar_path); await refreshProfile({ force: true }); failed.value = false; message.value = 'Your uploaded profile picture has been removed.'
  } catch (error) { failed.value = true; message.value = toUserFacingErrorMessage(error) }
  finally { pictureBusy.value = false }
}

async function saveName() {
  const first = firstName.value.trim().replace(/\s+/g, ' ').toUpperCase()
  const last = lastName.value.trim().replace(/\s+/g, ' ').toUpperCase()
  if (!profile.value || !first || !last || first.length > 80 || last.length > 80 || `${first} ${last}`.length > 120) { failed.value = true; message.value = 'Enter your first and last name (up to 120 characters combined).'; return }
  saving.value = true
  message.value = ''
  try {
    const { data, error } = await supabase.from('profiles').update({ first_name: first, last_name: last }).eq('id', profile.value.id).select('id').single()
    if (error) throw error
    if (!data) throw new Error('Your profile could not be updated. Please sign in again.')
    await refreshProfile({ force: true })
    failed.value = false
    message.value = 'Your name has been updated.'
  } catch (error) {
    failed.value = true
    message.value = toUserFacingErrorMessage(error)
  } finally { saving.value = false }
}

</script>

<style scoped>
.profile-name-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.profile-name-fields ion-input { text-transform: uppercase; }
.name-help { font-size: 12px; color: var(--campus-muted); line-height: 1.6; }
.name-review { margin: 0; padding: 12px; border-radius: 10px; color: var(--campus-warning); background: var(--campus-warning-soft); font-size: 12px; line-height: 1.6; }
@media (max-width: 420px) { .profile-name-fields { grid-template-columns: 1fr; } }
.settings-content { display: grid; gap: 26px; padding: 6px 2px; }
.settings-label { margin: 0 0 8px; color: var(--campus-muted); font-size: 11px; text-transform: uppercase; letter-spacing: .1em; }
h2 { font-family: var(--campus-heading-font); font-weight: 500; margin: 0; font-size: 28px; }
h3 { margin: 0 0 6px; font-size: 14px; font-weight: 650; }
p { color: var(--campus-muted); font-size: 13px; line-height: 1.6; }
.account-email { margin: 8px 0; overflow-wrap: anywhere; }
.role-badge { display: inline-block; padding: 5px 9px; background: var(--campus-green-soft); color: var(--campus-green); border-radius: 6px; text-transform: capitalize; font-size: 11px; }
.name-form { display: grid; gap: 12px; }
.name-form ion-button { justify-self: start; margin: 0; }
.preference-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; border-top: 1px solid var(--campus-border); padding-top: 24px; }
.preference-row p { margin: 0; }
.notification-settings { border-top: 1px solid var(--campus-border); padding-top: 24px; }
.notification-status { display:inline-block; margin:0; padding:6px 10px; border:1px solid var(--campus-border); border-radius:8px; font-weight:600; }
.notification-status.enabled { color:var(--campus-green); background:var(--campus-green-soft); }
.availability-note { background: var(--campus-surface-soft); border-radius: 10px; padding: 12px; }
.settings-message { margin: 0; padding: 12px; background: var(--campus-green-soft); color: var(--campus-green); border-radius: 10px; }
.settings-message.error { background: var(--campus-danger-soft); color: var(--campus-danger); }
.picture-settings { display: grid; grid-template-columns: 88px 1fr; gap: 16px; align-items: center; }
.picture-preview { display: grid; place-items: center; width: 88px; height: 88px; overflow: hidden; border: 1px solid var(--campus-border); border-radius: 50%; background: var(--campus-green-soft); color: var(--campus-green); font-size: 26px; font-weight: 650; }
.picture-preview img { width: 100%; height: 100%; object-fit: cover; }
.picture-preview.is-cropping { border-radius: 18px; }
.picture-options { min-width: 0; }
.picture-options p { margin: 0 0 9px; font-size: 12px; }
.picture-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.picture-actions ion-button { margin: 0; text-transform: none; }
.picture-crop { grid-column: 1 / -1; display: grid; gap: 10px; }
.picture-crop label { font-size: 12px; color: var(--campus-muted); }
.picture-crop input { width: 100%; accent-color: var(--campus-green); }
.file-input { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.linked-settings { border-top: 1px solid var(--campus-border); padding-top: 22px; }
.linked-settings p { margin: 10px 0 0; }
.linked-badges { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.linked-badges span { padding: 5px 9px; border-radius: 7px; border: 1px solid var(--campus-border); color: var(--campus-text); font-size: 12px; }
@media (max-width: 420px) { .picture-settings { grid-template-columns: 68px 1fr; gap: 12px; } .picture-preview { width: 68px; height: 68px; } }
</style>
