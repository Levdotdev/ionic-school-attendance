import { describe, expect, it } from 'vitest'

import type { StudentTask } from '@/types/studentTasks'
import {
  compareStudentTasks,
  expandStudentTasks,
  matchesStudentTaskSearch,
  manualStudentTaskOrder,
  mergeStudentTaskOrder,
  nextTaskOccurrence,
  taskGroupLabel,
} from '@/utils/studentTasks'

function task(overrides: Partial<StudentTask> = {}): StudentTask {
  return {
    id: 'task-1',
    student_id: 'student-1',
    class_id: null,
    category_id: null,
    title: 'Read chapter 4',
    description: 'Focus on integration patterns',
    due_at: '2026-10-09T02:00:00.000Z',
    priority: 'medium',
    recurrence: 'none',
    recurrence_until: null,
    reminder_minutes: [30],
    sort_order: 0,
    created_at: '2026-10-08T00:00:00.000Z',
    updated_at: '2026-10-08T00:00:00.000Z',
    course: null,
    category: null,
    links: [],
    files: [],
    occurrences: [],
    ...overrides,
  }
}

describe('student task recurrence', () => {
  it('advances weekday recurrences past weekends', () => {
    const friday = new Date('2026-10-09T08:00:00')
    const next = nextTaskOccurrence(friday, 'weekdays', friday.getDate())
    expect(next.getDay()).toBe(1)
    expect(next.getDate()).toBe(12)
  })

  it('caps monthly recurrence to the last valid day', () => {
    const january31 = new Date('2027-01-31T08:00:00')
    const next = nextTaskOccurrence(january31, 'monthly', 31)
    expect(next.getMonth()).toBe(1)
    expect(next.getDate()).toBe(28)
    const march = nextTaskOccurrence(next, 'monthly', 31)
    expect(march.getMonth()).toBe(2)
    expect(march.getDate()).toBe(31)
  })

  it('uses saved occurrence rows to show complete and skipped instances', () => {
    const recurring = task({
      recurrence: 'daily',
      recurrence_until: '2026-10-11T02:00:00.000Z',
      occurrences: [
        {
          id: 'done',
          task_id: 'task-1',
          due_at: '2026-10-09T02:00:00.000Z',
          status: 'completed',
          completed_at: '2026-10-09T03:00:00.000Z',
          created_at: '2026-10-09T03:00:00.000Z',
          updated_at: '2026-10-09T03:00:00.000Z',
        },
        {
          id: 'skipped',
          task_id: 'task-1',
          due_at: '2026-10-10T02:00:00.000Z',
          status: 'skipped',
          completed_at: null,
          created_at: '2026-10-09T03:00:00.000Z',
          updated_at: '2026-10-09T03:00:00.000Z',
        },
      ],
    })

    const result = expandStudentTasks([recurring], {
      now: new Date('2026-10-09T04:00:00.000Z'),
      windowStart: new Date('2026-10-09T00:00:00.000Z'),
      windowEnd: new Date('2026-10-11T23:59:59.000Z'),
    })

    expect(result).toHaveLength(2)
    expect(result[0].status).toBe('completed')
    expect(result.some((item) => item.due_at.startsWith('2026-10-10'))).toBe(false)
  })

  it('keeps an unfinished original deadline visible outside the generated range', () => {
    const result = expandStudentTasks([task({ recurrence: 'monthly' })], {
      now: new Date('2027-04-10T00:00:00Z'),
      windowStart: new Date('2027-04-01T00:00:00Z'),
      windowEnd: new Date('2027-04-30T23:59:59Z'),
    })
    expect(result.map(item => item.due_at)).toEqual(['2026-10-09T02:00:00.000Z', '2027-04-09T02:00:00.000Z'])
    expect(result[0].status).toBe('overdue')
  })

  it('does not restore a completed future date after that part of a series was removed', () => {
    const result = expandStudentTasks([task({
      recurrence: 'daily', recurrence_until: '2026-10-10T01:59:59.999Z',
      occurrences: [{ id: 'future', task_id: 'task-1', due_at: '2026-10-11T02:00:00.000Z', status: 'completed', completed_at: '2026-10-08T00:00:00Z', created_at: '', updated_at: '' }],
    })], { now: new Date('2026-10-09T00:00:00Z') })
    expect(result.map(item => item.due_at)).toEqual(['2026-10-09T02:00:00.000Z'])
  })

  it('reverting a saved completion only reopens that date', () => {
    const base = task({ recurrence: 'daily', recurrence_until: '2026-10-10T02:00:00.000Z' })
    const state = { id: 'done', task_id: base.id, due_at: base.due_at, status: 'completed' as const, completed_at: '2026-10-09T03:00:00Z', created_at: '', updated_at: '' }
    const options = { now: new Date('2026-10-08T00:00:00Z') }
    const completed = expandStudentTasks([{ ...base, occurrences: [state] }], options)
    const reopened = expandStudentTasks([base], options)
    expect(completed.map(item => item.status)).toEqual(['completed', 'pending'])
    expect(reopened.map(item => item.status)).toEqual(['pending', 'pending'])
    expect(reopened.map(item => item.key)).toEqual(completed.map(item => item.key))
  })
})

describe('student task discovery and sorting', () => {
  it('finds text from courses, links, and files', () => {
    const linked = task({
      course: { id: 'class-1', name: 'System Integration', section: '4-F1' },
      links: [{
        id: 'link-1',
        task_id: 'task-1',
        title: 'Learning guide',
        url: 'https://example.com/guide',
        position: 0,
        created_at: '2026-10-08T00:00:00.000Z',
      }],
      files: [{
        id: 'file-1',
        task_id: 'task-1',
        storage_path: 'student-1/task-1/rubric.pdf',
        file_name: 'rubric.pdf',
        mime_type: 'application/pdf',
        size_bytes: 100,
        position: 0,
        created_at: '2026-10-08T00:00:00.000Z',
      }],
    })
    const [displayed] = expandStudentTasks([linked], { now: new Date('2026-10-08T00:00:00.000Z') })

    expect(matchesStudentTaskSearch(displayed, 'integration guide')).toBe(true)
    expect(matchesStudentTaskSearch(displayed, 'rubric')).toBe(true)
    expect(taskGroupLabel(linked)).toBe('System Integration · 4-F1')
  })

  it('sorts high priority before medium and low', () => {
    const items = expandStudentTasks([
      task({ id: 'medium', priority: 'medium' }),
      task({ id: 'low', priority: 'low' }),
      task({ id: 'high', priority: 'high' }),
    ], { now: new Date('2026-10-08T00:00:00.000Z') })

    items.sort((left, right) => compareStudentTasks(left, right, 'priority'))
    expect(items.map((item) => item.task.priority)).toEqual(['high', 'medium', 'low'])
  })

  it('keeps hidden tasks in place and discards stale or duplicate dragged IDs', () => {
    expect(mergeStudentTaskOrder(['a', 'hidden', 'b', 'c'], ['c', 'b', 'a'])).toEqual(['c', 'hidden', 'b', 'a'])
    expect(mergeStudentTaskOrder(['a', 'hidden', 'b'], ['b', 'b', 'deleted', 'a'])).toEqual(['b', 'hidden', 'a'])
  })

  it('orders equal deadlines by priority and manual order without mutating source data', () => {
    const source = [task({ id: 'a', sort_order: 2, priority: 'low' }), task({ id: 'b', sort_order: 1, priority: 'high' })]
    expect(manualStudentTaskOrder(source).map(item => item.id)).toEqual(['b', 'a'])
    expect(source.map(item => item.id)).toEqual(['a', 'b'])
    const displayed = expandStudentTasks(source)
    displayed.sort((a, b) => compareStudentTasks(a, b, 'due'))
    expect(displayed.map(item => item.task.id)).toEqual(['b', 'a'])
  })
})
