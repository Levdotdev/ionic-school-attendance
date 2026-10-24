<template>
  <app-modal :open="Boolean(student)" title="Parent and guardian links" @close="$emit('close')">
    <template v-if="student"><h3>{{ student.full_name }}</h3><p class="help">Only a parent-approved link gives access to this student’s attendance and school schedule.</p><p v-if="loading" role="status">Loading parent links…</p><p v-else-if="message" class="error" role="alert">{{ message }}</p><div v-else-if="links.length" class="guardian-list"><article v-for="link in links" :key="link.request_id"><div><strong>{{ link.parent_name || 'Parent account' }}</strong><span>{{ link.parent_email }}</span><small v-if="link.responded_at">Responded {{ formatDate(link.responded_at) }}</small><small v-if="link.review_note">{{ link.review_note }}</small></div><span class="link-status" :class="`is-${link.status}`">{{ link.status === 'approved' ? 'Parent approved' : link.status === 'rejected' ? 'Parent declined' : 'Awaiting parent approval' }}</span></article></div><p v-else class="help">This student has no parent link requests yet.</p></template>
    <template #actions><ion-button fill="outline" @click="$emit('invite')">Invite a parent</ion-button><ion-button @click="$emit('close')">Close</ion-button></template>
  </app-modal>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue'
import { IonButton } from '@ionic/vue'
import AppModal from '@/components/AppModal.vue'
import { supabase } from '@/lib/supabase'
import { useSession } from '@/composables/useSession'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { toUserFacingErrorMessage } from '@/utils/errors'
interface GuardianSummary { request_id: string; parent_id: string; parent_name: string; parent_email: string; status: 'pending' | 'approved' | 'rejected'; responded_at: string | null; review_note: string | null }
const props = defineProps<{ student: { id: string; full_name: string } | null }>()
defineEmits<{ close: []; invite: [] }>()
const { user } = useSession()
const links = ref<GuardianSummary[]>([]), loading = ref(false), message = ref('')
let generation = 0
async function load() {
  const student = props.student?.id, owner = user.value?.id, request = ++generation
  if (!student) { links.value = []; return }
  loading.value = !links.value.length; message.value = ''
  try {
    const result = await supabase.rpc('student_guardian_summary', { p_student_id: student })
    if (request !== generation || props.student?.id !== student || user.value?.id !== owner) return
    if (result.error) throw result.error
    links.value = Array.isArray(result.data) ? result.data : []
  } catch (error) { if (request === generation) message.value = toUserFacingErrorMessage(error, 'Unable to load parent links.') }
  finally { if (request === generation) loading.value = false }
}
watch(() => props.student?.id, () => { generation++; links.value = []; void load() }, { immediate: true })
watch(() => user.value?.id, () => { generation++; links.value = []; message.value = '' })
useRealtimeRefresh({ channel: 'student-guardian-details', enabled: () => Boolean(props.student), onChange: load })
function formatDate(value: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
</script>
<style scoped>
h3 { margin:0 0 12px; color:var(--campus-text); font-size:20px; }.help { color:var(--campus-muted); font-size:13px; line-height:1.6; }.error { color:var(--campus-danger); }.guardian-list { display:grid; gap:10px; margin-top:20px; }.guardian-list article { display:flex; flex-wrap:wrap; gap:12px; align-items:start; justify-content:space-between; padding:16px; border:1px solid var(--campus-border); border-radius:12px; }.guardian-list article>div { display:grid; gap:5px; min-width:0; }.guardian-list strong { color:var(--campus-text); font-size:14px; }.guardian-list span:not(.link-status),.guardian-list small { color:var(--campus-muted); overflow-wrap:anywhere; font-size:12px; }.link-status { display:inline-flex; padding:6px 9px; border-radius:20px; font-size:11px; font-weight:650; color:var(--campus-warning); background:var(--campus-warning-soft); }.link-status.is-approved { color:var(--campus-success); background:var(--campus-success-soft); }.link-status.is-rejected { color:var(--campus-danger); background:var(--campus-danger-soft); }
</style>
