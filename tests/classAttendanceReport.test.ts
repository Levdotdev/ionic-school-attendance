import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attendanceCsvCell, attendanceReportCsv, attendanceReportFilename, attendanceReportName, loadClassAttendanceReport, validateAttendanceReport, type ClassAttendanceReport } from '@/services/classAttendanceReport'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
const example = (): ClassAttendanceReport => ({
  class_id: 'class-1', class_name: 'INTEGRATION, ARCHITECTURE', teacher_name: 'LANCE BRITO', as_of: '2026-10-25T05:00:00Z', meeting_count: 3,
  totals: { student_count: 2, present_count: 3, absent_count: 2, total_count: 5, attendance_rate: 60 },
  students: [
    { student_id: 'one', first_name: 'MARÍA', last_name: 'DE LA CRUZ', full_name: 'MARÍA DE LA CRUZ', is_active: true, present_count: 2, absent_count: 1, total_count: 3, attendance_rate: 66.67 },
    { student_id: 'two', first_name: 'JOSÉ', last_name: 'PEÑA', full_name: 'JOSÉ PEÑA', is_active: false, present_count: 1, absent_count: 1, total_count: 2, attendance_rate: 50 },
  ],
})
beforeEach(() => vi.clearAllMocks())
describe('cumulative report data and CSV', () => {
  it('requests the protected class-wide report rather than only the visible week', async () => {
    mocks.rpc.mockResolvedValue({ data: example(), error: null })
    expect((await loadClassAttendanceReport('class-1')).totals.total_count).toBe(5)
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('teacher_class_attendance_report', { p_class_id: 'class-1' })
  })
  it('propagates authorization failures and rejects data from another class', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Only the owning teacher can export this class' } })
    await expect(loadClassAttendanceReport('unrelated')).rejects.toMatchObject({ message: 'Only the owning teacher can export this class' })
    expect(() => validateAttendanceReport(example(), 'unrelated')).toThrow('could not be verified')
  })
  it('does not export contradictory counts, duplicate students, or malformed metadata', () => {
    const invalid = example(); invalid.totals.total_count = 0
    expect(() => validateAttendanceReport(invalid, invalid.class_id)).toThrow()
    const duplicate = example(); duplicate.students[1].student_id = duplicate.students[0].student_id
    expect(() => validateAttendanceReport(duplicate, duplicate.class_id)).toThrow()
    const badDate = example(); badDate.as_of = 'not a date'
    expect(() => validateAttendanceReport(badDate, badDate.class_id)).toThrow()
  })
  it('escapes quotes, commas, line breaks, and spreadsheet-formula prefixes safely', () => {
    expect(attendanceCsvCell('A "quoted", name\nsecond line')).toBe('"A ""quoted"", name\nsecond line"')
    for (const value of ['=SUM(1,2)', '+123', '-123', '@command', '  =1+1', '\t=1+1', '\runsafe']) expect(attendanceCsvCell(value)).toBe(`"'${value}"`)
  })
  it('retains accented names, uses a UTF-8 BOM, and includes cumulative totals and rules', () => {
    const csv = attendanceReportCsv(example())
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"DE LA CRUZ","MARÍA","ACTIVE","2","1","3","66.67%"')
    expect(csv).toContain('"PEÑA","JOSÉ","HISTORICAL"')
    expect(csv).toContain('"CLASS TOTAL","2 students","","3","2","5","60.00%"')
    expect(csv).toContain('Sunday')
    expect(csv).toContain('future meetings')
  })
  it('creates a safe filename and last-name-first display with legacy fallback', () => {
    const report = example(); report.class_name = '../../PEÑA / TEST'
    expect(attendanceReportFilename(report, 'pdf')).toBe('minsu-attendance-PENA-TEST-2026-10-25.pdf')
    expect(attendanceReportName(report.students[0])).toBe('DE LA CRUZ, MARÍA')
    expect(attendanceReportName({ first_name: '', last_name: '', full_name: 'LEGACY NAME' })).toBe('LEGACY NAME')
  })
})
