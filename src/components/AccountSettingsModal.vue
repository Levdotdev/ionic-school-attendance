<template>
  <app-modal :open="open" title="Account & preferences" :busy="saving" @close="$emit('close')">
    <div v-if="profile" class="settings-content">
      <section>
        <p class="settings-label">Your account</p>
        <h2>{{ profile.full_name }}</h2>
        <p class="account-email">{{ profile.email }}</p>
        <span class="role-badge">{{ profile.role === 'admin' ? 'Administrator' : profile.role }}</span>
      </section>
      <form class="name-form" @submit.prevent="saveName">
        <ion-input v-model="name" label="Full name" label-placement="stacked" fill="outline" autocomplete="name" required :minlength="2" :maxlength="120" />
        <ion-button type="submit" :disabled="saving || name.trim() === profile.full_name || name.trim().length < 2">
          {{ saving ? 'Saving…' : 'Save name' }}
        </ion-button>
      </form>
      <section class="preference-row">
        <div><h3>Appearance</h3><p>Use {{ isDark ? 'a lighter' : 'a darker' }} workspace.</p></div>
        <ion-button fill="outline" @click="toggleTheme">{{ isDark ? 'Light mode' : 'Dark mode' }}</ion-button>
      </section>
      <section v-if="profile.role === 'teacher' || profile.role === 'student'" class="notification-settings">
        <h3>Class reminders</h3>
        <p>{{ profile.role === 'teacher' ? '5 minutes before class and at the start.' : '2 hours, 1 hour, 30 minutes, 15 minutes, 5 minutes before class, and at the start.' }}</p>
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
import { ref, watch } from 'vue'
import AppModal from '@/components/AppModal.vue'
import { useSession } from '@/composables/useSession'
import { useTheme } from '@/composables/useTheme'
import { supabase } from '@/lib/supabase'
import { registerForClassNotifications } from '@/services/notifications'
import { toUserFacingErrorMessage } from '@/utils/errors'

const props = defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()
const { profile, refreshProfile } = useSession()
const { isDark, toggleTheme } = useTheme()
const native = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
const name = ref('')
const saving = ref(false)
const registering = ref(false)
const message = ref('')
const failed = ref(false)
const notificationMessage = ref('')

watch(() => props.open, open => {
  if (open) { name.value = profile.value?.full_name ?? ''; message.value = ''; notificationMessage.value = '' }
})

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
</style>
