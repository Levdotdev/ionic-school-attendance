<template>
  <app-modal :open="Boolean(record)" title="Attendance evidence" :busy="busy" wide @close="$emit('close')">
    <template v-if="record">
      <div class="evidence-heading"><div><p>{{ record.class_name || 'Self-check attendance' }}</p><h2>{{ studentName }}</h2><span>{{ record.meeting_title }}</span></div><ion-badge :color="record.attendance_enabled === false ? 'medium' : record.verification_status === 'rejected' || record.status === 'absent' ? 'danger' : 'success'">{{ record.attendance_enabled === false ? 'Meeting not counted' : record.verification_status === 'rejected' ? 'Voided by teacher' : record.status === 'present' ? 'Present' : 'Absent' }}</ion-badge></div>
      <div v-if="loadingPhoto" class="photo-state" role="status"><ion-spinner /><span>Loading protected photo…</span></div>
      <img v-else-if="photoUrl && !photoFailed" :src="photoUrl" :alt="`${studentName}'s attendance photo`" class="evidence-photo" @error="photoFailed = true" />
      <div v-else class="photo-state"><ion-icon :icon="imageOutline" /><span>{{ record.selfie_path ? 'Photo unavailable. Close and reopen to try again.' : 'No photo was required for this attendance record.' }}</span></div>
      <p v-if="photoError" class="evidence-error" role="alert">{{ photoError }}</p>
      <dl class="evidence-facts">
        <div><dt>Submitted at</dt><dd>{{ formatDate(record.submitted_at || record.created_at) }}</dd></div>
        <div><dt>Meeting time</dt><dd>{{ formatDate(record.meeting_starts_at) }}</dd></div>
        <div><dt>Location</dt><dd v-if="record.latitude != null && record.longitude != null"><a :href="`https://www.google.com/maps?q=${record.latitude},${record.longitude}`" target="_blank" rel="noopener">{{ record.latitude.toFixed(6) }}, {{ record.longitude.toFixed(6) }} ↗</a></dd><dd v-else>Not required for this check-in</dd></div>
        <div v-if="record.distance_m != null"><dt>Distance from school</dt><dd>{{ Math.round(record.distance_m) }} meters</dd></div>
      </dl>
      <p v-if="!reviewable && record.review_note" class="teacher-note"><strong>Teacher’s note</strong>{{ record.review_note }}</p>
      <ion-textarea v-if="reviewable" v-model="note" label="Teacher’s note / reason for voiding" label-placement="stacked" fill="outline" auto-grow :maxlength="1000" :disabled="busy" />
      <p v-if="actionError" class="evidence-error" role="alert">{{ actionError }}</p>
    </template>
    <template #actions>
      <ion-button fill="outline" :disabled="busy" @click="$emit('close')">Close</ion-button>
      <ion-button v-if="reviewable && record?.verification_status === 'rejected'" :disabled="busy" @click="$emit('review', false, note)">{{ busy ? 'Saving…' : 'Restore attendance' }}</ion-button>
      <ion-button v-else-if="reviewable" color="danger" :disabled="busy" @click="$emit('review', true, note)">{{ busy ? 'Saving…' : 'Void attendance' }}</ion-button>
    </template>
  </app-modal>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { IonBadge, IonButton, IonIcon, IonSpinner, IonTextarea } from '@ionic/vue'
import { imageOutline } from 'ionicons/icons'
import AppModal from '@/components/AppModal.vue'
import { supabase } from '@/lib/supabase'
import { toUserFacingErrorMessage } from '@/utils/errors'

export interface EvidenceRecord {
  id: string; status: string; verification_status: string | null; selfie_path: string | null
  selfie_url?: string | null; latitude: number | null; longitude: number | null; distance_m: number | null
  submitted_at: string | null; created_at?: string; meeting_starts_at?: string; meeting_title?: string; class_name?: string
  review_note?: string | null
  attendance_enabled?: boolean
}
const props = defineProps<{ record: EvidenceRecord | null; studentName: string; reviewable?: boolean; busy?: boolean; actionError?: string }>()
defineEmits<{ close: []; review: [voided: boolean, note: string] }>()
const photoUrl = ref('')
const loadingPhoto = ref(false)
const photoFailed = ref(false)
const photoError = ref('')
const note = ref('')
let photoRequest = 0
watch(() => props.record, async record => {
  const request = ++photoRequest
  note.value = record?.review_note || ''
  photoUrl.value = ''
  photoFailed.value = false
  photoError.value = ''
  loadingPhoto.value = Boolean(record?.selfie_path)
  if (!record?.selfie_path) return
  try {
    const { data, error } = await supabase.storage.from('attendance-selfies').createSignedUrl(record.selfie_path, 900)
    if (request !== photoRequest) return
    if (error) throw error
    if (!data?.signedUrl) throw new Error('Unable to load the attendance photo.')
    photoUrl.value = data.signedUrl
  } catch (error) {
    if (request === photoRequest) photoError.value = toUserFacingErrorMessage(error, 'Unable to load the attendance photo.')
  } finally {
    if (request === photoRequest) loadingPhoto.value = false
  }
}, { immediate: true })
function formatDate(value?: string | null) {
  const date = value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Not recorded'
}
</script>

<style scoped>
.evidence-heading { display: flex; align-items: start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.evidence-heading p { margin: 0 0 5px; color: var(--campus-accent); font-size: 12px; font-weight: 600; }
.evidence-heading h2 { margin: 0 0 5px; color: var(--campus-text); font-size: 22px; letter-spacing: -.025em; }
.evidence-heading span { color: var(--campus-muted); font-size: 13px; }
.evidence-photo { display: block; width: 100%; max-height: 420px; object-fit: contain; border: 1px solid var(--campus-border); border-radius: 14px; background: var(--campus-surface-soft); }
.photo-state { display: grid; place-items: center; gap: 12px; min-height: 180px; padding: 24px; border: 1px dashed var(--campus-border); border-radius: 14px; color: var(--campus-muted); text-align: center; font-size: 13px; }
.photo-state ion-icon { font-size: 30px; }
.evidence-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 24px 0; }
.evidence-facts div { display: grid; gap: 5px; }
dt { color: var(--campus-muted); font-size: 12px; } dd { margin: 0; overflow-wrap: anywhere; color: var(--campus-text); font-size: 13px; font-weight: 600; } a { color: var(--campus-accent); }
.teacher-note { display: grid; gap: 6px; padding: 16px; border-radius: 12px; background: var(--campus-surface-soft); font-size: 13px; white-space: pre-wrap; }
.evidence-error { color: var(--campus-danger); font-size: 13px; }
@media (max-width: 480px) { .evidence-facts { grid-template-columns: 1fr; } .evidence-heading { flex-wrap: wrap; } }
</style>
