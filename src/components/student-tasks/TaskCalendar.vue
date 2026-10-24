<template>
  <section class="calendar" aria-label="Monthly task calendar">
    <div class="calendar-toolbar"><div><p class="eyebrow">A little perspective</p><h3>{{ monthLabel }}</h3></div><div class="calendar-navigation"><button type="button" aria-label="Previous month" @click="changeMonth(-1)"><ion-icon :icon="chevronBackOutline" aria-hidden="true" /></button><button type="button" class="today-button" @click="goToday">Today</button><button type="button" aria-label="Next month" @click="changeMonth(1)"><ion-icon :icon="chevronForwardOutline" aria-hidden="true" /></button></div></div>
    <div class="weekdays" aria-hidden="true"><span v-for="day in weekdays" :key="day">{{ day }}</span></div>
    <div class="calendar-grid" :aria-label="monthLabel"><button v-for="day in days" :key="day.key" type="button" class="calendar-day" :class="{ outside: day.outside, today: day.key === today, selected: day.key === selectedDate }" :aria-pressed="day.key === selectedDate" :aria-label="`${day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${day.tasks.length} ${day.tasks.length === 1 ? 'task' : 'tasks'}`" @click="selectDay(day.date)"><span class="day-number">{{ day.date.getDate() }}</span><span v-if="day.tasks.length" class="day-count">{{ day.tasks.length }}<span class="count-word"> {{ day.tasks.length === 1 ? 'task' : 'tasks' }}</span></span><span class="day-preview" aria-hidden="true"><span v-for="task in day.tasks.slice(0, 2)" :key="task.key" :class="{ completed: task.status === 'completed' }">{{ task.task.title }}</span><small v-if="day.tasks.length > 2">+{{ day.tasks.length - 2 }} more</small></span></button></div>
    <p class="calendar-hint">Select a day to see its tasks. Counts follow your search and filters.</p>
  </section>
</template>
<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { IonIcon } from '@ionic/vue';
import { chevronBackOutline, chevronForwardOutline } from 'ionicons/icons';
import type { DisplayedStudentTask } from '@/types/studentTasks';
import { localTaskDateKey as localDateKey } from '@/utils/studentTasks';
const props = defineProps<{ tasks: DisplayedStudentTask[]; selectedDate: string; now: Date }>();
const emit = defineEmits<{ (e: 'select', date: string): void }>();
const initial = new Date(`${props.selectedDate}T12:00:00`);
const month = ref(new Date(initial.getFullYear(), initial.getMonth(), 1));
watch(() => props.selectedDate, value => {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isFinite(date.getTime())) month.value = new Date(date.getFullYear(), date.getMonth(), 1);
});
const monthLabel = computed(() => month.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));
const today = computed(() => localDateKey(props.now));
const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: 'short' }));
const days = computed(() => {
  const tasksByDay = new Map<string, DisplayedStudentTask[]>();
  for (const task of props.tasks) { const key = localDateKey(task.due_at); const group = tasksByDay.get(key) || []; group.push(task); tasksByDay.set(key, group); }
  const start = new Date(month.value);
  start.setDate(start.getDate() - start.getDay());
  const length = Math.ceil((month.value.getDay() + new Date(month.value.getFullYear(), month.value.getMonth() + 1, 0).getDate()) / 7) * 7;
  return Array.from({ length }, (_, i) => { const date = new Date(start); date.setDate(start.getDate() + i); const key = localDateKey(date); return { date, key, outside: date.getMonth() !== month.value.getMonth(), tasks: tasksByDay.get(key) || [] }; });
});
function changeMonth(amount: number) { month.value = new Date(month.value.getFullYear(), month.value.getMonth() + amount, 1); emit('select', localDateKey(month.value)); }
function selectDay(date: Date) { month.value = new Date(date.getFullYear(), date.getMonth(), 1); emit('select', localDateKey(date)); }
function goToday() { selectDay(props.now); }
</script>
<style scoped>
.calendar { margin-bottom: 26px; padding: 23px; border: 1px solid var(--campus-border); border-radius: 18px; background: var(--campus-surface); box-shadow: var(--campus-shadow); }
.calendar-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px; }
.calendar-toolbar .eyebrow { margin-bottom: 7px; font-size: 9px; }
.calendar-toolbar h3 { margin: 0; font-size: 23px; font-weight: 600; letter-spacing: -.6px; }
.calendar-navigation { display: flex; gap: 5px; }
.calendar-navigation button { display: grid; place-items: center; width: 44px; min-height: 44px; border: 1px solid var(--campus-border); border-radius: 9px; background: var(--campus-bg); color: var(--campus-text); font-size: 16px; }
.calendar-navigation .today-button { width: auto; padding: 0 13px; font-size: 12px; }
.weekdays, .calendar-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.weekdays { margin-bottom: 8px; text-align: center; font-size: 10px; color: var(--campus-muted); }
.weekdays span { padding: 6px 0; }
.calendar-grid { gap: 5px; }
.calendar-day { position: relative; display: flex; flex-direction: column; align-items: flex-start; gap: 7px; min-width: 0; min-height: 108px; padding: 9px; border: 1px solid var(--campus-border); border-radius: 10px; background: var(--campus-surface); color: var(--campus-text); text-align: left; }
.calendar-day:hover { border-color: var(--ion-color-primary); }
.calendar-day.outside { background: var(--campus-bg); color: var(--campus-muted); }
.calendar-day.selected { border-color: var(--ion-color-primary); background: var(--campus-green-soft); box-shadow: inset 0 0 0 1px var(--ion-color-primary); }
.day-number { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 7px; font-size: 12px; font-weight: 600; }
.today .day-number { background: var(--ion-color-primary); color: var(--ion-color-primary-contrast); }
.day-count { position: absolute; top: 14px; right: 9px; font-size: 9px; color: var(--ion-color-primary); }
.count-word { margin-left: 3px; }
.day-preview { display: flex; flex-direction: column; gap: 5px; width: 100%; }
.day-preview > span { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 4px 5px; border-radius: 4px; font-size: 9px; color: var(--ion-color-primary); background: var(--campus-green-soft); }
.selected .day-preview > span { background: var(--campus-surface); }
.day-preview > span.completed { color: var(--campus-muted); text-decoration: line-through; }
.day-preview small { padding-left: 4px; font-size: 9px; color: var(--campus-muted); }
.calendar-hint { margin: 18px 0 0; font-size: 11px; color: var(--campus-muted); }
@media (max-width: 950px) { .count-word { display: none; } }
@media (max-width: 600px) {
  .calendar { padding: 16px 12px; }
  .calendar-toolbar { gap: 8px; margin-bottom: 18px; }
  .calendar-toolbar h3 { font-size: 18px; }
  .calendar-toolbar .eyebrow { display: none; }
  .calendar-navigation { gap: 3px; }
  .calendar-navigation button { width: 36px; font-size: 15px; }
  .calendar-navigation .today-button { padding: 0 9px; font-size: 11px; }
  .calendar-grid { gap: 3px; }
  .calendar-day { align-items: center; min-height: 66px; padding: 5px 1px; gap: 2px; border-radius: 7px; }
  .day-number { width: 23px; height: 23px; font-size: 11px; }
  .day-count { position: static; display: grid; place-items: center; width: 19px; height: 19px; border-radius: 6px; background: var(--campus-green-soft); font-size: 9px; }
  .day-preview { display: none; }
  .calendar-hint { font-size: 10px; line-height: 1.6; }
}
</style>
