<template>
  <app-modal :open="open" title="Cumulative class attendance" :busy="exporting" wide @close="$emit('close')">
    <p class="report-intro">Download the class's total counted attendance, sorted by last name. Cancelled meetings and future meetings do not count. Missing check-ins become absent after the meeting and check-in window close.</p>
    <div v-if="loading" class="report-loading" role="status"><ion-spinner /><span>Preparing the class report…</span></div>
    <p v-if="error" class="report-error" role="alert">{{ error }}</p>
    <template v-if="report">
      <div class="report-heading"><h2>{{ report.class_name }}</h2><p>As of {{ asOf }} · Asia/Manila</p></div>
      <p v-if="report.accounting_note" class="report-intro">{{ report.accounting_note }}</p>
      <dl class="report-totals"><div><dt>Students</dt><dd>{{ report.totals.student_count }}</dd></div><div><dt>Counted meetings</dt><dd>{{ report.meeting_count }}</dd></div><div><dt>Present</dt><dd>{{ report.totals.present_count }}</dd></div><div><dt>Absent</dt><dd>{{ report.totals.absent_count }}</dd></div></dl>
      <div class="report-table-scroll"><table><caption class="sr-only">Cumulative attendance by student</caption><thead><tr><th scope="col">Student</th><th scope="col">Present</th><th scope="col">Absent</th><th scope="col">Counted</th><th scope="col">Rate</th></tr></thead><tbody><tr v-for="row in report.students" :key="row.student_id"><th scope="row">{{ attendanceReportName(row) }}<small v-if="!row.is_active">Historical enrollment</small></th><td>{{ row.present_count }}</td><td>{{ row.absent_count }}</td><td>{{ row.total_count }}</td><td>{{ attendanceRateLabel(row.attendance_rate) }}</td></tr><tr v-if="!report.students.length"><td colspan="5">No students in this class report.</td></tr></tbody><tfoot><tr><th scope="row">Class total</th><td>{{ report.totals.present_count }}</td><td>{{ report.totals.absent_count }}</td><td>{{ report.totals.total_count }}</td><td>{{ attendanceRateLabel(report.totals.attendance_rate) }}</td></tr></tfoot></table></div>
    </template>
    <p v-if="exportMessage" class="report-success" role="status">{{ exportMessage }}</p>
    <template #actions><ion-button fill="outline" :disabled="exporting" @click="$emit('close')">Close</ion-button><ion-button fill="outline" :disabled="!report || loading || exporting" @click="exportReport('csv')">Download CSV</ion-button><ion-button :disabled="!report || loading || exporting" @click="exportReport('pdf')">{{ exporting ? 'Preparing download…' : 'Download PDF' }}</ion-button></template>
  </app-modal>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { IonButton, IonSpinner } from '@ionic/vue'
import AppModal from '@/components/AppModal.vue'
import { useSession } from '@/composables/useSession'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { attendanceRateLabel, attendanceReportCsv, attendanceReportFilename, attendanceReportName, downloadAttendanceBlob, loadClassAttendanceReport, type ClassAttendanceReport } from '@/services/classAttendanceReport'
import { toUserFacingErrorMessage } from '@/utils/errors'

const props = defineProps<{ open: boolean; classId: string }>()
defineEmits<{ close: [] }>()
const { profile } = useSession()
const report = ref<ClassAttendanceReport | null>(null), loading = ref(false), exporting = ref(false), error = ref(''), exportMessage = ref('')
let request = 0
let owner = ''
const asOf = computed(() => report.value ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(report.value.as_of)) : '')
async function loadReport() {
  const attempt = ++request, classId = props.classId, actor = profile.value?.id
  if (!props.open || !classId || !actor || profile.value?.role !== 'teacher' || profile.value.teacher_approval_status !== 'approved') { report.value = null; loading.value = false; return }
  loading.value = true; error.value = ''
  try {
    const loaded = await loadClassAttendanceReport(classId)
    if (attempt !== request || !props.open || classId !== props.classId || actor !== profile.value?.id) return
    report.value = loaded; owner = actor
  } catch (cause) { if (attempt === request) { report.value = null; error.value = toUserFacingErrorMessage(cause, 'Unable to prepare the class attendance report.') } }
  finally { if (attempt === request) loading.value = false }
}
watch(() => `${props.open}:${props.classId}:${profile.value?.id || ''}:${profile.value?.role || ''}:${profile.value?.teacher_approval_status || ''}`, () => {
  request++; report.value = null; owner = ''; exportMessage.value = ''; error.value = ''
  if (props.open) void loadReport()
}, { immediate: true })
useRealtimeRefresh({ channel: 'teacher-class-report', enabled: () => props.open && !exporting.value, onChange: loadReport })
onBeforeUnmount(() => { request++ })
async function exportReport(format: 'csv' | 'pdf') {
  const data = report.value, classId = props.classId, actor = profile.value?.id
  if (!data || exporting.value || loading.value || actor !== owner || profile.value?.role !== 'teacher' || profile.value.teacher_approval_status !== 'approved') return
  exporting.value = true; error.value = ''; exportMessage.value = ''
  try {
    let blob: Blob
    if (format === 'csv') blob = new Blob([attendanceReportCsv(data)], { type: 'text/csv;charset=utf-8' })
    else {
      const { buildClassAttendancePdf, loadAttendancePdfAssets } = await import('@/services/classAttendancePdf')
      const bytes = await buildClassAttendancePdf(data, await loadAttendancePdfAssets())
      blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
    }
    const isCurrent = () => props.open && classId === props.classId && actor === profile.value?.id && actor === owner && profile.value?.role === 'teacher' && profile.value.teacher_approval_status === 'approved'
    if (!isCurrent()) return
    const destination = await downloadAttendanceBlob(blob, attendanceReportFilename(data, format), isCurrent)
    exportMessage.value = destination === 'share' ? `${format.toUpperCase()} report opened in the save/share sheet.` : `${format.toUpperCase()} download prepared.`
  } catch (cause) { error.value = toUserFacingErrorMessage(cause, 'The report could not be downloaded.') }
  finally { exporting.value = false }
}
</script>
<style scoped>
.report-intro { margin:0 0 20px; color:var(--campus-muted); font-size:13px; line-height:1.65; }.report-heading h2 { margin:0 0 6px; color:var(--campus-text); font-size:20px; overflow-wrap:anywhere; }.report-heading p { margin:0; color:var(--campus-muted); font-size:12px; }.report-totals { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:20px 0; }.report-totals div { padding:13px; background:var(--campus-surface-soft); border-radius:10px; }dt { font-size:11px; color:var(--campus-muted); }dd { margin:7px 0 0; font-size:24px; color:var(--campus-text); font-weight:700; }.report-table-scroll { overflow:auto; max-height:360px; border:1px solid var(--campus-border); border-radius:10px; }table { width:100%; border-collapse:collapse; font-size:12px; color:var(--campus-text); }th,td { padding:12px; text-align:right; border-bottom:1px solid var(--campus-border); white-space:nowrap; }th:first-child { text-align:left; white-space:normal; min-width:170px; }thead,tfoot { background:var(--campus-surface-soft); }tbody small { display:block; margin-top:4px; color:var(--campus-muted); font-size:10px; font-weight:400; }.report-error { color:var(--campus-danger); font-size:13px; }.report-success { color:var(--campus-success); font-size:13px; }.report-loading { display:flex; align-items:center; gap:12px; padding:24px 0; color:var(--campus-muted); }.sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }@media(max-width:520px) { .report-totals { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
