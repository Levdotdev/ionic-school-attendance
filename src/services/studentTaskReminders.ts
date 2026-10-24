import { Capacitor } from '@capacitor/core'
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications'
import type { StudentTask } from '@/types/studentTasks'
import { expandStudentTasks } from '@/utils/studentTasks'

const CHANNEL = 'student-task-reminders'
const KIND = 'student-task-reminder'

export interface TaskReminderState {
  native: boolean
  granted: boolean
  scheduled: number
  deferred: number
}
export const isNativeTaskReminders = () => Capacitor.isNativePlatform()
let latestSync = 0
let notificationWrites: Promise<void> = Promise.resolve()

/** Keep cancellation behind an in-flight native schedule, including logout. */
function writeNotifications<T>(work: () => Promise<T>): Promise<T> {
  const result = notificationWrites.then(work)
  notificationWrites = result.then(() => undefined, () => undefined)
  return result
}

async function removePendingTaskReminders(): Promise<void> {
  const pending = await LocalNotifications.getPending()
  const notifications = pending.notifications.filter(item => item.extra?.kind === KIND).map(({ id }) => ({ id }))
  if (notifications.length) await LocalNotifications.cancel({ notifications })
}

function reminderId(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  // Keep task IDs in a separate upper range from their own hash duplicates.
  return (hash >>> 0) % 1_000_000_000 + 1_000_000_000
}

export async function cancelStudentTaskReminders(): Promise<void> {
  latestSync++
  if (!isNativeTaskReminders()) return
  await writeNotifications(removePendingTaskReminders)
}

export async function syncStudentTaskReminders(
  studentId: string,
  tasks: StudentTask[],
  requestPermission = false,
): Promise<TaskReminderState> {
  const state: TaskReminderState = { native: isNativeTaskReminders(), granted: false, scheduled: 0, deferred: 0 }
  if (!state.native) return state
  const generation = ++latestSync
  let permission = await LocalNotifications.checkPermissions()
  if (generation !== latestSync) return state
  if (requestPermission && permission.display !== 'granted') permission = await LocalNotifications.requestPermissions()
  if (generation !== latestSync) return state
  state.granted = permission.display === 'granted'
  if (!state.granted) {
    await writeNotifications(async () => {
      if (generation === latestSync) await removePendingTaskReminders()
    })
    return state
  }

  if (Capacitor.getPlatform() === 'android') await LocalNotifications.createChannel({
    id: CHANNEL, name: 'Task reminders', description: 'Your saved task due-date reminders',
    importance: 4, visibility: 1, vibration: true,
  })
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + 30)
  const notifications: LocalNotificationSchema[] = []
  const seen = new Set<number>()
  for (const item of expandStudentTasks(tasks, { now, windowStart: now, windowEnd: end })) {
    if (item.status === 'completed') continue
    for (const minutes of item.task.reminder_minutes) {
      const at = new Date(new Date(item.due_at).getTime() - minutes * 60_000)
      if (at <= now) continue
      const id = reminderId(studentId + ':' + item.key + ':' + minutes)
      if (seen.has(id)) continue
      seen.add(id)
      notifications.push({
        id, title: item.task.title, body: 'Due ' + new Date(item.due_at).toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        }),
        schedule: { at, allowWhileIdle: true }, channelId: CHANNEL, autoCancel: true,
        extra: { kind: KIND, studentId, taskId: item.task.id, dueAt: item.due_at },
        isExactNotification: false,
      })
    }
  }
  notifications.sort((left, right) => left.schedule!.at!.getTime() - right.schedule!.at!.getTime())
  // Reserve room for class reminders; refill later dates whenever the app is opened.
  const nearest = notifications.slice(0, 40)
  await writeNotifications(async () => {
    if (generation !== latestSync) return
    await removePendingTaskReminders()
    if (generation !== latestSync) return
    if (nearest.length) await LocalNotifications.schedule({ notifications: nearest })
    if (generation !== latestSync) return
    state.scheduled = nearest.length
    state.deferred = Math.max(0, notifications.length - nearest.length)
  })
  return state
}

export async function listenForStudentTaskReminderActions(
  navigate: (taskId: string, dueAt: string) => void | Promise<void>,
): Promise<() => Promise<void>> {
  if (!isNativeTaskReminders()) return async () => undefined
  const listener = await LocalNotifications.addListener('localNotificationActionPerformed', event => {
    const data = event.notification.extra
    if (data?.kind !== KIND || typeof data.taskId !== 'string' || typeof data.dueAt !== 'string') return
    void navigate(data.taskId, data.dueAt)
  })
  return () => listener.remove()
}
