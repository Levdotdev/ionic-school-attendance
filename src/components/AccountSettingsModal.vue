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
        <ion-input v-model="name" label="Full name" label-placement="stacked" fill="outline" autocomplete="name" required :minlength="2" :maxlength="120" />
        <ion-button type="submit" :disabled="saving || name.trim() === profile.full_name || name.trim().length < 2">
          {{ saving ? 'Saving…' : 'Save name' }}
        </ion-button>
      </form>
      <section v-if="profile.role === 'teacher' || profile.role === 'student'" class="notification-settings">
        <h3>Class reminders</h3>
        <p>{{ profile.role === 'teacher' ? 'Teacher reminders are sent 5 minutes before class and at the start.' : 'Choose your reminder times on each course’s weekly schedule. Your choices apply to its upcoming meetings.' }}</p>
        <template v-if="native">
          <ion-button fill="outline" :disabled="registering" @click="enableReminders">{{ registering ? 'Connecting…' : 'Enable notifications on this device' }}</ion-button>
          <p v-if="notificationMessage" role="status">{{ notificationMessage }}</p>
        </template>
        <p v-else class="availability-note">Class push reminders are delivered through the installed Android app. Your weekly schedules are available here in the browser.</p>
      </section>
      <p v-if="message" class="settings-message" :class="{ error: failed }" :role="failed ? 'alert' : 'status'">{{ message }}</p>
    </div>
  </app-modal>
</template>

<script setup lang="ts">
import { IonButton, IonInput } from '@ionic/vue'
import { Capacitor } from '@capacitor/core'
import { onBeforeUnmount, ref, watch } from 'vue'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import AppModal from '@/components/AppModal.vue'
import { useSession } from '@/composables/useSession'
import { useProfileAvatar } from '@/composables/useProfileAvatar'
import { removeAvatar, uploadAvatar, validateAvatar } from '@/services/account'
import { supabase } from '@/lib/supabase'
import { registerForClassNotifications } from '@/services/notifications'
import { toUserFacingErrorMessage } from '@/utils/errors'

const props = defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()
const { profile, refreshProfile, refreshAuthUser } = useSession()
const { avatarUrl, initials, onAvatarError } = useProfileAvatar()
const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
const nativeCamera = Capacitor.isNativePlatform()
const name = ref('')
const saving = ref(false)
const registering = ref(false)
const message = ref('')
const failed = ref(false)
const notificationMessage = ref('')
const pictureInput = ref<HTMLInputElement>()
const selectedPicture = ref<Blob | null>(null)
const picturePreview = ref('')
const pictureZoom = ref(1)
const pictureBusy = ref(false)
let feedbackTimer: ReturnType<typeof setTimeout> | undefined

watch(message, value => {
  clearTimeout(feedbackTimer)
  if (value && !failed.value) feedbackTimer = setTimeout(() => { message.value = '' }, 6000)
})

watch(() => props.open, open => {
  if (open) { name.value = profile.value?.full_name ?? ''; message.value = ''; notificationMessage.value = ''; clearPicture(); void refreshAuthUser().catch(() => undefined) }
  else clearPicture()
})
onBeforeUnmount(() => { clearPicture(); clearTimeout(feedbackTimer) })

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
  try {
    const photo = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.Uri, quality: 85, width: 1600, height: 1600, correctOrientation: true })
    if (!photo.webPath) throw new Error('The camera did not return a picture.')
    const response = await fetch(photo.webPath)
    const blob = await response.blob()
    setPicture(blob.type && blob.type !== 'application/octet-stream' ? blob : new Blob([blob], { type: `image/${photo.format === 'png' ? 'png' : 'jpeg'}` }))
  } catch (error) {
    const text = toUserFacingErrorMessage(error)
    if (!/cancel/i.test(text)) { failed.value = true; message.value = text }
  } finally { pictureBusy.value = false }
}
async function savePicture() {
  if (!profile.value || !selectedPicture.value || pictureBusy.value) return
  pictureBusy.value = true; message.value = ''
  try {
    await uploadAvatar(profile.value.id, selectedPicture.value, pictureZoom.value, profile.value.avatar_path)
    await refreshProfile(); clearPicture(); failed.value = false; message.value = 'Your profile picture has been updated.'
  } catch (error) { failed.value = true; message.value = toUserFacingErrorMessage(error) }
  finally { pictureBusy.value = false }
}
async function deletePicture() {
  if (!profile.value?.avatar_path || pictureBusy.value) return
  pictureBusy.value = true; message.value = ''
  try {
    await removeAvatar(profile.value.id, profile.value.avatar_path); await refreshProfile(); failed.value = false; message.value = 'Your uploaded profile picture has been removed.'
  } catch (error) { failed.value = true; message.value = toUserFacingErrorMessage(error) }
  finally { pictureBusy.value = false }
}

async function saveName() {
  const fullName = name.value.trim()
  if (!profile.value || fullName.length < 2 || fullName.length > 120) return
  saving.value = true
  message.value = ''
  try {
    const { data, error } = await supabase.from('profiles').update({ full_name: fullName }).eq('id', profile.value.id).select('id').single()
    if (error) throw error
    if (!data) throw new Error('Your profile could not be updated. Please sign in again.')
    await refreshProfile()
    failed.value = false
    message.value = 'Your name has been updated.'
  } catch (error) {
    failed.value = true
    message.value = toUserFacingErrorMessage(error)
  } finally { saving.value = false }
}

async function enableReminders() {
  registering.value = true
  notificationMessage.value = ''
  try {
    const result = await registerForClassNotifications()
    notificationMessage.value = result.tokenRegistered
      ? 'Class reminders are enabled on this device.'
      : 'Notifications are disabled. Allow them in your device settings, then try again.'
  } catch (error) { notificationMessage.value = toUserFacingErrorMessage(error) }
  finally { registering.value = false }
}
</script>

<style scoped>
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
