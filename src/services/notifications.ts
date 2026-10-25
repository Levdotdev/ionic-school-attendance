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
let registrationEpoch = 0
let registrationPromise: Promise<NotificationRegistrationResult> | null = null
const pendingTokenSaves = new Set<Promise<void>>()

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

  // Reserve the upper billion for task reminders so neither replaces the other.
  return (hash >>> 0) % 999_999_999 + 1
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

async function saveNativePushToken(token: string, expectedUserId: string, epoch: number): Promise<void> {
  const userResult = await supabase.auth.getUser()
  if (userResult.error) throw userResult.error
  if (userResult.data.user?.id !== expectedUserId || epoch !== registrationEpoch) {
    throw new Error('Your account changed before notifications were enabled. Try again.')
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
export function registerForClassNotifications(): Promise<NotificationRegistrationResult> {
  if (!isNativeNotificationPlatform()) {
    return Promise.resolve({ supported: false, permission: 'unsupported', tokenRegistered: false })
  }
  if (!registrationPromise) {
    const epoch = ++registrationEpoch
    const pending = registerNativeNotifications(epoch).finally(() => {
      if (registrationPromise === pending) registrationPromise = null
    })
    registrationPromise = pending
  }
  return registrationPromise
}

async function registerNativeNotifications(epoch: number): Promise<NotificationRegistrationResult> {
  const currentUser = await supabase.auth.getUser()
  if (currentUser.error) throw currentUser.error
  const expectedUserId = currentUser.data.user?.id
  if (!expectedUserId) throw new Error('Sign in before enabling class notifications.')

  let permission = await PushNotifications.checkPermissions()
  if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
    permission = await PushNotifications.requestPermissions()
  }

  if (permission.receive !== 'granted') {
    return { supported: true, permission: 'denied', tokenRegistered: false }
  }
  if (epoch !== registrationEpoch) throw new Error('Notification registration was cancelled because the account changed.')

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
      const saving = saveNativePushToken(token.value, expectedUserId, epoch)
      pendingTokenSaves.add(saving)
      void saving.then(
        () => { pendingTokenSaves.delete(saving); resolveRegistration(true) },
        error => { pendingTokenSaves.delete(saving); rejectRegistration(error) },
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

    await Promise.all([PushNotifications.register(), tokenRegistered])

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
  const epoch = ++registrationEpoch
  registrationPromise = null
  if (!isNativeNotificationPlatform()) return
  const installationId = getStoredInstallationId()
  // Start OS removal before waiting for any network save. A stalled network
  // request must not keep the old account's push token active during logout.
  const nativeRemoval = PushNotifications.unregister().then(() => null, error => error)

  // Finish any already-sent registration before removing this installation.
  // The epoch check rejects callbacks that arrive after sign-out starts.
  await Promise.allSettled([...pendingTokenSaves])
  // A subsequent account may already have registered this installation.
  // Never let delayed cleanup delete that newer device mapping.
  if (epoch !== registrationEpoch) { await nativeRemoval; return }
  let serverError: unknown

  if (installationId) {
    const { error } = await supabase.rpc('unregister_device_push_token', {
      p_installation_id: installationId,
    })
    serverError = error
  }

  const nativeError = await nativeRemoval
  if (serverError) throw serverError
  if (nativeError) throw nativeError
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

  const pushHandle = await PushNotifications.addListener(
    'pushNotificationActionPerformed',
    (action) => {
      const route = classReminderRoute(action.notification.data)
      if (route) void navigate(route)
    },
  )

  const localHandle = await LocalNotifications.addListener('localNotificationActionPerformed', action => {
    const route = classReminderRoute(action.notification.extra)
    if (route) void navigate(route)
  })
  return async () => {
    await Promise.all([pushHandle.remove(), localHandle.remove()])
  }
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
