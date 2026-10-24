<template>
  <app-modal :open="open" title="Invite a parent or guardian" :busy="sending" @close="$emit('close')">
    <form id="invite-parent-form" class="invite-form" @submit.prevent="send">
      <p>Invite a parent to create their own account. Linking to a student is a separate request that the parent must approve.</p>
      <label>Email address<input v-model="email" type="email" autocomplete="email" inputmode="email" :disabled="sending" maxlength="254" required /></label>
      <p v-if="message" :class="{ error: isError }" :role="isError ? 'alert' : 'status'">{{ message }}</p>
    </form>
    <template #actions><ion-button fill="outline" :disabled="sending" @click="$emit('close')">Close</ion-button><ion-button form="invite-parent-form" type="submit" :disabled="sending || sent">{{ sending ? 'Sending…' : sent ? 'Invitation requested' : 'Send invitation' }}</ion-button></template>
  </app-modal>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { IonButton } from '@ionic/vue'
import AppModal from '@/components/AppModal.vue'
import { supabase } from '@/lib/supabase'
import { toUserFacingErrorMessage } from '@/utils/errors'
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; invited: [] }>()
const email = ref(''), message = ref(''), sending = ref(false), sent = ref(false), isError = ref(false)
watch(() => props.open, value => { if (value) { email.value = ''; message.value = ''; sent.value = false; isError.value = false } })
async function send() {
  if (sending.value || sent.value || !email.value.trim()) return
  sending.value = true; message.value = ''; isError.value = false
  try {
    const result = await supabase.functions.invoke('invite-parent', { body: { email: email.value.trim().toLowerCase() } })
    if (result.error) throw result.error
    message.value = result.data?.message || 'If eligible, a parent invitation has been sent. Ask them to check their inbox and spam folder.'
    sent.value = true; emit('invited')
  } catch (error) { isError.value = true; message.value = toUserFacingErrorMessage(error, 'The invitation could not be requested. Please try again later.') }
  finally { sending.value = false }
}
</script>
<style scoped>
.invite-form { display:grid; gap:18px; }.invite-form p { margin:0; color:var(--campus-muted); font-size:14px; line-height:1.6; }.invite-form label { display:grid; gap:8px; color:var(--campus-text); font-size:13px; font-weight:650; }.invite-form input { width:100%; min-height:48px; padding:12px; border:1px solid var(--campus-border); border-radius:10px; color:var(--campus-text); background:var(--campus-surface); font:inherit; }.invite-form p.error { color:var(--campus-danger); }
</style>
