<template>
  <section class="parent-calendar-panel">
    <p v-if="message" class="calendar-error" role="alert">{{ message }}</p>
    <schedule-calendar :events="events" :heading="`${studentName}’s classes`" @range-change="changeRange" @select="selected = $event" />
    <app-modal :open="Boolean(selected)" title="Class schedule" @close="selected = null"><template v-if="selected"><h3>{{ selected.className || selected.title }}</h3><dl><div><dt>When</dt><dd>{{ formatDate(selected.start) }} – {{ formatTime(selected.end) }}</dd></div><div><dt>Attendance</dt><dd>{{ selected.status === 'not_counted' ? 'This meeting is not counted toward attendance.' : selected.kind === 'weekly' ? 'Weekly class schedule. The teacher may change a particular meeting.' : 'Scheduled class meeting.' }}</dd></div><div v-if="selected.subtext"><dt>Details</dt><dd>{{ selected.subtext }}</dd></div></dl></template><template #actions><ion-button @click="selected = null">Close</ion-button></template></app-modal>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { IonButton } from '@ionic/vue'
import ScheduleCalendar, { type CalendarEvent } from '@/components/ScheduleCalendar.vue'
import AppModal from '@/components/AppModal.vue'
import { supabase } from '@/lib/supabase'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'
import { useSession } from '@/composables/useSession'
import { currentSchoolWeek, makeStudentCalendarEvents, type ScheduleCourse, type ScheduleException, type StudentCalendarMeeting, type StudentWeeklySchedule } from '@/utils/studentScheduleCalendar'
import { toUserFacingErrorMessage } from '@/utils/errors'
const props = defineProps<{ studentId: string; studentName: string; courses: ScheduleCourse[] }>()
const { user } = useSession()
const schedules = ref<StudentWeeklySchedule[]>([]), meetings = ref<StudentCalendarMeeting[]>([]), exceptions = ref<ScheduleException[]>([])
const selected = ref<CalendarEvent | null>(null), message = ref(''), range = ref(currentSchoolWeek())
let request = 0, mounted = false
const events = computed(() => makeStudentCalendarEvents({ courses: props.courses, schedules: schedules.value, meetings: meetings.value, exceptions: exceptions.value, tasks: [], range: range.value }))
async function loadCalendar() {
  const generation = ++request, actor = user.value?.id, student = props.studentId
  const ids = props.courses.filter(course => !course.archived_at).map(course => course.id)
  if (!ids.length) { schedules.value = []; meetings.value = []; exceptions.value = []; return }
  try {
    const [weekly, actual, excluded] = await Promise.all([
      supabase.from('class_schedules').select('id,class_id,day_of_week,starts_at,ends_at,room,is_active,attendance_mode,check_in_minutes_after_start').in('class_id', ids).order('day_of_week').order('starts_at'),
      supabase.from('meetings').select('id,class_id,schedule_id,schedule_week_start,meeting_date,starts_at,ends_at,attendance_enabled').in('class_id', ids).gte('meeting_date', range.value.start).lt('meeting_date', range.value.end).order('starts_at'),
      supabase.rpc('visible_schedule_meeting_exceptions', { p_start: range.value.start, p_end: range.value.end }),
    ])
    if (request !== generation || actor !== user.value?.id || student !== props.studentId) return
    for (const result of [weekly, actual, excluded]) if (result.error) throw result.error
    schedules.value = (weekly.data || []) as StudentWeeklySchedule[]; meetings.value = (actual.data || []) as StudentCalendarMeeting[]
    exceptions.value = (Array.isArray(excluded.data) ? excluded.data : []) as ScheduleException[]; message.value = ''
    if (selected.value) selected.value = events.value.find(event => event.id === selected.value?.id) || null
  } catch (error) { if (generation === request) message.value = toUserFacingErrorMessage(error, 'Unable to load the class calendar.') }
}
function changeRange(next: { start: string; end: string }) { if (next.start === range.value.start && next.end === range.value.end) return; range.value = next; if (mounted) void loadCalendar() }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
function formatTime(value: string) { return new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) }
onMounted(() => { mounted = true; void loadCalendar() })
watch(() => [props.studentId, props.courses.map(course => `${course.id}:${course.archived_at}`).join('|')], () => { request++; if (mounted) void loadCalendar() })
watch(() => user.value?.id, () => { request++; schedules.value = []; meetings.value = []; exceptions.value = []; selected.value = null })
onBeforeUnmount(() => { request++ })
useRealtimeRefresh({ channel: `parent-calendar-${props.studentId}`, enabled: () => Boolean(props.studentId), onChange: loadCalendar })
</script>
<style scoped>
.parent-calendar-panel { min-width:0; margin-bottom:22px; }.calendar-error { padding:12px; border-radius:10px; color:var(--campus-danger); background:var(--campus-danger-soft); font-size:13px; }h3 { margin:0 0 18px; color:var(--campus-text); font-size:20px; }dl { display:grid; gap:18px; margin:0; }dl div { display:grid; gap:5px; }dt { color:var(--campus-muted); font-size:12px; }dd { margin:0; color:var(--campus-text); font-size:14px; line-height:1.6; }
</style>
