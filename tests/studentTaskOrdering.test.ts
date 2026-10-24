import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StudentTask, StudentTaskSaveInput } from '@/types/studentTasks'
import { manualStudentTaskOrder } from '@/utils/studentTasks'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }))
import { createStudentTask, updateStudentTask } from '@/services/studentTasks'

function task(id: string, sortOrder: number): StudentTask {
  return { id, student_id: 'student', class_id: null, category_id: null, title: id, description: '',
    due_at: '2026-10-24T02:00:00Z', priority: 'medium', recurrence: 'none', recurrence_until: null,
    reminder_minutes: [], sort_order: sortOrder, created_at: '', updated_at: '',
    course: null, category: null, links: [], files: [], occurrences: [] }
}
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('saved manual task order', () => {
  it('appends a new task after an existing manual order and preserves its position when edited', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T02:00:00Z'))
    const saved: StudentTask[] = [task('second-created', 0), task('first-created', 1)]
    mocks.from.mockImplementation(table => {
      if (table === 'student_task_links') return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      if (table !== 'student_tasks') throw new Error(`Unexpected table ${table}`)
      return {
        insert: (payload: Partial<StudentTask>) => {
          saved.push({ ...task('new-task', 0), ...payload })
          return { select: () => ({ single: async () => ({ data: { id: 'new-task' }, error: null }) }) }
        },
        update: (payload: Partial<StudentTask>) => ({ eq: () => ({ eq: async () => {
          Object.assign(saved[2], payload)
          return { error: null }
        } }) }),
      }
    })
    const draft: StudentTaskSaveInput = {
      title: 'New task', description: '', due_at: '2026-10-24T02:00:00Z', priority: 'medium',
      recurrence: 'none', recurrence_until: null, reminder_minutes: [], class_id: null,
      category_id: null, links: [], newFiles: [], removedFileIds: [],
    }
    await createStudentTask('student', draft)
    expect(manualStudentTaskOrder(saved).map(item => item.id)).toEqual(['second-created', 'first-created', 'new-task'])
    await updateStudentTask('student', saved[2], { ...draft, title: 'Edited title' })
    expect(saved[2].title).toBe('Edited title')
    expect(manualStudentTaskOrder(saved).map(item => item.id)).toEqual(['second-created', 'first-created', 'new-task'])
  })
})
