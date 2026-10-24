import type { CalendarEvent } from '@/components/ScheduleCalendar.vue'
import type { StudentTask } from '@/types/studentTasks'
import { expandStudentTasks } from '@/utils/studentTasks'

export interface ScheduleCourse { id: string; name: string; archived_at?: string | null }
export interface StudentWeeklySchedule {
  id: string; class_id: string; day_of_week: number; starts_at: string; ends_at: string
  room: string | null; is_active: boolean; attendance_mode?: string
  check_in_minutes_before?: number; check_in_minutes_after_start?: number | null
}
export interface StudentCalendarMeeting {
  id: string; class_id: string; schedule_id: string | null; schedule_week_start?: string | null
  title: string; meeting_date: string; starts_at: string; ends_at: string; attendance_enabled: boolean
}
export interface StudentCalendarEvent extends CalendarEvent {
  meetingId?: string; scheduleId?: string; taskId?: string; taskDue?: string
}
export interface ScheduleException { schedule_id: string; schedule_week_start: string }
export function schoolDateKey(value: Date = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value).map(p => [p.type, p.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}
export function addSchoolDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
export function schoolWeekStart(day: string): string {
  return addSchoolDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))
}
export function currentSchoolWeek() {
  const start = schoolWeekStart(schoolDateKey())
  return { start, end: addSchoolDays(start, 7) }
}
export function makeStudentCalendarEvents(options: {
  courses: ScheduleCourse[]; schedules: StudentWeeklySchedule[]; meetings: StudentCalendarMeeting[]
  exceptions: ScheduleException[]; tasks: StudentTask[]; range: { start: string; end: string }; now?: Date
}): StudentCalendarEvent[] {
  const courses = new Map(options.courses.filter(c => !c.archived_at).map(c => [c.id, c]))
  const skipped = new Set(options.exceptions.map(x => `${x.schedule_id}:${x.schedule_week_start}`))
  const actual = new Set(options.meetings.filter(m => m.schedule_id).map(m => `${m.schedule_id}:${m.schedule_week_start || schoolWeekStart(m.meeting_date)}`))
  const events: StudentCalendarEvent[] = options.meetings.filter(m => courses.has(m.class_id)).map(m => ({
    id: `meeting:${m.id}`, meetingId: m.id, scheduleId: m.schedule_id || undefined, title: m.title,
    start: m.starts_at, end: m.ends_at, kind: 'meeting', className: courses.get(m.class_id)!.name,
    status: m.attendance_enabled ? 'scheduled' : 'not_counted', subtext: m.attendance_enabled ? 'Class meeting' : 'Not counted',
  }))
  for (let day = options.range.start; day < options.range.end; day = addSchoolDays(day, 1)) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    for (const s of options.schedules) {
      const key = `${s.id}:${schoolWeekStart(day)}`
      if (!s.is_active || !courses.has(s.class_id) || s.day_of_week !== weekday || actual.has(key) || skipped.has(key)) continue
      events.push({ id: `weekly:${s.id}:${day}`, scheduleId: s.id, title: courses.get(s.class_id)!.name,
        className: courses.get(s.class_id)!.name, start: `${day}T${s.starts_at.slice(0, 8)}+08:00`,
        end: `${day}T${s.ends_at.slice(0, 8)}+08:00`, kind: 'weekly', status: 'scheduled', subtext: s.room || 'Weekly class' })
    }
  }
  const start = new Date(`${options.range.start}T00:00:00+08:00`)
  const end = new Date(new Date(`${options.range.end}T00:00:00+08:00`).getTime() - 1)
  for (const item of expandStudentTasks(options.tasks, { now: options.now, windowStart: start, windowEnd: end })) {
    const day = schoolDateKey(new Date(item.due_at))
    if (day < options.range.start || day >= options.range.end) continue
    events.push({ id: `task:${item.key}`, taskId: item.task.id, taskDue: item.due_at, title: item.task.title,
      start: item.due_at, end: item.due_at, kind: 'task', className: item.task.course?.name || item.task.category?.name || 'Personal task',
      status: item.status, color: item.task.category?.color || '#b48a1c', subtext: item.status === 'completed' ? 'Task completed' : item.status === 'overdue' ? 'Task overdue' : 'Task due' })
  }
  return events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || a.title.localeCompare(b.title))
}
