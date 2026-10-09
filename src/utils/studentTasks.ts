import type {
  DisplayedStudentTask,
  StudentTask,
  StudentTaskDisplayStatus,
  StudentTaskRecurrence,
} from '@/types/studentTasks'

const DAY_MS = 86_400_000
const MAX_GENERATED_OCCURRENCES = 10_000

export function toLocalDateTimeInput(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function fromLocalDateTimeInput(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Choose a valid due date and time.')
  return date.toISOString()
}

export function startOfLocalDay(value: Date): Date {
  const result = new Date(value)
  result.setHours(0, 0, 0, 0)
  return result
}

export function endOfLocalDay(value: Date): Date {
  const result = new Date(value)
  result.setHours(23, 59, 59, 999)
  return result
}

export function nextTaskOccurrence(
  value: Date,
  recurrence: StudentTaskRecurrence,
  anchorDay: number,
): Date {
  const next = new Date(value)

  if (recurrence === 'monthly') {
    next.setDate(1)
    next.setMonth(next.getMonth() + 1)
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
    next.setDate(Math.min(anchorDay, lastDay))
    return next
  }

  next.setDate(next.getDate() + (recurrence === 'weekly' ? 7 : 1))
  if (recurrence === 'weekdays') {
    while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1)
  }
  return next
}

function occurrenceStatus(
  task: StudentTask,
  dueAt: string,
  now: Date,
): Pick<DisplayedStudentTask, 'status' | 'completed_at' | 'occurrence'> | null {
  const dueTime = new Date(dueAt).getTime()
  const state = task.occurrences.find(
    (item) => Math.abs(new Date(item.due_at).getTime() - dueTime) < 1000,
  ) ?? null

  if (state?.status === 'skipped') return null
  if (state?.status === 'completed') {
    return { status: 'completed', completed_at: state.completed_at, occurrence: state }
  }
  return {
    status: dueTime < now.getTime() ? 'overdue' : 'pending',
    completed_at: null,
    occurrence: null,
  }
}

function displayed(task: StudentTask, dueAt: string, now: Date): DisplayedStudentTask | null {
  const state = occurrenceStatus(task, dueAt, now)
  if (!state) return null
  return {
    key: `${task.id}:${new Date(dueAt).toISOString()}`,
    task,
    due_at: new Date(dueAt).toISOString(),
    ...state,
  }
}

/**
 * Expands recurring task series only inside a bounded dashboard window. Saved
 * completion exceptions are also included, even if they sit just outside the
 * generated window, so recent work never disappears after refresh.
 */
export function expandStudentTasks(
  tasks: StudentTask[],
  options: {
    now?: Date
    windowStart?: Date
    windowEnd?: Date
  } = {},
): DisplayedStudentTask[] {
  const now = options.now ?? new Date()
  const defaultStart = new Date(now.getTime() - 31 * DAY_MS)
  const defaultEnd = new Date(now.getTime() + 90 * DAY_MS)
  const windowStart = options.windowStart ?? defaultStart
  const windowEnd = options.windowEnd ?? defaultEnd
  const result = new Map<string, DisplayedStudentTask>()

  for (const task of tasks) {
    const base = new Date(task.due_at)
    if (Number.isNaN(base.getTime())) continue

    if (task.recurrence === 'none') {
      const item = displayed(task, task.due_at, now)
      if (item) result.set(item.key, item)
      continue
    }

    const anchorDay = base.getDate()
    const recurrenceEnd = task.recurrence_until
      ? new Date(task.recurrence_until)
      : windowEnd
    let occurrence = new Date(base)
    let generated = 0

    while (occurrence < windowStart && generated < MAX_GENERATED_OCCURRENCES) {
      occurrence = nextTaskOccurrence(occurrence, task.recurrence, anchorDay)
      generated += 1
    }

    while (
      occurrence <= windowEnd
      && occurrence <= recurrenceEnd
      && generated < MAX_GENERATED_OCCURRENCES
    ) {
      const item = displayed(task, occurrence.toISOString(), now)
      if (item) result.set(item.key, item)
      occurrence = nextTaskOccurrence(occurrence, task.recurrence, anchorDay)
      generated += 1
    }

    for (const state of task.occurrences) {
      if (state.status !== 'completed') continue
      const item = displayed(task, state.due_at, now)
      if (item) result.set(item.key, item)
    }
  }

  return [...result.values()]
}

export function taskGroupLabel(task: StudentTask): string {
  if (task.course) return task.course.section
    ? `${task.course.name} · ${task.course.section}`
    : task.course.name
  return task.category?.name ?? 'No course or category'
}

export function matchesStudentTaskSearch(item: DisplayedStudentTask, query: string): boolean {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return true
  const haystack = [
    item.task.title,
    item.task.description,
    taskGroupLabel(item.task),
    ...item.task.links.flatMap((link) => [link.title, link.url]),
    ...item.task.files.map((file) => file.file_name),
  ].join(' ').toLocaleLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export function compareStudentTasks(
  left: DisplayedStudentTask,
  right: DisplayedStudentTask,
  sort: 'due' | 'priority' | 'newest',
): number {
  if (sort === 'priority') {
    const rank = { high: 0, medium: 1, low: 2 }
    return rank[left.task.priority] - rank[right.task.priority]
      || left.due_at.localeCompare(right.due_at)
  }
  if (sort === 'newest') {
    return right.task.created_at.localeCompare(left.task.created_at)
      || left.due_at.localeCompare(right.due_at)
  }
  return left.due_at.localeCompare(right.due_at)
}

export function taskStatusLabel(status: StudentTaskDisplayStatus): string {
  if (status === 'completed') return 'Completed'
  if (status === 'overdue') return 'Overdue'
  return 'Pending'
}

export function recurrenceLabel(recurrence: StudentTaskRecurrence): string {
  if (recurrence === 'weekdays') return 'Every weekday'
  if (recurrence === 'daily') return 'Daily'
  if (recurrence === 'weekly') return 'Weekly'
  if (recurrence === 'monthly') return 'Monthly'
  return 'Does not repeat'
}
