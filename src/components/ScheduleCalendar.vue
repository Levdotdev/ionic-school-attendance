<template>
  <section class="schedule-calendar" aria-label="Class schedule calendar">
    <header class="calendar-toolbar">
      <div class="calendar-heading"><p>{{ heading }}</p><h2 aria-live="polite">{{ calendarLabel }}</h2></div>
      <div class="calendar-controls">
        <div class="calendar-navigation"><button type="button" aria-label="Previous calendar period" @click="navigate(-1)">‹</button><button type="button" @click="goToday">Today</button><button type="button" aria-label="Next calendar period" @click="navigate(1)">›</button></div>
        <div class="calendar-views" role="group" aria-label="Calendar view"><button v-for="option in views" :key="option.value" type="button" :aria-pressed="view === option.value" :class="{ selected: view === option.value }" @click="view = option.value">{{ option.label }}</button></div>
      </div>
    </header>

    <div class="calendar-legend"><span><i class="weekly-dot"></i>Weekly schedule</span><span><i class="meeting-dot"></i>Meeting</span><span v-if="taskLegend"><i class="task-dot"></i>Task</span><span><i class="cancelled-dot"></i>Not counted</span></div>

    <div v-if="view !== 'agenda'" class="calendar-grid" :class="{ 'month-grid': view === 'month', 'week-grid': view === 'week' }">
      <div v-for="day in weekdays" :key="day" class="weekday-heading">{{ day }}</div>
      <article v-for="day in visibleDays" :key="day.key" class="calendar-day" :class="{ 'outside-month': view === 'month' && day.outsideMonth, today: day.key === todayKey, 'selected-day': day.key === anchor }">
        <button type="button" class="day-heading" :aria-label="day.longLabel" :aria-current="day.key === todayKey ? 'date' : undefined" @click="selectDay(day.key)"><span class="mobile-weekday">{{ day.weekday }}</span><span class="day-number">{{ day.number }}</span></button>
        <div v-if="day.events.length" class="calendar-events">
          <button v-for="event in (view === 'month' ? day.events.slice(0, 3) : day.events)" :key="event.id" type="button" class="calendar-event" :class="eventClass(event)" :style="event.color ? { '--event-color': event.color } : undefined" :title="eventAccessibleLabel(event)" @click="$emit('select', event)">
            <time>{{ formatTime(event.start) }}</time><strong>{{ event.title }}</strong><span v-if="event.className && event.className !== event.title">{{ event.className }}</span><small v-if="event.status && isCancelled(event)">Not counted</small><small v-else-if="event.subtext">{{ event.subtext }}</small>
          </button>
          <button v-if="view === 'month' && day.events.length > 3" class="more-events" type="button" @click="selectDay(day.key); view = 'agenda'">+{{ day.events.length - 3 }} more</button>
        </div>
        <span v-else class="day-empty">No events</span>
      </article>
    </div>

    <div v-else class="calendar-agenda">
      <article v-for="day in visibleDays" :key="day.key" class="agenda-day" :class="{ today: day.key === todayKey }"><button class="agenda-date" type="button" @click="selectDay(day.key)"><strong>{{ day.weekday }}</strong><span>{{ day.shortLabel }}</span><small v-if="day.key === todayKey">Today</small></button><div v-if="day.events.length" class="agenda-events"><button v-for="event in day.events" :key="event.id" type="button" class="agenda-event" :class="eventClass(event)" :style="event.color ? { '--event-color': event.color } : undefined" @click="$emit('select', event)"><span class="agenda-time">{{ formatTime(event.start) }}<small>{{ formatTime(event.end) }}</small></span><span class="agenda-copy"><strong>{{ event.title }}</strong><span v-if="event.className && event.className !== event.title">{{ event.className }}</span><small v-if="isCancelled(event)">Not counted</small><small v-else-if="event.subtext">{{ event.subtext }}</small></span><span class="agenda-arrow" aria-hidden="true">›</span></button></div><p v-else class="agenda-empty">Nothing scheduled</p></article>
    </div>
    <p v-if="!eventsInRange" class="calendar-empty-note">No events are scheduled in this {{ view === 'month' ? 'month' : 'week' }}.</p>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

export interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  kind?: string
  className?: string
  status?: string
  color?: string
  subtext?: string
}
export type CalendarView = 'month' | 'week' | 'agenda'
const props = withDefaults(defineProps<{ events: CalendarEvent[]; selectedDate?: string; initialView?: CalendarView; heading?: string; taskLegend?: boolean }>(), { initialView: 'week', heading: 'Class calendar', taskLegend: false })
const emit = defineEmits<{ select: [event: CalendarEvent]; dateChange: [date: string]; viewChange: [view: CalendarView]; rangeChange: [range: { start: string; end: string }] }>()
const TIME_ZONE = 'Asia/Manila'
const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const views: Array<{ value: CalendarView; label: string }> = [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'agenda', label: 'Agenda' }]
const todayKey = keyInManila(new Date())
const anchor = ref(props.selectedDate || todayKey)
const view = ref<CalendarView>(props.initialView)
watch(() => props.selectedDate, value => { if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) anchor.value = value })

function fromKey(key: string) { return new Date(`${key}T00:00:00Z`) }
function dateKey(date: Date) { return date.toISOString().slice(0, 10) }
function addDays(key: string, days: number) { const date = fromKey(key); date.setUTCDate(date.getUTCDate() + days); return dateKey(date) }
function weekStart(key: string) { const date = fromKey(key); return addDays(key, -((date.getUTCDay() + 6) % 7)) }
function keyInManila(date: Date) { const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date).map(part => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}` }
const range = computed(() => {
  if (view.value !== 'month') { const start = weekStart(anchor.value); return { start, end: addDays(start, 7) } }
  const date = fromKey(anchor.value)
  date.setUTCDate(1)
  const start = weekStart(dateKey(date))
  date.setUTCMonth(date.getUTCMonth() + 1)
  const end = weekStart(dateKey(date)) === dateKey(date) ? dateKey(date) : addDays(weekStart(dateKey(date)), 7)
  return { start, end }
})
watch(range, value => emit('rangeChange', value), { immediate: true })
watch(view, value => emit('viewChange', value))
const visibleDays = computed(() => {
  const days = []
  for (let key = range.value.start; key < range.value.end; key = addDays(key, 1)) {
    const date = fromKey(key)
    const events = props.events.filter(event => keyInManila(new Date(event.start)) === key).sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
    days.push({ key, number: date.getUTCDate(), weekday: new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', weekday: 'short' }).format(date), shortLabel: new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(date), longLabel: new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', dateStyle: 'full' }).format(date), outsideMonth: key.slice(0, 7) !== anchor.value.slice(0, 7), events })
  }
  return days
})
const eventsInRange = computed(() => visibleDays.value.reduce((sum, day) => sum + day.events.length, 0))
const calendarLabel = computed(() => {
  if (view.value === 'month') return new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(fromKey(anchor.value))
  const formatter = new Intl.DateTimeFormat('en-PH', { timeZone: 'UTC', month: 'short', day: 'numeric' })
  return `${formatter.format(fromKey(range.value.start))} – ${formatter.format(fromKey(addDays(range.value.end, -1)))}, ${fromKey(anchor.value).getUTCFullYear()}`
})
function selectDay(key: string) { anchor.value = key; emit('dateChange', key) }
function navigate(direction: number) {
  if (view.value === 'month') { const date = fromKey(anchor.value); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + direction); selectDay(dateKey(date)) }
  else selectDay(addDays(anchor.value, direction * 7))
}
function goToday() { selectDay(todayKey) }
function formatTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-PH', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' }).format(date) }
function isCancelled(event: CalendarEvent) { return event.status === 'cancelled' || event.status === 'not_counted' || event.status === 'archived' }
function eventClass(event: CalendarEvent) { return { 'weekly-event': event.kind === 'weekly', 'meeting-event': event.kind !== 'weekly' && event.kind !== 'task', 'task-event': event.kind === 'task', 'completed-event': event.status === 'completed', 'cancelled-event': isCancelled(event) } }
function eventAccessibleLabel(event: CalendarEvent) { return `${event.title}${event.className && event.className !== event.title ? ` · ${event.className}` : ''} · ${formatTime(event.start)} – ${formatTime(event.end)}${isCancelled(event) ? ' · Not counted' : ''}` }
</script>

<style scoped>
.schedule-calendar { --event-color: var(--campus-accent); overflow: hidden; border: 1px solid var(--campus-border); border-radius: 18px; background: var(--campus-surface); color: var(--campus-text); }
.calendar-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; padding: 22px 22px 16px; }
.calendar-heading p { margin: 0 0 5px; color: var(--campus-accent); font-size: 11px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }.calendar-heading h2 { margin: 0; font-size: 19px; letter-spacing: -.025em; }
.calendar-controls, .calendar-navigation, .calendar-views { display: flex; align-items: center; gap: 5px; }.calendar-controls { flex-wrap: wrap; gap: 10px; }
.calendar-navigation, .calendar-views { padding: 4px; border: 1px solid var(--campus-border); border-radius: 10px; }
button { font: inherit; cursor: pointer; } button:focus-visible { outline: 3px solid var(--campus-accent); outline-offset: 2px; }
.calendar-controls button { min-width: 32px; min-height: 32px; padding: 5px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--campus-muted); font-size: 12px; font-weight: 650; }.calendar-controls button.selected { background: var(--campus-accent-soft); color: var(--campus-accent); }
.calendar-legend { display: flex; flex-wrap: wrap; gap: 14px; padding: 0 22px 18px; color: var(--campus-muted); font-size: 11px; }.calendar-legend span { display: flex; align-items: center; gap: 6px; }.calendar-legend i { width: 7px; height: 7px; border-radius: 50%; }.weekly-dot { background: var(--campus-accent); }.meeting-dot { background: var(--campus-gold, #b48a1c); }.cancelled-dot { background: var(--campus-muted); }
.calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); border-top: 1px solid var(--campus-border); }.weekday-heading { padding: 10px 8px; background: var(--campus-surface-soft); color: var(--campus-muted); text-align: center; font-size: 11px; font-weight: 650; }
.calendar-day { min-width: 0; min-height: 130px; padding: 8px 6px; border-top: 1px solid var(--campus-border); border-right: 1px solid var(--campus-border); }.calendar-day:nth-child(7n) { border-right: 0; }.week-grid .calendar-day { min-height: 240px; }.outside-month { background: var(--campus-surface-soft); }.outside-month .day-number { opacity: .45; }.day-heading { display: flex; align-items: center; justify-content: center; gap: 7px; width: 100%; margin-bottom: 7px; padding: 0; border: 0; background: transparent; color: var(--campus-text); font-size: 12px; font-weight: 650; }.day-number { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; }.today .day-number { background: var(--campus-accent); color: var(--campus-on-accent, #fff); }.selected-day:not(.today) .day-number { background: var(--campus-accent-soft); color: var(--campus-accent); }.mobile-weekday { display: none; }
.calendar-events { display: grid; gap: 5px; }.calendar-event { display: grid; min-width: 0; gap: 3px; width: 100%; padding: 7px; border: 0; border-left: 3px solid var(--event-color); border-radius: 5px; background: var(--campus-accent-soft); color: var(--campus-text); text-align: left; }.calendar-event time { color: var(--campus-accent); font-size: 10px; font-weight: 700; }.calendar-event strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }.calendar-event span, .calendar-event small { overflow: hidden; color: var(--campus-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.meeting-event { --event-color: var(--campus-gold, #b48a1c); }.cancelled-event { --event-color: var(--campus-muted); background: var(--campus-surface-soft); }.cancelled-event strong { text-decoration: line-through; }.day-empty { display: block; padding: 6px 0; color: var(--campus-muted); text-align: center; font-size: 10px; opacity: .7; }.month-grid .day-empty { display: none; }.more-events { padding: 4px; border: 0; background: transparent; color: var(--campus-accent); text-align: left; font-size: 10px; font-weight: 650; }
.calendar-agenda { border-top: 1px solid var(--campus-border); }.agenda-day { display: grid; grid-template-columns: 100px minmax(0, 1fr); gap: 16px; padding: 16px 22px; border-bottom: 1px solid var(--campus-border); }.agenda-day:last-child { border-bottom: 0; }.agenda-date { display: grid; justify-items: start; align-content: start; gap: 4px; padding: 3px 0; border: 0; background: transparent; color: var(--campus-text); text-align: left; }.agenda-date strong { font-size: 13px; }.agenda-date span, .agenda-date small { color: var(--campus-muted); font-size: 11px; }.agenda-day.today .agenda-date strong, .agenda-date small { color: var(--campus-accent); }.agenda-events { display: grid; gap: 8px; }.agenda-event { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px; border: 1px solid var(--campus-border); border-left: 3px solid var(--event-color); border-radius: 10px; background: var(--campus-surface); text-align: left; color: var(--campus-text); }.agenda-time { display: grid; flex: 0 0 76px; gap: 4px; font-size: 12px; font-weight: 650; }.agenda-time small { color: var(--campus-muted); font-size: 10px; font-weight: 400; }.agenda-copy { display: grid; min-width: 0; gap: 4px; }.agenda-copy strong { overflow-wrap: anywhere; font-size: 13px; }.agenda-copy span, .agenda-copy small { color: var(--campus-muted); font-size: 11px; }.agenda-arrow { margin-left: auto; color: var(--campus-muted); }.agenda-empty { align-self: center; margin: 0; color: var(--campus-muted); font-size: 12px; }.calendar-empty-note { margin: 0; padding: 16px 22px; border-top: 1px solid var(--campus-border); color: var(--campus-muted); font-size: 12px; }
.task-dot { background: var(--campus-warning, #b48a1c); }.task-event { --event-color: var(--campus-warning, #b48a1c); }.completed-event { opacity: .7; }.completed-event strong { text-decoration: line-through; }
@media(max-width: 760px) { .calendar-toolbar { padding: 18px 14px 14px; }.calendar-heading h2 { font-size: 17px; }.calendar-controls { width: 100%; justify-content: space-between; }.calendar-controls button { min-height: 36px; padding: 5px 9px; }.calendar-legend { padding: 0 14px 14px; gap: 11px; font-size: 10px; }.week-grid { display: block; }.week-grid .weekday-heading { display: none; }.week-grid .calendar-day { display: grid; grid-template-columns: 58px minmax(0, 1fr); align-items: start; gap: 10px; min-height: 0; padding: 13px 14px; border-right: 0; }.week-grid .day-heading { flex-direction: column; margin: 0; gap: 3px; }.week-grid .mobile-weekday { display: block; color: var(--campus-muted); font-size: 10px; }.week-grid .calendar-event { padding: 10px; }.week-grid .calendar-event strong { font-size: 13px; white-space: normal; }.week-grid .calendar-event time { font-size: 11px; }.week-grid .day-empty { align-self: center; padding: 12px 0; text-align: left; font-size: 11px; }.month-grid .calendar-day { min-height: 95px; padding: 5px 3px; }.month-grid .calendar-event { padding: 4px 3px; border-left-width: 2px; }.month-grid .calendar-event span, .month-grid .calendar-event small { display: none; }.month-grid .calendar-event strong { font-size: 9px; }.month-grid .calendar-event time { font-size: 8px; }.month-grid .weekday-heading { font-size: 10px; }.agenda-day { grid-template-columns: 58px minmax(0, 1fr); gap: 10px; padding: 14px; }.agenda-event { gap: 9px; padding: 10px; }.agenda-time { flex-basis: 65px; font-size: 10px; }.agenda-copy strong { font-size: 12px; } }
</style>
