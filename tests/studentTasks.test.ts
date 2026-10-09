import { describe, expect, it } from 'vitest'

import type { StudentTask } from '@/types/studentTasks'
import {
  compareStudentTasks,
  expandStudentTasks,
  matchesStudentTaskSearch,
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
})
