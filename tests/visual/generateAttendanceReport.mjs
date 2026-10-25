/** Local rendering check: synthetic data only, never connects to Supabase. */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { buildClassAttendancePdf } from '../../src/services/classAttendancePdf.ts'

const students = Array.from({ length: 180 }, (_, index) => {
  const first_name = index === 0 ? 'MARÍA JOSÉ' : index % 7 === 0 ? 'ALEXANDER GABRIEL MAXIMILIANO' : `SAMPLE STUDENT ${index + 1}`
  const last_name = index === 0 ? 'DELA PEÑA' : index % 7 === 0 ? 'DE LOS SANTOS-VILLANUEVA' : `TEST SURNAME ${String(index + 1).padStart(3, '0')}`
  const present_count = index % 13
  return { student_id: `sample-${index}`, first_name, last_name, full_name: `${first_name} ${last_name}`, is_active: index % 9 !== 0, present_count, absent_count: 12 - present_count, total_count: 12, attendance_rate: present_count / 12 * 100 }
}).sort((a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name))
const present_count = students.reduce((sum, row) => sum + row.present_count, 0)
const total_count = students.length * 12
const report = { class_id: 'local-qa-only', class_name: 'QA SAMPLE - SYSTEM INTEGRATION AND ARCHITECTURE WITH EXTENDED COURSE LABEL', teacher_name: 'SAMPLE TEACHER - NO REAL STUDENT INFORMATION', as_of: '2026-10-25T02:00:00Z', meeting_count: 12, students, totals: { student_count: students.length, present_count, absent_count: total_count - present_count, total_count, attendance_rate: present_count / total_count * 100 } }
const [regular, bold, logo] = await Promise.all(['public/fonts/NotoSans-Regular.ttf', 'public/fonts/NotoSans-Bold.ttf', 'public/minsu-logo.png'].map(path => readFile(resolve(path))))
const pdf = await buildClassAttendancePdf(report, { regularFont: regular.toString('base64'), boldFont: bold.toString('base64'), logoDataUrl: `data:image/png;base64,${logo.toString('base64')}` })
await mkdir(resolve('tmp/pdfs'), { recursive: true })
const path = resolve('tmp/pdfs/attendance-report-qa.pdf')
await writeFile(path, pdf)
console.log(JSON.stringify({ path, bytes: pdf.length, sampleStudents: students.length, realData: false }))
