import { describe, expect, it } from 'vitest'
import { teacherUpcomingSchedules } from '@/utils/teacherUpcomingSchedules'

const courses = [{ id: 'a', name: 'INTEGRATION' }, { id: 'b', name: 'DATABASES' }, { id: 'archived', name: 'ARCHIVED', archived_at: '2026-01-01' }]
const weekly = { id: 's1', class_id: 'a', day_of_week: 1, starts_at: '08:00:00', ends_at: '09:00:00', room: 'ROOM 1', is_active: true, attendance_mode: 'teacher_manual' as const }
const now = new Date('2026-10-26T00:30:00Z')
describe('teacher current and next schedule', () => {
  it('shows the current class and earliest next class across all subjects', () => {
    const result = teacherUpcomingSchedules({ courses, schedules: [weekly, { ...weekly, id: 's2', class_id: 'b', starts_at: '10:00:00', ends_at: '11:00:00' }], meetings: [], exceptions: [], now })
    expect(result.current.map(item => item.classId)).toEqual(['a'])
    expect(result.next).toMatchObject({ classId: 'b', start: '2026-10-26T10:00:00+08:00' })
  })
  it('actual edited and cancelled meetings override the repeat rather than duplicating it', () => {
    const result = teacherUpcomingSchedules({ courses, schedules: [weekly], meetings: [{ id: 'cancelled', class_id: 'a', schedule_id: 's1', starts_at: '2026-10-26T00:00:00Z', ends_at: '2026-10-26T01:00:00Z', attendance_enabled: false, attendance_mode: 'teacher_manual' }], exceptions: [], now })
    expect(result.current).toEqual([])
    expect(result.next?.start).toBe('2026-11-02T08:00:00+08:00')
  })
  it('honors deleted-occurrence exceptions and archived/inactive classes', () => {
    const result = teacherUpcomingSchedules({ courses, schedules: [weekly, { ...weekly, id: 'archived-schedule', class_id: 'archived' }, { ...weekly, id: 'inactive', is_active: false }], meetings: [], exceptions: [{ schedule_id: 's1', schedule_week_start: '2026-10-26' }], now })
    expect(result.current).toEqual([])
    expect(result.next?.start).toBe('2026-11-02T08:00:00+08:00')
  })
  it('still finds a one-time next meeting farther away when no weekly schedule exists', () => {
    const result = teacherUpcomingSchedules({ courses, schedules: [], meetings: [{ id: 'event', class_id: 'b', schedule_id: null, starts_at: '2026-12-01T00:00:00Z', ends_at: '2026-12-01T01:00:00Z', attendance_enabled: true, attendance_mode: 'teacher_manual' }], exceptions: [], now })
    expect(result.next?.meetingId).toBe('event')
  })
  it('a class finishing exactly now is no longer current and midnight uses Manila date', () => {
    const result = teacherUpcomingSchedules({ courses, schedules: [weekly], meetings: [], exceptions: [], now: new Date('2026-10-26T01:00:00Z') })
    expect(result.current).toEqual([])
    expect(result.next?.start).toBe('2026-11-02T08:00:00+08:00')
  })
})
