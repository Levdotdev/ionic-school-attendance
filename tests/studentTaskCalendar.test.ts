import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TaskCalendar from '@/components/student-tasks/TaskCalendar.vue'
import { expandStudentTasks } from '@/utils/studentTasks'
import type { StudentTask } from '@/types/studentTasks'

function calendar(selectedDate = '2026-10-24', tasks: StudentTask[] = []) {
  return mount(TaskCalendar, {
    props: { selectedDate, tasks: expandStudentTasks(tasks), now: new Date('2026-10-24T12:00:00') },
    global: { stubs: { IonIcon: true } },
  })
}
describe('task calendar navigation', () => {
  it('renders complete weeks, marks selected/today and rolls across the year', async () => {
    const wrapper = calendar('2026-12-24')
    expect(wrapper.findAll('.calendar-day').length % 7).toBe(0)
    expect(wrapper.find('.calendar-day.selected .day-number').text()).toBe('24')
    await wrapper.find('[aria-label="Next month"]').trigger('click')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['2027-01-01'])
    expect(wrapper.find('.calendar-toolbar h3').text()).toContain('2027')
    await wrapper.find('.today-button').trigger('click')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['2026-10-24'])
    expect(wrapper.find('.calendar-day.today .day-number').text()).toBe('24')
  })

  it('follows an external selection such as opening a reminder', async () => {
    const wrapper = calendar()
    await wrapper.setProps({ selectedDate: '2027-02-01' })
    expect(wrapper.find('.calendar-toolbar h3').text()).toContain('2027')
    expect(wrapper.findAll('.calendar-day')).toHaveLength(35)
    expect(wrapper.find('.calendar-day.selected .day-number').text()).toBe('1')
  })
})
