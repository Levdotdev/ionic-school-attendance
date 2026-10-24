<template>
  <section class="campus-surface history-panel" aria-labelledby="student-history-title">
    <header class="history-heading"><div><p class="eyebrow">Attendance</p><h2 id="student-history-title">My attendance history</h2><p>All recorded attendance and past class meetings, including archived courses.</p></div><span class="history-count">{{ countedRecords.length }} counted</span></header>
    <div class="history-filters"><label>Course<select v-model="courseFilter"><option value="">All courses</option><option v-for="course in historyCourses" :key="course.id" :value="course.id">{{ course.name }}</option></select></label><label>Status<select v-model="statusFilter"><option value="">All attendance</option><option value="present">Present</option><option value="absent">Absent</option><option value="not_counted">Not counted</option></select></label></div>
    <p v-if="message" class="history-error" role="alert">{{ message }}</p>
    <div v-if="loading && !records.length" class="history-empty" role="status"><ion-spinner /><p>Loading your attendance…</p></div>
    <div v-else-if="filtered.length" class="history-list"><button v-for="record in filtered" :key="record.id" type="button" class="history-row" @click="selected = record"><attendance-photo v-if="record.selfie_path" class="history-row-photo" :path="record.selfie_path" :alt="`Attendance photo for ${record.class_name}`" /><span v-else class="history-row-icon"><ion-icon :icon="record.attendance_enabled === false ? removeCircleOutline : record.status === 'present' ? checkmarkCircleOutline : closeCircleOutline" /></span><span class="history-copy"><strong>{{ record.class_name }}</strong><span>{{ formatDate(record.meeting_starts_at) }}</span><small v-if="record.is_inferred && record.attendance_enabled">No attendance was recorded before this meeting ended.</small><small v-else-if="record.verification_status === 'rejected'">Voided by your teacher</small></span><span class="history-status" :class="record.attendance_enabled === false ? 'not-counted' : record.status">{{ record.attendance_enabled === false ? 'Not counted' : record.status === 'present' ? 'Present' : 'Absent' }}</span><span class="history-arrow" aria-hidden="true">›</span></button></div>
    <div v-else class="history-empty"><ion-icon :icon="calendarOutline" /><h3>{{ records.length ? 'No matching attendance' : 'No past attendance yet' }}</h3><p>{{ records.length ? 'Choose another course or attendance status.' : 'Your attendance will appear here when recorded or after a class meeting ends.' }}</p></div>
  </section>
  <evidence-detail-modal :record="selected" :student-name="studentName" @close="selected = null" />
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { IonIcon, IonSpinner } from '@ionic/vue'
import { calendarOutline, checkmarkCircleOutline, closeCircleOutline, removeCircleOutline } from 'ionicons/icons'
import EvidenceDetailModal, { type EvidenceRecord } from '@/components/EvidenceDetailModal.vue'
import AttendancePhoto from '@/components/AttendancePhoto.vue'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { loadAttendanceHistory } from '@/services/attendanceHistory'
import { toUserFacingErrorMessage } from '@/utils/errors'
interface HistoryRecord extends EvidenceRecord { class_id: string; student_id: string; meeting_starts_at: string; class_name: string; is_inferred: boolean; attendance_mode: string }
const props = defineProps<{ studentId: string; studentName: string }>()
const records = ref<HistoryRecord[]>([])
const selected = ref<HistoryRecord | null>(null)
const loading = ref(false)
const message = ref('')
const courseFilter = ref('')
const statusFilter = ref('')
let request = 0
const countedRecords = computed(() => records.value.filter(r => r.attendance_enabled !== false))
const historyCourses = computed(() => [...new Map(records.value.map(r => [r.class_id, { id: r.class_id, name: r.class_name }])).values()].sort((a, b) => a.name.localeCompare(b.name)))
const filtered = computed(() => records.value.filter(r => (!courseFilter.value || r.class_id === courseFilter.value) && (!statusFilter.value || (statusFilter.value === 'not_counted' ? r.attendance_enabled === false : r.attendance_enabled !== false && r.status === statusFilter.value))))
async function loadHistory() {
  if (!props.studentId) return
  const generation = ++request
  const actor = props.studentId
  loading.value = true
  try {
    const data = await loadAttendanceHistory<HistoryRecord>(actor, () => generation === request && actor === props.studentId)
    if (generation !== request || actor !== props.studentId) return
    records.value = data.map(r => r.attendance_mode === 'self_online' ? { ...r, latitude: null, longitude: null, distance_m: null } : r)
    if (selected.value) selected.value = records.value.find(r => r.id === selected.value?.id) || null
    message.value = ''
  } catch (error) {
    if (generation === request) message.value = toUserFacingErrorMessage(error, 'Unable to load your attendance history.')
  } finally { if (generation === request) loading.value = false }
}
watch(() => props.studentId, () => { records.value = []; selected.value = null; void loadHistory() }, { immediate: true })
onBeforeUnmount(() => { request++ })
useRealtimeRefresh({ channel: 'student-history', enabled: () => Boolean(props.studentId), onChange: loadHistory })
function formatDate(value: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
</script>
<style scoped>
.history-panel { background:var(--campus-surface); border:1px solid var(--campus-border); border-radius:18px; }
.history-row-photo { flex:0 0 60px; height:60px; border-radius:10px; overflow:hidden; }
.history-panel { overflow:hidden; padding:24px; }.history-heading { display:flex; align-items:start; justify-content:space-between; gap:16px; }.history-heading h2 { margin:0; color:var(--campus-text); font-size:20px; }.history-heading p:not(.eyebrow) { color:var(--campus-muted); font-size:13px; line-height:1.5; }.eyebrow { color:var(--campus-accent); font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; }.history-count { flex-shrink:0; padding:7px 10px; border-radius:20px; background:var(--campus-accent-soft); color:var(--campus-accent); font-size:12px; }.history-filters { display:flex; flex-wrap:wrap; gap:12px; padding:16px 0; border-bottom:1px solid var(--campus-border); }.history-filters label { display:grid; flex:1; gap:6px; min-width:140px; color:var(--campus-muted); font-size:11px; }.history-filters select { width:100%; min-height:40px; padding:8px 12px; border:1px solid var(--campus-border); border-radius:10px; background:var(--campus-surface); color:var(--campus-text); font:inherit; font-size:13px; }.history-row { display:flex; align-items:center; gap:14px; width:100%; padding:18px 0; border:0; border-bottom:1px solid var(--campus-border); background:transparent; text-align:left; color:var(--campus-text); cursor:pointer; }.history-row:last-child { border-bottom:0; }.history-row-icon { display:grid; flex:0 0 38px; height:38px; place-items:center; border-radius:12px; background:var(--campus-accent-soft); color:var(--campus-accent); font-size:20px; }.history-copy { display:grid; gap:5px; min-width:0; flex:1; }.history-copy strong { overflow-wrap:anywhere; font-size:14px; }.history-copy small,.history-copy>span { color:var(--campus-muted); font-size:11px; }.history-status { flex-shrink:0; padding:7px 10px; border-radius:20px; font-size:11px; font-weight:650; }.present { color:var(--campus-success); background:var(--campus-success-soft); }.absent { color:var(--campus-danger); background:var(--campus-danger-soft); }.not-counted { color:var(--campus-muted); background:var(--campus-surface-soft); }.history-arrow { color:var(--campus-muted); }.history-empty { padding:36px 12px; text-align:center; color:var(--campus-muted); }.history-empty>ion-icon { font-size:30px; }.history-empty h3 { color:var(--campus-text); font-size:16px; }.history-empty p { font-size:13px; line-height:1.5; }.history-error { color:var(--campus-danger); font-size:13px; }button:focus-visible,select:focus-visible { outline:3px solid var(--campus-accent); outline-offset:3px; }@media(max-width:520px) { .history-panel { padding:18px 14px; }.history-row { gap:9px; flex-wrap:wrap; }.history-row-icon { flex-basis:30px; height:30px; }.history-copy { flex-basis:calc(100% - 45px); }.history-status { margin-left:39px; }.history-arrow { margin-left:auto; }.history-heading { flex-wrap:wrap; } }
</style>
