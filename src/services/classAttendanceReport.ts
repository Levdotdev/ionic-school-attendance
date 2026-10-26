import { supabase } from '@/lib/supabase'
import { Capacitor } from '@capacitor/core'

export interface ClassAttendanceStudent {
  student_id: string; first_name: string; last_name: string; full_name: string; is_active: boolean
  present_count: number; absent_count: number; total_count: number; attendance_rate: number | null
}
export interface ClassAttendanceReport {
  class_id: string; class_name: string; teacher_name: string; as_of: string; meeting_count: number
  accounting_note?: string
  students: ClassAttendanceStudent[]
  totals: { student_count: number; present_count: number; absent_count: number; total_count: number; attendance_rate: number | null }
}
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const rate = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100)
export function validateAttendanceReport(value: unknown, classId: string): ClassAttendanceReport {
  const report = value as ClassAttendanceReport | null
  const invalid = () => { throw new Error('The attendance report could not be verified. Please try again.') }
  if (!report || report.class_id !== classId || typeof report.class_name !== 'string' || typeof report.teacher_name !== 'string'
    || !Number.isFinite(Date.parse(report.as_of)) || !count(report.meeting_count) || !Array.isArray(report.students) || !report.totals
    || (report.accounting_note !== undefined && typeof report.accounting_note !== 'string')) return invalid()
  const seen = new Set<string>()
  for (const row of report.students) {
    if (!row || typeof row.student_id !== 'string' || seen.has(row.student_id) || typeof row.first_name !== 'string' || typeof row.last_name !== 'string'
      || typeof row.full_name !== 'string' || typeof row.is_active !== 'boolean' || !count(row.present_count) || !count(row.absent_count)
      || !count(row.total_count) || row.present_count + row.absent_count !== row.total_count || !rate(row.attendance_rate)) return invalid()
    seen.add(row.student_id)
  }
  const totals = report.totals
  if (!count(totals.student_count) || totals.student_count !== report.students.length || !rate(totals.attendance_rate)) return invalid()
  for (const field of ['present_count', 'absent_count', 'total_count'] as const) {
    if (!count(totals[field]) || report.students.reduce((sum, row) => sum + row[field], 0) !== totals[field]) return invalid()
  }
  return report
}
export async function loadClassAttendanceReport(classId: string): Promise<ClassAttendanceReport> {
  const { data, error } = await supabase.rpc('teacher_class_attendance_report', { p_class_id: classId })
  if (error) throw error
  return validateAttendanceReport(data, classId)
}
export function attendanceReportName(row: Pick<ClassAttendanceStudent, 'first_name' | 'last_name' | 'full_name'>): string {
  return row.last_name ? `${row.last_name}, ${row.first_name}`.replace(/,\s*$/, '') : row.full_name
}
export function attendanceRateLabel(value: number | null): string { return value == null ? 'Not applicable' : `${value.toFixed(2)}%` }
/** Quoting alone does not stop spreadsheet formulas; neutralize text first. */
export function attendanceCsvCell(value: unknown): string {
  let text = String(value ?? '')
  if (/^[\t\r\n]/.test(text) || /^[=+\-@]/.test(text.trimStart())) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}
export function attendanceReportCsv(report: ClassAttendanceReport): string {
  const rows: unknown[][] = [
    ['MINDORO STATE UNIVERSITY - CUMULATIVE ATTENDANCE'], ['Class', report.class_name], ['Teacher', report.teacher_name],
    ['As of (Asia/Manila)', new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(report.as_of))],
    ['Counted meetings', report.meeting_count], [],
    ['Last name', 'First name', 'Enrollment', 'Present', 'Absent', 'Counted opportunities', 'Attendance rate'],
    ...report.students.map(row => [row.last_name, row.first_name || row.full_name, row.is_active ? 'ACTIVE' : 'HISTORICAL', row.present_count, row.absent_count, row.total_count, attendanceRateLabel(row.attendance_rate)]),
    [], ['CLASS TOTAL', `${report.totals.student_count} students`, '', report.totals.present_count, report.totals.absent_count, report.totals.total_count, attendanceRateLabel(report.totals.attendance_rate)],
    [], ['Cancelled/not-counted and future meetings are excluded. Missing attendance becomes absent only after the meeting and check-in window close. Rates use each student\'s counted opportunities.'],
  ]
  return '\uFEFF' + rows.map(row => row.map(attendanceCsvCell).join(',')).join('\r\n') + '\r\n'
}
export function attendanceReportFilename(report: ClassAttendanceReport, extension: 'pdf' | 'csv'): string {
  const name = report.class_name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'class'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(report.as_of)).map(part => [part.type, part.value]))
  return `minsu-attendance-${name}-${parts.year}-${parts.month}-${parts.day}.${extension}`
}
export async function downloadAttendanceBlob(blob: Blob, filename: string, isCurrent: () => boolean = () => true): Promise<'download' | 'share'> {
  if (!/^minsu-attendance-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.(pdf|csv)$/i.test(filename)) throw new Error('The report filename is invalid.')
  const check = () => { if (!isCurrent()) throw new Error('Your account changed. No report was shared.') }
  check()
  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')])
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result.split(',')[1]) : reject(new Error('The report file could not be prepared.'))
      reader.onerror = () => reject(new Error('The report file could not be prepared.'))
      reader.readAsDataURL(blob)
    })
    check()
    // App-private cache only. Saving/sharing to another app requires the user
    // to choose a destination in the native sheet; no recipient is prefilled.
    const folder = `attendance-reports/${crypto.randomUUID()}`
    const path = `${folder}/${filename}`
    const file = await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true })
    const remove = async () => {
      await Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => undefined)
      await Filesystem.rmdir({ path: folder, directory: Directory.Cache }).catch(() => undefined)
    }
    try { check(); await Share.share({ title: 'MinSU class attendance report', dialogTitle: 'Save or share attendance report', files: [file.uri] }) }
    catch (error) { await remove(); throw error }
    // Keep the grant usable while the chosen recipient reads the file. This
    // is a temporary cache copy, not public/external device storage.
    setTimeout(() => { void remove() }, 60 * 60 * 1000)
    return 'share'
  }
  check()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = filename; anchor.rel = 'noopener'
  document.body.appendChild(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return 'download'
}
