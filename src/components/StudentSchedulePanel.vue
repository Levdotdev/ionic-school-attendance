<template>
  <div class="student-schedule-workspace">
    <p v-if="message" class="schedule-error" role="alert">{{ message }}</p>
    <schedule-calendar :events="calendarEvents" heading="Classes & tasks" task-legend @range-change="changeRange" @select="selectEvent" />
    <section class="reminder-panel" aria-labelledby="class-reminders-title">
      <header><div><p class="eyebrow">Your preferences</p><h2 id="class-reminders-title">Class reminders</h2><p>Choose when this device should remind you. Your choices repeat with each weekly schedule.</p></div><ion-icon :icon="notificationsOutline" /></header>
      <div v-if="activeSchedules.length" class="reminder-list"><article v-for="schedule in activeSchedules" :key="schedule.id" class="reminder-row"><div><strong>{{ courseName(schedule.class_id) }}</strong><p>{{ weekday(schedule.day_of_week) }} · {{ timeLabel(schedule.starts_at) }}–{{ timeLabel(schedule.ends_at) }}<span v-if="schedule.room"> · {{ schedule.room }}</span></p><small>{{ reminderSummary(schedule.id) }}</small></div><ion-button fill="outline" size="small" @click="openReminders(schedule)">Set reminders</ion-button></article></div>
      <p v-else class="schedule-empty">Your teacher’s weekly schedules will appear here after you join a class.</p>
    </section>
    <app-modal :open="Boolean(editingSchedule)" title="Class reminders" :busy="savingReminders" @close="closeReminders">
      <template v-if="editingSchedule"><div class="reminder-modal-copy"><h3>{{ courseName(editingSchedule.class_id) }}</h3><p>{{ weekday(editingSchedule.day_of_week) }} · {{ timeLabel(editingSchedule.starts_at) }}–{{ timeLabel(editingSchedule.ends_at) }}</p></div><p class="reminder-help">Choose any reminder times. Leave every option unchecked to turn reminders off for this schedule.</p><div class="reminder-options"><label v-for="option in reminderOptions" :key="option.value"><input v-model="draftOffsets" type="checkbox" :value="option.value" :disabled="savingReminders" /><span>{{ option.label }}</span></label></div><p class="reminder-help">Push notifications require the installed Android app and notification permission.</p><p v-if="reminderError" class="schedule-error" role="alert">{{ reminderError }}</p></template>
      <template #actions><ion-button fill="outline" :disabled="savingReminders" @click="closeReminders">Cancel</ion-button><ion-button :disabled="savingReminders" @click="saveReminders">{{ savingReminders ? 'Saving…' : 'Save preferences' }}</ion-button></template>
    </app-modal>
    <app-modal :open="Boolean(selectedClassEvent)" title="Class schedule" @close="selectedClassEvent = null"><template v-if="selectedClassEvent"><h3 class="event-title">{{ selectedClassEvent.title }}</h3><dl class="event-facts"><div><dt>Course</dt><dd>{{ selectedClassEvent.className }}</dd></div><div><dt>Time</dt><dd>{{ formatEventTime(selectedClassEvent) }}</dd></div><div><dt>Attendance</dt><dd>{{ selectedClassEvent.status === 'not_counted' ? 'This meeting does not count toward attendance.' : selectedClassEvent.kind === 'weekly' ? 'Weekly schedule; individual meetings may be changed by your teacher.' : 'This meeting counts toward attendance.' }}</dd></div></dl></template><template #actions><ion-button fill="outline" @click="selectedClassEvent = null">Close</ion-button><ion-button v-if="selectedClassEvent?.scheduleId" @click="openSelectedReminders">Reminders</ion-button></template></app-modal>
  </div>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { IonButton, IonIcon } from '@ionic/vue'
import { notificationsOutline } from 'ionicons/icons'
import { useRouter } from 'vue-router'
import ScheduleCalendar, { type CalendarEvent } from '@/components/ScheduleCalendar.vue'
import AppModal from '@/components/AppModal.vue'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { supabase } from '@/lib/supabase'
import { loadStudentTaskData } from '@/services/studentTasks'
import type { StudentTask } from '@/types/studentTasks'
import { currentSchoolWeek, makeStudentCalendarEvents, type ScheduleCourse, type ScheduleException, type StudentCalendarEvent, type StudentCalendarMeeting, type StudentWeeklySchedule } from '@/utils/studentScheduleCalendar'
import { toUserFacingErrorMessage } from '@/utils/errors'
const props = defineProps<{ studentId: string; courses: ScheduleCourse[] }>()
const router = useRouter()
const schedules = ref<StudentWeeklySchedule[]>([])
const meetings = ref<StudentCalendarMeeting[]>([])
const tasks = ref<StudentTask[]>([])
const exceptions = ref<ScheduleException[]>([])
const preferences = ref<Record<string, number[]>>({})
const range = ref(currentSchoolWeek())
const message = ref('')
const editingSchedule = ref<StudentWeeklySchedule | null>(null)
const selectedClassEvent = ref<StudentCalendarEvent | null>(null)
const draftOffsets = ref<number[]>([])
const savingReminders = ref(false)
const reminderError = ref('')
const defaults = [120, 60, 30, 15, 5, 0]
const reminderOptions = [{ value: 120, label: '2 hours before' }, { value: 60, label: '1 hour before' }, { value: 30, label: '30 minutes before' }, { value: 15, label: '15 minutes before' }, { value: 5, label: '5 minutes before' }, { value: 0, label: 'At class time' }]
let request = 0
let mounted = false
const activeSchedules = computed(() => schedules.value.filter(s => s.is_active && props.courses.some(c => c.id === s.class_id && !c.archived_at)))
const calendarEvents = computed(() => makeStudentCalendarEvents({ courses: props.courses, schedules: schedules.value, meetings: meetings.value, exceptions: exceptions.value, tasks: tasks.value, range: range.value }))
async function loadCalendar() {
  const generation = ++request
  const actor = props.studentId
  if (!actor) return
  const ids = props.courses.filter(c => !c.archived_at).map(c => c.id)
  try {
    const [scheduleResult, meetingResult, preferenceResult, exceptionResult, taskData] = await Promise.all([
      ids.length ? supabase.from('class_schedules').select('id,class_id,day_of_week,starts_at,ends_at,room,is_active,attendance_mode,check_in_minutes_before,check_in_minutes_after_start').in('class_id', ids).order('day_of_week').order('starts_at') : Promise.resolve({ data: [], error: null }),
      ids.length ? supabase.from('meetings').select('id,class_id,schedule_id,schedule_week_start,title,meeting_date,starts_at,ends_at,attendance_enabled').in('class_id', ids).gte('meeting_date', range.value.start).lt('meeting_date', range.value.end).order('starts_at') : Promise.resolve({ data: [], error: null }),
      supabase.from('student_schedule_notification_preferences').select('schedule_id,reminder_minutes').eq('student_id', actor),
      supabase.rpc('visible_schedule_meeting_exceptions', { p_start: range.value.start, p_end: range.value.end }),
      loadStudentTaskData(actor),
    ])
    if (generation !== request || props.studentId !== actor) return
    for (const result of [scheduleResult, meetingResult, preferenceResult, exceptionResult]) if (result.error) throw result.error
    schedules.value = (scheduleResult.data || []) as StudentWeeklySchedule[]
    meetings.value = (meetingResult.data || []) as StudentCalendarMeeting[]
    preferences.value = Object.fromEntries((preferenceResult.data || []).map((p: { schedule_id: string; reminder_minutes: number[] }) => [p.schedule_id, p.reminder_minutes]))
    exceptions.value = (Array.isArray(exceptionResult.data) ? exceptionResult.data : []) as ScheduleException[]
    tasks.value = taskData.tasks
    message.value = ''
  } catch (error) { if (generation === request) message.value = toUserFacingErrorMessage(error, 'Unable to load your calendar and reminder preferences.') }
}
function changeRange(next: { start: string; end: string }) {
  if (next.start === range.value.start && next.end === range.value.end) return
  range.value = next
  if (mounted) void loadCalendar()
}
function courseName(classId: string) { return props.courses.find(c => c.id === classId)?.name || 'Class' }
function weekday(day: number) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day] }
function timeLabel(time: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(`2026-01-01T${time.slice(0, 8)}+08:00`)) }
function reminderSummary(scheduleId: string) {
  const selected = preferences.value[scheduleId] ?? defaults
  return selected.length ? reminderOptions.filter(o => selected.includes(o.value)).map(o => o.label).join(' · ') : 'Reminders off'
}
function openReminders(schedule: StudentWeeklySchedule) { editingSchedule.value = schedule; draftOffsets.value = [...(preferences.value[schedule.id] ?? defaults)]; reminderError.value = '' }
function closeReminders() { if (!savingReminders.value) editingSchedule.value = null }
async function saveReminders() {
  const schedule = editingSchedule.value
  if (!schedule || !props.studentId) return
  savingReminders.value = true
  reminderError.value = ''
  const offsets = [...new Set(draftOffsets.value)].filter(n => defaults.includes(n)).sort((a, b) => b - a)
  try {
    const { error } = await supabase.from('student_schedule_notification_preferences').upsert({ schedule_id: schedule.id, student_id: props.studentId, reminder_minutes: offsets }, { onConflict: 'schedule_id,student_id' })
    if (error) throw error
    preferences.value = { ...preferences.value, [schedule.id]: offsets }
    editingSchedule.value = null
  } catch (error) { reminderError.value = toUserFacingErrorMessage(error, 'Your reminder preferences could not be saved.') }
  finally { savingReminders.value = false }
}
function selectEvent(event: CalendarEvent) {
  const selected = calendarEvents.value.find(e => e.id === event.id)
  if (!selected) return
  if (selected.taskId && selected.taskDue) { void router.push({ path: '/student/tasks', query: { task: selected.taskId, due: selected.taskDue } }); return }
  selectedClassEvent.value = selected
}
function openSelectedReminders() { const schedule = schedules.value.find(s => s.id === selectedClassEvent.value?.scheduleId); selectedClassEvent.value = null; if (schedule) openReminders(schedule) }
function formatEventTime(event: CalendarEvent) { return `${new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.start))} – ${new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', timeStyle: 'short' }).format(new Date(event.end))}` }
onMounted(() => { mounted = true; void loadCalendar() })
watch(() => [props.studentId, props.courses.map(c => `${c.id}:${c.archived_at}`).join('|')], () => { if (mounted) void loadCalendar() })
onBeforeUnmount(() => { request++ })
useRealtimeRefresh({ channel: 'student-calendar', enabled: () => Boolean(props.studentId), onChange: loadCalendar })
</script>
<style scoped>
.student-schedule-workspace { display:grid; gap:22px; min-width:0; }.schedule-error { padding:12px; border-radius:10px; color:var(--campus-danger); background:var(--campus-danger-soft); font-size:13px; }.reminder-panel { padding:24px; border:1px solid var(--campus-border); border-radius:18px; background:var(--campus-surface); }.reminder-panel header { display:flex; justify-content:space-between; align-items:start; gap:16px; }.reminder-panel header>ion-icon { color:var(--campus-accent); font-size:24px; }.eyebrow { margin:0 0 5px; color:var(--campus-accent); font-size:11px; text-transform:uppercase; letter-spacing:.08em; font-weight:750; }.reminder-panel h2 { margin:0; color:var(--campus-text); font-size:20px; }.reminder-panel header p:not(.eyebrow),.reminder-help,.schedule-empty { color:var(--campus-muted); font-size:13px; line-height:1.6; }.reminder-row { display:flex; align-items:center; justify-content:space-between; gap:14px; padding:18px 0; border-top:1px solid var(--campus-border); }.reminder-row:first-child { margin-top:10px; }.reminder-row:last-child { padding-bottom:0; }.reminder-row>div { min-width:0; }.reminder-row strong { color:var(--campus-text); font-size:14px; }.reminder-row p,.reminder-row small { margin:6px 0 0; color:var(--campus-muted); font-size:12px; line-height:1.5; }.reminder-row small { display:block; max-width:550px; }.reminder-row ion-button { flex-shrink:0; }.reminder-modal-copy h3,.event-title { margin:0 0 6px; color:var(--campus-text); font-size:20px; }.reminder-modal-copy p { color:var(--campus-muted); font-size:13px; }.reminder-options { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:20px 0; }.reminder-options label { display:flex; align-items:center; gap:10px; min-height:48px; padding:12px; border:1px solid var(--campus-border); border-radius:10px; color:var(--campus-text); font-size:13px; cursor:pointer; }.reminder-options input { width:18px; height:18px; accent-color:var(--campus-accent); }.event-facts { display:grid; gap:18px; margin:24px 0 0; }.event-facts div { display:grid; gap:5px; }.event-facts dt { color:var(--campus-muted); font-size:12px; }.event-facts dd { margin:0; color:var(--campus-text); font-size:14px; line-height:1.5; }@media(max-width:520px) { .reminder-panel { padding:18px 14px; }.reminder-row { flex-direction:column; align-items:start; }.reminder-options { grid-template-columns:1fr; } }
</style>
