import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import ParentCalendarPanel from '@/components/ParentCalendarPanel.vue'
import ScheduleCalendar from '@/components/ScheduleCalendar.vue'
import { useRealtimeRefresh } from '@/composables/useRealtimeRefresh'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/composables/useSession', () => ({ useSession: () => ({ user: { value: { id: 'parent-1' } } }) }))
vi.mock('@/composables/useRealtimeRefresh', () => ({ useRealtimeRefresh: vi.fn() }))

let attendanceEnabled = true
function query(table: string) {
  const result = table === 'class_schedules' ? [{ id: 'schedule-1', class_id: 'class-1', day_of_week: 6, starts_at: '09:00:00', ends_at: '10:00:00', room: 'Room A', is_active: true }]
    : [{ id: 'meeting-1', class_id: 'class-1', schedule_id: 'schedule-1', schedule_week_start: '2026-10-19', meeting_date: '2026-10-24', starts_at: '2026-10-24T01:00:00Z', ends_at: '2026-10-24T02:00:00Z', attendance_enabled: attendanceEnabled }]
  const builder = { select: () => builder, in: () => builder, order: () => builder, gte: () => builder, lt: () => builder, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: result, error: null }).then(resolve) }
  return builder
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T00:00:00Z'))
  attendanceEnabled = true; mocks.from.mockReset().mockImplementation(query)
  mocks.rpc.mockReset().mockResolvedValue({ data: [], error: null })
})

describe('parent class calendar', () => {
  it('uses the student calendar projection without querying private tasks, and updates overrides live', async () => {
    const wrapper = shallowMount(ParentCalendarPanel, { props: { studentId: 'student-1', studentName: 'Student One', courses: [{ id: 'class-1', name: 'Integration' }] } })
    await flushPromises()
    let events = wrapper.findComponent(ScheduleCalendar).props('events')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ title: 'Integration', kind: 'meeting', status: 'scheduled' })
    expect(mocks.from.mock.calls.map(([table]) => table)).toEqual(['class_schedules', 'meetings'])
    expect(mocks.rpc).toHaveBeenCalledWith('visible_schedule_meeting_exceptions', { p_start: '2026-10-19', p_end: '2026-10-26' })
    attendanceEnabled = false
    await vi.mocked(useRealtimeRefresh).mock.calls.at(-1)![0].onChange()
    events = wrapper.findComponent(ScheduleCalendar).props('events')
    expect(events[0].status).toBe('not_counted')
    wrapper.unmount(); vi.useRealTimers()
  })

  it('does not resurrect a deleted weekly occurrence for an approved parent', async () => {
    mocks.from.mockImplementation(table => table === 'meetings' ? { select: () => { const empty = { in: () => empty, gte: () => empty, lt: () => empty, order: () => empty, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve) }; return empty } } : query(table))
    mocks.rpc.mockResolvedValue({ data: [{ schedule_id: 'schedule-1', schedule_week_start: '2026-10-19' }], error: null })
    const wrapper = shallowMount(ParentCalendarPanel, { props: { studentId: 'student-1', studentName: 'Student One', courses: [{ id: 'class-1', name: 'Integration' }] } })
    await flushPromises()
    expect(wrapper.findComponent(ScheduleCalendar).props('events')).toEqual([])
    wrapper.unmount(); vi.useRealTimers()
  })
})
