import type { ClassAttendanceReport } from './classAttendanceReport'

export interface AttendancePdfAssets { regularFont: string; boldFont: string; logoDataUrl?: string }
let assetsPromise: Promise<AttendancePdfAssets> | undefined
function base64(bytes: Uint8Array): string {
  let value = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) value += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(value)
}
async function readAsset(path: string): Promise<Uint8Array> {
  const response = await fetch(path)
  if (!response.ok) throw new Error('The report font could not be loaded. Check your connection and try again.')
  return new Uint8Array(await response.arrayBuffer())
}
export function loadAttendancePdfAssets(): Promise<AttendancePdfAssets> {
  if (!assetsPromise) assetsPromise = Promise.all([
    readAsset('/fonts/NotoSans-Regular.ttf'), readAsset('/fonts/NotoSans-Bold.ttf'),
    readAsset('/minsu-logo.png').catch(() => null),
  ]).then(([regular, bold, logo]) => ({ regularFont: base64(regular), boldFont: base64(bold), logoDataUrl: logo ? `data:image/png;base64,${base64(logo)}` : undefined }))
    .catch(error => { assetsPromise = undefined; throw error })
  return assetsPromise
}

/** A local download: no attendance data is sent to an external PDF service. */
export async function buildClassAttendancePdf(report: ClassAttendanceReport, assets: AttendancePdfAssets): Promise<Uint8Array> {
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true })
  doc.addFileToVFS('NotoSans-Regular.ttf', assets.regularFont)
  doc.addFileToVFS('NotoSans-Bold.ttf', assets.boldFont)
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal')
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold')
  doc.setFont('NotoSans', 'normal')
  doc.setProperties({ title: `Cumulative Attendance - ${report.class_name}`, subject: 'Class attendance totals', author: report.teacher_name, creator: 'MinSU Attendance' })
  const green: [number, number, number] = [32, 85, 60]
  const text: [number, number, number] = [39, 60, 46]
  const muted: [number, number, number] = [91, 105, 95]
  const margin = 14
  const width = 182
  const labelRate = (value: number | null) => value == null ? 'N/A' : `${value.toFixed(2)}%`
  const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  const name = (row: ClassAttendanceReport['students'][number]) => row.last_name ? `${row.last_name}, ${row.first_name}`.replace(/,\s*$/, '') : row.full_name
  const date = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(report.as_of))
  let y = 16
  if (assets.logoDataUrl) doc.addImage(assets.logoDataUrl, 'PNG', margin, 13, 17, 17)
  const titleX = assets.logoDataUrl ? 36 : margin
  doc.setTextColor(...green); doc.setFont('NotoSans', 'bold'); doc.setFontSize(11)
  doc.text('MINDORO STATE UNIVERSITY', titleX, y + 3)
  doc.setTextColor(...text); doc.setFontSize(16); doc.text('Cumulative attendance', titleX, y + 11)
  y = 38
  doc.setFontSize(12)
  const classLines = doc.splitTextToSize(clean(report.class_name), width)
  doc.text(classLines, margin, y); y += classLines.length * 5.8 + 3
  doc.setFont('NotoSans', 'normal'); doc.setFontSize(9); doc.setTextColor(...muted)
  const teacherLines = doc.splitTextToSize(`Teacher: ${clean(report.teacher_name)}`, width)
  doc.text(teacherLines, margin, y); y += teacherLines.length * 4.2 + 2
  doc.text(`As of ${date} (Asia/Manila)`, margin, y); y += 7
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin }, theme: 'plain',
    head: [['Students', 'Counted meetings', 'Present', 'Absent', 'Opportunities', 'Class rate']],
    body: [[String(report.totals.student_count), String(report.meeting_count), String(report.totals.present_count), String(report.totals.absent_count), String(report.totals.total_count), labelRate(report.totals.attendance_rate)]],
    styles: { font: 'NotoSans', fontSize: 8, cellPadding: 2.8, textColor: text, halign: 'center' },
    headStyles: { fillColor: [235, 241, 234], textColor: green, fontStyle: 'bold', fontSize: 7.5 },
    bodyStyles: { fontStyle: 'bold', fontSize: 10 },
  })
  y = (doc as typeof doc & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5
  doc.setFont('NotoSans', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...muted)
  const rules = doc.splitTextToSize('Future and not-counted meetings are excluded. Missing check-ins count as absent only after the meeting and check-in window close. Each student\'s rate uses their own counted opportunities.' + (report.accounting_note ? ` ${clean(report.accounting_note)}` : ''), width)
  doc.text(rules, margin, y); y += rules.length * 3.5 + 5
  doc.setFontSize(8)
  const indexWidth = Math.max(13, doc.getTextWidth(String(Math.max(report.students.length, 1))) + 5)
  autoTable(doc, {
    startY: y, margin: { left: margin, right: margin, top: 40, bottom: 20 }, theme: 'grid',
    head: [['#', 'Student - LAST NAME, FIRST NAME', 'Enrollment', 'Present', 'Absent', 'Counted', 'Rate']],
    body: report.students.length ? report.students.map((row, index) => [String(index + 1), clean(name(row)), row.is_active ? 'ACTIVE' : 'HISTORICAL', String(row.present_count), String(row.absent_count), String(row.total_count), labelRate(row.attendance_rate)]) : [[{ content: 'No students in this class report.', colSpan: 7 }]],
    foot: [['', 'CLASS TOTAL', `${report.totals.student_count} students`, String(report.totals.present_count), String(report.totals.absent_count), String(report.totals.total_count), labelRate(report.totals.attendance_rate)]],
    showHead: 'everyPage', showFoot: 'lastPage', rowPageBreak: 'avoid',
    styles: { font: 'NotoSans', fontSize: 8, cellPadding: 2.4, lineColor: [219, 226, 217], lineWidth: .15, textColor: text, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: green, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7.3 },
    alternateRowStyles: { fillColor: [247, 249, 245] },
    footStyles: { fillColor: [235, 241, 234], textColor: green, fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: indexWidth, halign: 'center' }, 1: { cellWidth: 77 - indexWidth }, 2: { cellWidth: 24, fontSize: 7 }, 3: { cellWidth: 17, halign: 'right' }, 4: { cellWidth: 17, halign: 'right' }, 5: { cellWidth: 21, halign: 'right' }, 6: { cellWidth: 26, halign: 'right' } },
    willDrawPage(data) {
      if (data.pageNumber === 1) return
      doc.setFont('NotoSans', 'bold'); doc.setTextColor(...green); doc.setFontSize(10)
      doc.text('MinSU Attendance - Cumulative report', margin, 15)
      doc.setFont('NotoSans', 'normal'); doc.setFontSize(8); doc.setTextColor(...muted)
      doc.text(doc.splitTextToSize(clean(report.class_name), width).slice(0, 3), margin, 22)
    },
  })
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page); doc.setDrawColor(219, 226, 217); doc.line(margin, 282, 196, 282)
    doc.setFont('NotoSans', 'normal'); doc.setFontSize(7); doc.setTextColor(...muted)
    doc.text('Authorized teacher copy - contains student attendance information', margin, 287)
    doc.text(`Page ${page} of ${pages}`, 196, 287, { align: 'right' })
  }
  return new Uint8Array(doc.output('arraybuffer'))
}
