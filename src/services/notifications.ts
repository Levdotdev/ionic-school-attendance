import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { LocalNotifications } from '@capacitor/local-notifications'
import type { LocalNotificationSchema } from '@capacitor/local-notifications'
import { PushNotifications } from '@capacitor/push-notifications'

import { supabase } from '@/lib/supabase'

export const TEACHER_REMINDER_MINUTES = [5, 0] as const
export const STUDENT_REMINDER_MINUTES = [120, 60, 30, 15, 5, 0] as const

export type ReminderAudience = 'teacher' | 'student'

export type ClassReminderRoute =
  | '/teacher?section=schedules'
  | '/student?section=schedule'

export interface NotificationRegistrationResult {
  supported: boolean
  permission: 'granted' | 'denied' | 'unsupported'
  tokenRegistered: boolean
}
export interface ClassReminderInput {
  meetingId: string
  classId: string
  className: string
  section?: string | null
  startsAt: string | Date
  audience: ReminderAudience
  reminderMinutes?: readonly number[]
}

export interface LocalReminderScheduleResult {
  supported: boolean
  scheduledIds: number[]
  skippedOffsets: number[]
  warning?: string
}

const INSTALLATION_STORAGE_KEY = 'minsu-notification-installation-id'
const CLASS_REMINDERS_CHANNEL_ID = 'class-reminders'
const PUSH_REGISTRATION_TIMEOUT_MS = 20_000

function isNativeNotificationPlatform(): boolean {
  return Capacitor.isNativePlatform()
    && (Capacitor.getPlatform() === 'android' || Capacitor.getPlatform() === 'ios')
}

function getOrCreateInstallationId(): string {
  const existing = window.localStorage.getItem(INSTALLATION_STORAGE_KEY)
  if (existing) return existing

  const installationId = crypto.randomUUID()
  window.localStorage.setItem(INSTALLATION_STORAGE_KEY, installationId)
  return installationId
}

function getStoredInstallationId(): string | null {
  return window.localStorage.getItem(INSTALLATION_STORAGE_KEY)
}

function uniqueValidOffsets(offsets: readonly number[]): number[] {
  return [...new Set(offsets)]
    .filter((offset) => Number.isInteger(offset) && offset >= 0 && offset <= 7 * 24 * 60)
}

function reminderTitle(offsetMinutes: number): string {
  if (offsetMinutes === 0) return 'Class starts now'
  if (offsetMinutes >= 60 && offsetMinutes % 60 === 0) {
    const hours = offsetMinutes / 60
    return `Class starts in ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  }
  return `Class starts in ${offsetMinutes} minutes`
}

function reminderBody(input: ClassReminderInput, startsAt: Date): string {
  const classLabel = input.section?.trim()
    ? `${input.className} · ${input.section.trim()}`
    : input.className
  const time = new Intl.DateTimeFormat('en-PH', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(startsAt)

  return `${classLabel} at ${time}`
}

function notificationId(input: ClassReminderInput, offsetMinutes: number): number {
  const value = `${input.meetingId}:${input.audience}:${offsetMinutes}`
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  // Android notification IDs are signed 32-bit integers. Keep IDs positive
  // and reserve zero, which some OEM implementations treat specially.
  return (hash >>> 0) % 2_147_483_646 + 1
}

async function ensureClassReminderChannel(): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return

  await PushNotifications.createChannel({
    id: CLASS_REMINDERS_CHANNEL_ID,
    name: 'Class reminders',
    description: 'Reminders before a scheduled class begins',
    importance: 4,
    visibility: 1,
    vibration: true,
    lights: true,
    lightColor: '#EFB71B',
  })
}

async function saveNativePushToken(token: string): Promise<void> {
  const userResult = await supabase.auth.getUser()
  if (userResult.error) throw userResult.error
  if (!userResult.data.user) {
    throw new Error('Sign in before enabling class notifications.')
  }

  const platform = Capacitor.getPlatform()
  if (platform !== 'android' && platform !== 'ios') {
    throw new Error('Push notifications are only available in the installed mobile app.')
  }

  const { error } = await supabase.rpc('register_device_push_token', {
    p_installation_id: getOrCreateInstallationId(),
    p_token: token,
    p_platform: platform,
    p_provider: platform === 'android' ? 'fcm' : 'apns',
  })

  if (error) throw error
}

/**
 * Ask for native push permission, register with FCM/APNs, and bind the token
 * to the signed-in Supabase user. The registration listeners are one-shot so
 * calling this safely on each authenticated app launch does not accumulate
 * duplicate handlers.
 */
export async function registerForClassNotifications(): Promise<NotificationRegistrationResult> {
  if (!isNativeNotificationPlatform()) {
    return { supported: false, permission: 'unsupported', tokenRegistered: false }
  }

  let permission = await PushNotifications.checkPermissions()
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions()
  }

  if (permission.receive !== 'granted') {
    return { supported: true, permission: 'denied', tokenRegistered: false }
  }

  await ensureClassReminderChannel()

  let registrationHandle: PluginListenerHandle | undefined
  let errorHandle: PluginListenerHandle | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    let resolveRegistration: (value: boolean) => void = () => undefined
    let rejectRegistration: (reason: unknown) => void = () => undefined
    const tokenRegistered = new Promise<boolean>((resolve, reject) => {
      resolveRegistration = resolve
      rejectRegistration = reject
    })

    registrationHandle = await PushNotifications.addListener('registration', (token) => {
      void saveNativePushToken(token.value).then(
        () => resolveRegistration(true),
        rejectRegistration,
      )
    })
    errorHandle = await PushNotifications.addListener('registrationError', (registrationError) => {
      rejectRegistration(
        new Error(registrationError.error || 'Notification registration failed.'),
      )
    })
    timeoutId = setTimeout(() => {
      rejectRegistration(new Error('Notification registration timed out. Please try again.'))
    }, PUSH_REGISTRATION_TIMEOUT_MS)

    await PushNotifications.register()
    await tokenRegistered

    return { supported: true, permission: 'granted', tokenRegistered: true }
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    await Promise.allSettled([
      registrationHandle?.remove(),
      errorHandle?.remove(),
    ])
  }
}

/**
 * Remove this installation from the user's server-side delivery list and
 * invalidate its native registration token.
 */
export async function unregisterFromClassNotifications(): Promise<void> {
  if (!isNativeNotificationPlatform()) return

  const installationId = getStoredInstallationId()
  let serverError: unknown

  if (installationId) {
    const { error } = await supabase.rpc('unregister_device_push_token', {
      p_installation_id: installationId,
    })
    serverError = error
  }

  // Always invalidate the OS token, even if the database cleanup failed. This
  // prevents a signed-out device from continuing to receive account reminders.
  await PushNotifications.unregister()
  if (serverError) throw serverError
}

function classReminderRoute(data: unknown): ClassReminderRoute | null {
  if (!data || typeof data !== 'object') return null

  const payload = data as Record<string, unknown>
  if (payload.kind !== 'class-reminder') return null
  if (payload.audience === 'teacher') return '/teacher?section=schedules'
  if (payload.audience === 'student') return '/student?section=schedule'
  return null
}

/**
 * Route taps from trusted class-reminder payloads. The route supplied by FCM
 * is intentionally ignored; deriving it from the validated audience keeps an
 * arbitrary push payload from navigating to an unexpected URL.
 */
export async function listenForClassNotificationActions(
  navigate: (route: ClassReminderRoute) => void | Promise<void>,
): Promise<() => Promise<void>> {
  if (!isNativeNotificationPlatform()) return async () => undefined

  const handle = await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action) => {
      const route = classReminderRoute(action.notification.data)
      if (route) void navigate(route)
    },
  )

  return async () => handle.remove()
}

async function requestLocalNotificationPermission(): Promise<boolean> {
  let permission = await LocalNotifications.checkPermissions()
  if (permission.display === 'prompt' || permission.display === 'prompt-with-rationale') {
    permission = await LocalNotifications.requestPermissions()
  }
  return permission.display === 'granted'
}

/**
 * Schedule device-local reminders as an offline fallback. Remote push remains
 * the primary source because the server can cancel reminders when a teacher
 * disables a meeting. Local alarms are deliberately inexact on Android so the
 * app does not force the separate exact-alarm system permission screen.
 */
export async function scheduleLocalClassReminders(
  input: ClassReminderInput,
): Promise<LocalReminderScheduleResult> {
  if (!isNativeNotificationPlatform()) {
    return { supported: false, scheduledIds: [], skippedOffsets: [] }
  }

  if (!(await requestLocalNotificationPermission())) {
    return { supported: true, scheduledIds: [], skippedOffsets: [] }
  }

  await ensureClassReminderChannel()

  const startsAt = input.startsAt instanceof Date
    ? new Date(input.startsAt)
    : new Date(input.startsAt)
  if (!Number.isFinite(startsAt.getTime())) {
    throw new Error('The class start time is invalid.')
  }

  const configuredOffsets = input.reminderMinutes
    ?? (input.audience === 'teacher'
      ? TEACHER_REMINDER_MINUTES
      : STUDENT_REMINDER_MINUTES)
  const offsets = uniqueValidOffsets(configuredOffsets)
  const now = Date.now()
  const skippedOffsets: number[] = []
  const notifications: LocalNotificationSchema[] = []

  for (const offsetMinutes of offsets) {
    const at = new Date(startsAt.getTime() - offsetMinutes * 60_000)
    if (at.getTime() <= now) {
      skippedOffsets.push(offsetMinutes)
      continue
    }

    notifications.push({
      id: notificationId(input, offsetMinutes),
      title: reminderTitle(offsetMinutes),
      body: reminderBody(input, startsAt),
      schedule: {
        at,
        allowWhileIdle: true,
      },
      channelId: CLASS_REMINDERS_CHANNEL_ID,
      foreground: true,
      isExactNotification: false,
      autoCancel: true,
      iconColor: '#087443',
      extra: {
        kind: 'class-reminder',
        meetingId: input.meetingId,
        classId: input.classId,
        audience: input.audience,
        reminderOffsetMinutes: offsetMinutes,
      },
    })
  }

  if (notifications.length === 0) {
    return { supported: true, scheduledIds: [], skippedOffsets }
  }

  const result = await LocalNotifications.schedule({ notifications })
  return {
    supported: true,
    scheduledIds: result.notifications.map((notification) => notification.id),
    skippedOffsets,
    warning: result.warning?.message,
  }
}

export async function cancelLocalClassReminders(
  input: Pick<ClassReminderInput, 'meetingId' | 'classId' | 'className' | 'audience'> & {
    reminderMinutes?: readonly number[]
  },
): Promise<void> {
  if (!isNativeNotificationPlatform()) return

  const configuredOffsets = input.reminderMinutes
    ?? (input.audience === 'teacher'
      ? TEACHER_REMINDER_MINUTES
      : STUDENT_REMINDER_MINUTES)
  const notifications = uniqueValidOffsets(configuredOffsets).map((offsetMinutes) => ({
    id: notificationId(
      {
        ...input,
        startsAt: new Date(0),
      },
      offsetMinutes,
    ),
  }))

  if (notifications.length > 0) {
    await LocalNotifications.cancel({ notifications })
  }
}
