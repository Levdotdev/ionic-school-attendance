import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import DayDateInput from '@/components/DayDateInput.vue'

describe('weekday-aware date fields', () => {
  it('shows the selected weekday while keeping a native date/time control', async () => {
    const wrapper = mount(DayDateInput, { props: { modelValue: '2026-10-24T08:30', type: 'datetime-local' }, attrs: { required: true, min: '2026-10-23T00:00', 'aria-label': 'Meeting starts' } })
    expect(wrapper.text()).toContain('Saturday')
    expect(wrapper.find('input').attributes('type')).toBe('datetime-local')
    expect(wrapper.find('input').attributes('required')).toBeDefined()
    expect(wrapper.find('input').attributes('aria-label')).toBe('Meeting starts')
    expect(wrapper.find('input').attributes('aria-describedby')).toBe(wrapper.find('small').attributes('id'))
    await wrapper.find('input').setValue('2026-10-26T09:00')
    expect(wrapper.emitted('update:modelValue')).toEqual([['2026-10-26T09:00']])
    await wrapper.setProps({ modelValue: '2026-10-26T09:00' })
    expect(wrapper.text()).toContain('Monday')
  })
  it('rejects date rollover rather than displaying a misleading weekday', () => {
    const wrapper = mount(DayDateInput, { props: { modelValue: '2026-02-30' } })
    expect(wrapper.text()).toContain('Choose a valid date')
  })
})
