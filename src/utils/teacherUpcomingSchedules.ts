import { addSchoolDays, schoolDateKey, schoolWeekStart } from './studentScheduleCalendar'

type Mode = 'teacher_manual' | 'self_on_site' | 'self_online'
interface Course { id: string; name: string; archived_at?: string | null }
interface Weekly { id: string; class_id: string; day_of_week: number; starts_at: string; ends_at: string; room: string | null; is_active: boolean; attendance_mode: Mode }
interface Meeting { id: string; class_id: string; schedule_id: string | null; starts_at: string; ends_at: string; attendance_enabled: boolean; attendance_mode: Mode }
export interface UpcomingTeacherClass {
  id: string; classId: string; className: string; start: string; end: string
  attendanceMode: Mode; room: string | null; meetingId?: string; scheduleId?: string
}

/** Independent of the calendar's selected week; actual exceptions override repeats. */
export function teacherUpcomingSchedules(input: {
  courses: Course[]; schedules: Weekly[]; meetings: Meeting[]
  exceptions: Array<{ schedule_id: string; schedule_week_start: string }>; now: Date
}): { current: UpcomingTeacherClass[]; next: UpcomingTeacherClass | null } {
  const courses = new Map(input.courses.filter(course => !course.archived_at).map(course => [course.id, course]))
  const schedules = new Map(input.schedules.map(schedule => [schedule.id, schedule]))
  const actual = new Set(input.meetings.filter(meeting => meeting.schedule_id).map(meeting => `${meeting.schedule_id}:${schoolWeekStart(schoolDateKey(new Date(meeting.starts_at)))}`))
  const skipped = new Set(input.exceptions.map(exception => `${exception.schedule_id}:${exception.schedule_week_start}`))
  const items: UpcomingTeacherClass[] = input.meetings.filter(meeting => courses.has(meeting.class_id) && meeting.attendance_enabled).map(meeting => ({
    id: `meeting:${meeting.id}`, classId: meeting.class_id, className: courses.get(meeting.class_id)!.name,
    start: meeting.starts_at, end: meeting.ends_at, attendanceMode: meeting.attendance_mode,
    room: meeting.schedule_id ? schedules.get(meeting.schedule_id)?.room || null : null,
    meetingId: meeting.id, scheduleId: meeting.schedule_id || undefined,
  }))
  const today = schoolDateKey(input.now)
  for (let offset = 0; offset < 8; offset++) {
    const day = addSchoolDays(today, offset)
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
    for (const schedule of input.schedules) {
      const occurrence = `${schedule.id}:${schoolWeekStart(day)}`
      if (!schedule.is_active || !courses.has(schedule.class_id) || schedule.day_of_week !== weekday || actual.has(occurrence) || skipped.has(occurrence)) continue
      items.push({ id: `weekly:${schedule.id}:${day}`, classId: schedule.class_id, className: courses.get(schedule.class_id)!.name,
        start: `${day}T${schedule.starts_at.slice(0, 8)}+08:00`, end: `${day}T${schedule.ends_at.slice(0, 8)}+08:00`,
        attendanceMode: schedule.attendance_mode, room: schedule.room, scheduleId: schedule.id })
    }
  }
  const ordered = items.filter(item => new Date(item.end).getTime() > input.now.getTime())
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime() || a.className.localeCompare(b.className))
  return { current: ordered.filter(item => new Date(item.start).getTime() <= input.now.getTime()),
    next: ordered.find(item => new Date(item.start).getTime() > input.now.getTime()) || null }
}
