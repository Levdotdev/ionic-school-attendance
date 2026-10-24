import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadAttendanceHistory, loadParentOnlineLocations } from '@/services/attendanceHistory'

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), ranges: [] as Array<{ name: string; from: number; to: number }>, orders: [] as string[] }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: mocks.rpc } }))
beforeEach(() => { vi.clearAllMocks(); mocks.ranges.length = 0; mocks.orders.length = 0 })
function serve(rows: Array<{ id: string }>, onPage?: (page: number) => void) {
  let page = 0
  mocks.rpc.mockImplementation((name: string) => {
    const builder = {
      order: (column: string) => { mocks.orders.push(column); return builder },
      range: async (from: number, to: number) => {
        mocks.ranges.push({ name, from, to }); onPage?.(++page)
        return { data: rows.slice(from, to + 1), error: null }
      },
    }
    return builder
  })
}
describe('complete attendance history pagination', () => {
  it('loads more than the default 1,000 rows with stable inclusive pages', async () => {
    const rows = Array.from({ length: 1203 }, (_, id) => ({ id: `record-${id}` }))
    serve(rows)
    expect(await loadAttendanceHistory('student-1')).toEqual(rows)
    expect(mocks.ranges).toEqual([
      { name: 'student_attendance_history', from: 0, to: 499 },
      { name: 'student_attendance_history', from: 500, to: 999 },
      { name: 'student_attendance_history', from: 1000, to: 1499 },
    ])
    expect(mocks.orders).toEqual(['meeting_starts_at', 'id', 'meeting_starts_at', 'id', 'meeting_starts_at', 'id'])
    expect(mocks.rpc).toHaveBeenCalledWith('student_attendance_history', { p_student_id: 'student-1' })
  })
  it('paginates private parent locations separately without dropping older location evidence', async () => {
    const rows = Array.from({ length: 501 }, (_, id) => ({ id: `location-${id}` }))
    serve(rows)
    expect(await loadParentOnlineLocations('student-1')).toHaveLength(501)
    expect(mocks.ranges.map(r => r.name)).toEqual(['parent_online_attendance_locations', 'parent_online_attendance_locations'])
    expect(mocks.orders).toEqual(['captured_at', 'attendance_id', 'captured_at', 'attendance_id'])
  })
  it('stops and discards a partial history when the account or authorization changes', async () => {
    let current = true
    serve(Array.from({ length: 600 }, (_, id) => ({ id: `record-${id}` })), () => { current = false })
    expect(await loadAttendanceHistory('student-1', () => current)).toEqual([])
    expect(mocks.ranges).toHaveLength(1)
  })
  it('reports a later page failure instead of displaying a truncated history as complete', async () => {
    mocks.rpc.mockImplementation(() => {
      const builder = { order: () => builder, range: async (from: number) => from === 0
        ? { data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null }
        : { data: null, error: { message: 'Link no longer verified' } } }
      return builder
    })
    await expect(loadAttendanceHistory('student-1')).rejects.toEqual({ message: 'Link no longer verified' })
  })
})
