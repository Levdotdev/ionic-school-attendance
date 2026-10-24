import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ScheduleCalendar, { type CalendarEvent } from '@/components/ScheduleCalendar.vue'

const classes: CalendarEvent[] = [
  { id: 'math', title: 'Mathematics', start: '2026-10-19T00:00:00Z', end: '2026-10-19T01:00:00Z', kind: 'weekly', subtext: 'Room 101' },
  { id: 'science', title: 'Science', start: '2026-10-19T02:00:00Z', end: '2026-10-19T03:00:00Z', kind: 'meeting', status: 'not_counted' },
]

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-24T00:00:00Z')) })
afterEach(() => vi.useRealTimers())

describe('shared class calendar', () => {
  it('combines courses in a Monday-to-Sunday week and opens the selected event', async () => {
    const wrapper = mount(ScheduleCalendar, { props: { events: classes } })
    expect(wrapper.findAll('.calendar-day')).toHaveLength(7)
    expect(wrapper.emitted('rangeChange')?.[0]).toEqual([{ start: '2026-10-19', end: '2026-10-26' }])
    expect(wrapper.text()).toContain('Mathematics')
    expect(wrapper.text()).toContain('Science')
    expect(wrapper.get('.cancelled-event').text()).toContain('Not counted')
    await wrapper.get('.weekly-event').trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([classes[0]])
    wrapper.unmount()
  })

  it('navigates weeks and renders the complete calendar month including adjacent days', async () => {
    const wrapper = mount(ScheduleCalendar, { props: { events: classes, selectedDate: '2026-10-24' } })
    await wrapper.get('[aria-label="Previous calendar period"]').trigger('click')
    expect(wrapper.emitted('dateChange')?.at(-1)).toEqual(['2026-10-17'])
    expect(wrapper.emitted('rangeChange')?.at(-1)).toEqual([{ start: '2026-10-12', end: '2026-10-19' }])
    await wrapper.findAll('.calendar-views button').find(button => button.text() === 'Month')!.trigger('click')
    expect(wrapper.findAll('.calendar-day')).toHaveLength(35)
    expect(wrapper.emitted('rangeChange')?.at(-1)).toEqual([{ start: '2026-09-28', end: '2026-11-02' }])
    expect(wrapper.text()).toContain('October 2026')
    wrapper.unmount()
  })

  it('uses Manila dates at the UTC boundary and exposes an agenda with each weekday', async () => {
    const wrapper = mount(ScheduleCalendar, { props: { events: [{ ...classes[0], start: '2026-10-18T16:30:00Z', end: '2026-10-18T17:30:00Z' }], selectedDate: '2026-10-19', initialView: 'agenda' } })
    const monday = wrapper.findAll('.agenda-day')[0]
    expect(monday.text()).toContain('Mon')
    expect(monday.text()).toContain('Mathematics')
    expect(wrapper.findAll('.agenda-day')).toHaveLength(7)
    await wrapper.get('.agenda-event').trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
    wrapper.unmount()
  })
})
