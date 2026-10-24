import { supabase } from '@/lib/supabase'

const PAGE_SIZE = 500

/** Fetch every page explicitly; Supabase otherwise truncates long histories. */
async function allRpcRows<T>(name: string, studentId: string, order: string[], isCurrent: () => boolean): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (!isCurrent()) return []
    let query = supabase.rpc(name, { p_student_id: studentId })
    for (const column of order) query = query.order(column, { ascending: false })
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1)
    if (!isCurrent()) return []
    if (error) throw error
    const page = Array.isArray(data) ? data as T[] : []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

export function loadAttendanceHistory<T>(studentId: string, isCurrent: () => boolean = () => true): Promise<T[]> {
  return allRpcRows<T>('student_attendance_history', studentId, ['meeting_starts_at', 'id'], isCurrent)
}
export function loadParentOnlineLocations<T>(studentId: string, isCurrent: () => boolean = () => true): Promise<T[]> {
  return allRpcRows<T>('parent_online_attendance_locations', studentId, ['captured_at', 'attendance_id'], isCurrent)
}
