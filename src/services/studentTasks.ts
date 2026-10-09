import { supabase } from '@/lib/supabase'
import type {
  StudentCourse,
  StudentTask,
  StudentTaskCategory,
  StudentTaskFile,
  StudentTaskLink,
  StudentTaskOccurrence,
  StudentTaskSaveInput,
} from '@/types/studentTasks'

const TASK_FILE_BUCKET = 'student-task-files'
const MAX_TASK_FILE_SIZE = 5 * 1024 * 1024
const ACCEPTED_TASK_FILE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
])

interface TaskQueryRow {
  id: string
  student_id: string
  class_id: string | null
  category_id: string | null
  title: string
  description: string
  due_at: string
  priority: StudentTask['priority']
  recurrence: StudentTask['recurrence']
  recurrence_until: string | null
  reminder_minutes: number[]
  sort_order: number
  created_at: string
  updated_at: string
  course: StudentCourse | StudentCourse[] | null
  category: StudentTaskCategory | StudentTaskCategory[] | null
  links: StudentTaskLink[] | null
  files: StudentTaskFile[] | null
  occurrences: StudentTaskOccurrence[] | null
}

interface EnrollmentQueryRow {
  class: StudentCourse | StudentCourse[] | null
}

function singleRelation<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value
}

function normalizeTask(row: TaskQueryRow): StudentTask {
  return {
    ...row,
    reminder_minutes: row.reminder_minutes as StudentTask['reminder_minutes'],
    course: singleRelation(row.course),
    category: singleRelation(row.category),
    links: [...(row.links ?? [])].sort((a, b) => a.position - b.position),
    files: [...(row.files ?? [])].sort((a, b) => a.position - b.position),
    occurrences: row.occurrences ?? [],
  }
}

function cleanFileName(name: string): string {
  const normalized = name.normalize('NFKC').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return normalized.slice(0, 120) || 'attachment'
}

function validateFile(file: File): void {
  if (file.size < 1 || file.size > MAX_TASK_FILE_SIZE) {
    throw new Error(`${file.name} must be smaller than 5 MB.`)
  }
  if (!ACCEPTED_TASK_FILE_TYPES.has(file.type)) {
    throw new Error(`${file.name} is not a supported file type.`)
  }
}

function taskPayload(studentId: string, input: StudentTaskSaveInput) {
  return {
    student_id: studentId,
    class_id: input.class_id,
    category_id: input.category_id,
    title: input.title.trim(),
    description: input.description.trim(),
    due_at: input.due_at,
    priority: input.priority,
    recurrence: input.recurrence,
    recurrence_until: input.recurrence === 'none' ? null : input.recurrence_until,
    reminder_minutes: [...new Set(input.reminder_minutes)].sort((a, b) => a - b),
  }
}

async function replaceTaskLinks(taskId: string, links: StudentTaskSaveInput['links']): Promise<void> {
  const { error: deleteError } = await supabase
    .from('student_task_links')
    .delete()
    .eq('task_id', taskId)
  if (deleteError) throw deleteError

  const rows = links
    .map((link, position) => ({
      task_id: taskId,
      title: link.title.trim(),
      url: link.url.trim(),
      position,
    }))
    .filter((link) => link.title && link.url)

  if (!rows.length) return
  const { error } = await supabase.from('student_task_links').insert(rows)
  if (error) throw error
}

async function removeTaskFiles(files: StudentTaskFile[]): Promise<void> {
  if (!files.length) return
  const paths = files.map((file) => file.storage_path)
  const { error: storageError } = await supabase.storage.from(TASK_FILE_BUCKET).remove(paths)
  if (storageError) throw storageError

  const { error: metadataError } = await supabase
    .from('student_task_files')
    .delete()
    .in('id', files.map((file) => file.id))
  if (metadataError) throw metadataError
}

async function uploadTaskFiles(
  studentId: string,
  taskId: string,
  files: File[],
  startingPosition: number,
): Promise<void> {
  const uploadedPaths: string[] = []

  try {
    for (const [offset, file] of files.entries()) {
      validateFile(file)
      const path = `${studentId}/${taskId}/${crypto.randomUUID()}-${cleanFileName(file.name)}`
      const { error: uploadError } = await supabase.storage
        .from(TASK_FILE_BUCKET)
        .upload(path, file, { cacheControl: '3600', contentType: file.type, upsert: false })
      if (uploadError) throw uploadError
      uploadedPaths.push(path)

      const { error: metadataError } = await supabase.from('student_task_files').insert({
        task_id: taskId,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        size_bytes: file.size,
        position: startingPosition + offset,
      })
      if (metadataError) throw metadataError
    }
  } catch (error) {
    if (uploadedPaths.length) {
      await supabase.storage.from(TASK_FILE_BUCKET).remove(uploadedPaths)
      await supabase.from('student_task_files').delete().in('storage_path', uploadedPaths)
    }
    throw error
  }
}

export async function loadStudentTaskData(studentId: string): Promise<{
  tasks: StudentTask[]
  courses: StudentCourse[]
  categories: StudentTaskCategory[]
}> {
  const [taskResult, categoryResult, enrollmentResult] = await Promise.all([
    supabase
      .from('student_tasks')
      .select(`
        id, student_id, class_id, category_id, title, description, due_at,
        priority, recurrence, recurrence_until, reminder_minutes, sort_order,
        created_at, updated_at,
        course:classes!student_tasks_class_id_fkey(id, name, section),
        category:student_task_categories!student_tasks_category_id_fkey(
          id, student_id, name, color, created_at, updated_at
        ),
        links:student_task_links(id, task_id, title, url, position, created_at),
        files:student_task_files(
          id, task_id, storage_path, file_name, mime_type, size_bytes, position, created_at
        ),
        occurrences:student_task_occurrences(
          id, task_id, due_at, status, completed_at, created_at, updated_at
        )
      `)
      .eq('student_id', studentId)
      .order('due_at', { ascending: true }),
    supabase
      .from('student_task_categories')
      .select('id, student_id, name, color, created_at, updated_at')
      .eq('student_id', studentId)
      .order('name', { ascending: true }),
    supabase
      .from('class_enrollments')
      .select('class:classes(id, name, section)')
      .eq('student_id', studentId)
      .eq('is_active', true),
  ])

  if (taskResult.error) throw taskResult.error
  if (categoryResult.error) throw categoryResult.error
  if (enrollmentResult.error) throw enrollmentResult.error

  const enrollmentRows = (enrollmentResult.data ?? []) as unknown as EnrollmentQueryRow[]
  const courses = enrollmentRows
    .flatMap((row) => {
      const course = singleRelation(row.class)
      return course ? [course] : []
    })
    .sort((a: StudentCourse, b: StudentCourse) => a.name.localeCompare(b.name))

  return {
    tasks: ((taskResult.data ?? []) as unknown as TaskQueryRow[]).map(normalizeTask),
    categories: (categoryResult.data ?? []) as StudentTaskCategory[],
    courses,
  }
}

export async function createStudentTask(
  studentId: string,
  input: StudentTaskSaveInput,
): Promise<string> {
  const { data, error } = await supabase
    .from('student_tasks')
    .insert(taskPayload(studentId, input))
    .select('id')
    .single()
  if (error) throw error

  try {
    await replaceTaskLinks(data.id, input.links)
    await uploadTaskFiles(studentId, data.id, input.newFiles, 0)
    return data.id
  } catch (saveError) {
    await supabase.from('student_tasks').delete().eq('id', data.id)
    throw saveError
  }
}

export async function updateStudentTask(
  studentId: string,
  task: StudentTask,
  input: StudentTaskSaveInput,
): Promise<void> {
  const { error } = await supabase
    .from('student_tasks')
    .update(taskPayload(studentId, input))
    .eq('id', task.id)
    .eq('student_id', studentId)
  if (error) throw error

  await replaceTaskLinks(task.id, input.links)

  const removedFiles = task.files.filter((file) => input.removedFileIds.includes(file.id))
  await removeTaskFiles(removedFiles)
  await uploadTaskFiles(
    studentId,
    task.id,
    input.newFiles,
    task.files.length - removedFiles.length,
  )
}

export async function deleteStudentTask(task: StudentTask): Promise<void> {
  await removeTaskFiles(task.files)
  const { error } = await supabase.from('student_tasks').delete().eq('id', task.id)
  if (error) throw error
}

export async function completeStudentTaskOccurrence(taskId: string, dueAt: string): Promise<void> {
  const { error } = await supabase.from('student_task_occurrences').upsert(
    {
      task_id: taskId,
      due_at: dueAt,
      status: 'completed',
      completed_at: new Date().toISOString(),
    },
    { onConflict: 'task_id,due_at' },
  )
  if (error) throw error
}

export async function reopenStudentTaskOccurrence(taskId: string, dueAt: string): Promise<void> {
  const { error } = await supabase
    .from('student_task_occurrences')
    .delete()
    .eq('task_id', taskId)
    .eq('due_at', dueAt)
  if (error) throw error
}

export async function createStudentTaskCategory(
  studentId: string,
  name: string,
  color: string,
): Promise<void> {
  const { error } = await supabase.from('student_task_categories').insert({
    student_id: studentId,
    name: name.trim(),
    color,
  })
  if (error) throw error
}

export async function updateStudentTaskCategory(
  categoryId: string,
  name: string,
  color: string,
): Promise<void> {
  const { error } = await supabase
    .from('student_task_categories')
    .update({ name: name.trim(), color })
    .eq('id', categoryId)
  if (error) throw error
}

export async function deleteStudentTaskCategory(categoryId: string): Promise<void> {
  const { error } = await supabase.from('student_task_categories').delete().eq('id', categoryId)
  if (error) throw error
}

export async function createTaskFileDownloadUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(TASK_FILE_BUCKET).createSignedUrl(path, 60)
  if (error) throw error
  return data.signedUrl
}
