export type StudentTaskPriority = 'low' | 'medium' | 'high'
export type StudentTaskRecurrence = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly'
export type StudentTaskOccurrenceStatus = 'completed' | 'skipped'
export type StudentTaskDisplayStatus = 'pending' | 'completed' | 'overdue'
export type StudentTaskReminderMinutes = 5 | 15 | 30 | 60 | 1440

export interface StudentCourse {
  id: string
  name: string
  section: string | null
}

export interface StudentTaskCategory {
  id: string
  student_id: string
  name: string
  color: string
  created_at: string
  updated_at: string
}

export interface StudentTaskLink {
  id: string
  task_id: string
  title: string
  url: string
  position: number
  created_at: string
}

export interface StudentTaskFile {
  id: string
  task_id: string
  storage_path: string
  file_name: string
  mime_type: string | null
  size_bytes: number
  position: number
  created_at: string
}

export interface StudentTaskOccurrence {
  id: string
  task_id: string
  due_at: string
  status: StudentTaskOccurrenceStatus
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface StudentTask {
  id: string
  student_id: string
  class_id: string | null
  category_id: string | null
  title: string
  description: string
  due_at: string
  priority: StudentTaskPriority
  recurrence: StudentTaskRecurrence
  recurrence_until: string | null
  reminder_minutes: StudentTaskReminderMinutes[]
  sort_order: number
  created_at: string
  updated_at: string
  course: StudentCourse | null
  category: StudentTaskCategory | null
  links: StudentTaskLink[]
  files: StudentTaskFile[]
  occurrences: StudentTaskOccurrence[]
}

export interface StudentTaskLinkDraft {
  id: string
  title: string
  url: string
}

export interface StudentTaskDraft {
  title: string
  description: string
  due_at: string
  priority: StudentTaskPriority
  recurrence: StudentTaskRecurrence
  recurrence_until: string | null
  reminder_minutes: StudentTaskReminderMinutes[]
  class_id: string | null
  category_id: string | null
  links: StudentTaskLinkDraft[]
}

export interface StudentTaskSaveInput extends StudentTaskDraft {
  newFiles: File[]
  removedFileIds: string[]
}

export interface DisplayedStudentTask {
  key: string
  task: StudentTask
  due_at: string
  status: StudentTaskDisplayStatus
  completed_at: string | null
  occurrence: StudentTaskOccurrence | null
}

export const STUDENT_TASK_PRIORITY_OPTIONS: Array<{
  value: StudentTaskPriority
  label: string
}> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

export const STUDENT_TASK_RECURRENCE_OPTIONS: Array<{
  value: StudentTaskRecurrence
  label: string
}> = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

export const STUDENT_TASK_REMINDER_OPTIONS: Array<{
  value: StudentTaskReminderMinutes
  label: string
}> = [
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
  { value: 1440, label: '1 day' },
]
