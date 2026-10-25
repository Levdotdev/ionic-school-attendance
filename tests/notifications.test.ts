import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  isNativePlatform: vi.fn(), getPlatform: vi.fn(),
  pushPermission: vi.fn(), pushRequest: vi.fn(), pushRegister: vi.fn(), pushUnregister: vi.fn(),
  pushChannel: vi.fn(), pushListener: vi.fn(),
  localPermission: vi.fn(), localRequest: vi.fn(), localSchedule: vi.fn(), localCancel: vi.fn(), localListener: vi.fn(),
  getUser: vi.fn(), rpc: vi.fn(),
  pushHandlers: new Map<string, (payload: any) => void>(),
  localHandlers: new Map<string, (payload: any) => void>(),
  removals: [] as ReturnType<typeof vi.fn>[],
}))

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native.isNativePlatform, getPlatform: native.getPlatform } }))
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: {
  checkPermissions: native.pushPermission,
  requestPermissions: native.pushRequest,
  register: native.pushRegister,
  unregister: native.pushUnregister,
  createChannel: native.pushChannel,
  addListener: native.pushListener,
} }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {
  checkPermissions: native.localPermission,
  requestPermissions: native.localRequest,
  schedule: native.localSchedule,
  cancel: native.localCancel,
  addListener: native.localListener,
} }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getUser: native.getUser }, rpc: native.rpc } }))

let service: typeof import('@/services/notifications')
const baseClass = {
  meetingId: 'meeting-1', classId: 'class-1', className: 'System Integration', section: '4-F1',
  startsAt: '2026-10-24T04:00:00.000Z',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(new Date('2026-10-24T00:00:00.000Z'))
  window.localStorage.clear()
  native.pushHandlers.clear()
  native.localHandlers.clear()
  native.removals.length = 0
  native.isNativePlatform.mockReturnValue(true)
  native.getPlatform.mockReturnValue('android')
  native.pushPermission.mockResolvedValue({ receive: 'granted' })
  native.pushRequest.mockResolvedValue({ receive: 'granted' })
  native.localPermission.mockResolvedValue({ display: 'granted' })
  native.localRequest.mockResolvedValue({ display: 'granted' })
  native.pushRegister.mockResolvedValue(undefined)
  native.pushUnregister.mockResolvedValue(undefined)
  native.pushChannel.mockResolvedValue(undefined)
  native.localCancel.mockResolvedValue(undefined)
  native.localSchedule.mockImplementation(async ({ notifications }) => ({ notifications: notifications.map(({ id }: { id: number }) => ({ id })) }))
  native.getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
  native.rpc.mockResolvedValue({ data: null, error: null })
  const listener = (handlers: Map<string, (payload: any) => void>) => async (event: string, handler: (payload: any) => void) => {
    handlers.set(event, handler)
    const remove = vi.fn(async () => { if (handlers.get(event) === handler) handlers.delete(event) })
    native.removals.push(remove)
    return { remove }
  }
  native.pushListener.mockImplementation(listener(native.pushHandlers))
  native.localListener.mockImplementation(listener(native.localHandlers))
  service = await import('@/services/notifications')
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('native notification availability', () => {
  it('returns unsupported in a browser without requesting permission or registering a device', async () => {
    native.isNativePlatform.mockReturnValue(false)
    expect(await service.registerForClassNotifications()).toEqual({ supported: false, permission: 'unsupported', tokenRegistered: false })
    expect(await service.scheduleLocalClassReminders({ ...baseClass, audience: 'student' })).toEqual({ supported: false, scheduledIds: [], skippedOffsets: [] })
    const remove = await service.listenForClassNotificationActions(vi.fn())
    await remove()
    expect(native.pushPermission).not.toHaveBeenCalled()
    expect(native.localPermission).not.toHaveBeenCalled()
    expect(native.getUser).not.toHaveBeenCalled()
    expect(native.pushRegister).not.toHaveBeenCalled()
    expect(native.pushListener).not.toHaveBeenCalled()
    expect(native.localListener).not.toHaveBeenCalled()
  })

  it('respects denied push permission without creating listeners', async () => {
    native.pushPermission.mockResolvedValue({ receive: 'prompt' })
    native.pushRequest.mockResolvedValue({ receive: 'denied' })
    expect(await service.registerForClassNotifications()).toEqual({ supported: true, permission: 'denied', tokenRegistered: false })
    expect(native.pushRequest).toHaveBeenCalledOnce()
    expect(native.pushListener).not.toHaveBeenCalled()
    expect(native.pushRegister).not.toHaveBeenCalled()
  })
})

describe('weekly class reminder schedule', () => {
  it.each([
    ['teacher', [5, 0]],
    ['student', [120, 60, 30, 15, 5, 0]],
  ] as const)('uses all configured %s offsets and reserves IDs below task reminders', async (audience, offsets) => {
    const input = { ...baseClass, audience }
    const result = await service.scheduleLocalClassReminders(input)
    const scheduled = native.localSchedule.mock.calls[0][0].notifications
    expect(scheduled.map((item: any) => item.extra.reminderOffsetMinutes)).toEqual(offsets)
    expect(scheduled.map((item: any) => item.schedule.at.toISOString())).toEqual(offsets.map(offset => new Date(new Date(baseClass.startsAt).getTime() - offset * 60_000).toISOString()))
    expect(scheduled.every((item: any) => item.id > 0 && item.id < 1_000_000_000 && item.isExactNotification === false)).toBe(true)
    expect(new Set(result.scheduledIds).size).toBe(offsets.length)
    expect(scheduled.every((item: any) => item.extra.kind === 'class-reminder' && item.extra.audience === audience)).toBe(true)
    await service.cancelLocalClassReminders(input)
    expect(native.localCancel).toHaveBeenCalledWith({ notifications: result.scheduledIds.map(id => ({ id })) })
  })

  it('deduplicates offsets, discards invalid values, and skips reminders whose time has passed', async () => {
    const result = await service.scheduleLocalClassReminders({
      ...baseClass, audience: 'student', startsAt: '2026-10-24T00:10:00.000Z',
      reminderMinutes: [0, 5, 15, 15, -1, 1.5, 10081, NaN, Infinity],
    })
    const scheduled = native.localSchedule.mock.calls[0][0].notifications
    expect(scheduled.map((item: any) => item.extra.reminderOffsetMinutes)).toEqual([0, 5])
    expect(result.skippedOffsets).toEqual([15])
    expect(result.scheduledIds).toHaveLength(2)
  })

  it('does not schedule expired meetings or reminders without local permission', async () => {
    const expired = await service.scheduleLocalClassReminders({ ...baseClass, audience: 'teacher', startsAt: '2026-10-23T23:00:00.000Z' })
    expect(expired.scheduledIds).toEqual([])
    expect(expired.skippedOffsets).toEqual([5, 0])
    expect(native.localSchedule).not.toHaveBeenCalled()
    native.localPermission.mockResolvedValue({ display: 'prompt' })
    native.localRequest.mockResolvedValue({ display: 'denied' })
    expect((await service.scheduleLocalClassReminders({ ...baseClass, audience: 'student' })).scheduledIds).toEqual([])
    expect(native.localRequest).toHaveBeenCalledOnce()
    expect(native.localSchedule).not.toHaveBeenCalled()
  })
})

describe('class notification navigation', () => {
  it('routes push and local taps to the audience’s schedule and ignores untrusted routes', async () => {
    const navigate = vi.fn()
    const remove = await service.listenForClassNotificationActions(navigate)
    const push = native.pushHandlers.get('pushNotificationActionPerformed')!
    const local = native.localHandlers.get('localNotificationActionPerformed')!
    push({ notification: { data: { kind: 'class-reminder', audience: 'teacher', route: 'https://untrusted.example/' } } })
    local({ notification: { extra: { kind: 'class-reminder', audience: 'student', route: '/admin' } } })
    push({ notification: { data: { kind: 'class-reminder', audience: 'admin', route: '/admin' } } })
    local({ notification: { extra: { kind: 'other', audience: 'student', route: '/student' } } })
    push({ notification: { data: null } })
    expect(navigate.mock.calls).toEqual([['/teacher?section=schedules'], ['/student?section=schedule']])
    await remove()
    expect(native.removals.every(listener => listener.mock.calls.length === 1)).toBe(true)
  })
})

describe('device push registration lifetime', () => {
  it('shares concurrent registration and removes one-shot listeners after saving one token', async () => {
    const first = service.registerForClassNotifications()
    const second = service.registerForClassNotifications()
    expect(second).toBe(first)
    await flushPromises()
    expect(native.pushRegister).toHaveBeenCalledOnce()
    native.pushHandlers.get('registration')!({ value: 'fcm-token-1' })
    expect(await first).toEqual({ supported: true, permission: 'granted', tokenRegistered: true })
    expect(native.rpc).toHaveBeenCalledWith('register_device_push_token', expect.objectContaining({ p_token: 'fcm-token-1', p_platform: 'android', p_provider: 'fcm' }))
    expect(native.removals).toHaveLength(2)
    expect(native.removals.every(listener => listener.mock.calls.length === 1)).toBe(true)
  })

  it('rejects a late token when the active account has changed', async () => {
    const pending = service.registerForClassNotifications()
    const rejected = expect(pending).rejects.toThrow('account changed')
    await flushPromises()
    native.getUser.mockResolvedValue({ data: { user: { id: 'different-user' } }, error: null })
    native.pushHandlers.get('registration')!({ value: 'fcm-token-old-user' })
    await rejected
    expect(native.rpc).not.toHaveBeenCalled()
    expect(native.removals.every(listener => listener.mock.calls.length === 1)).toBe(true)
  })

  it('invalidates a token whose user check finishes after sign-out', async () => {
    window.localStorage.setItem('minsu-notification-installation-id', 'installation-1')
    const lateUser = deferred<{ data: { user: { id: string } }; error: null }>()
    const pending = service.registerForClassNotifications()
    const rejected = expect(pending).rejects.toThrow('account changed')
    await flushPromises()
    native.getUser.mockReturnValueOnce(lateUser.promise)
    native.pushHandlers.get('registration')!({ value: 'fcm-token-old-user' })
    const unregistering = service.unregisterFromClassNotifications()
    lateUser.resolve({ data: { user: { id: 'user-1' } }, error: null })
    await unregistering
    await rejected
    expect(native.rpc).toHaveBeenCalledTimes(1)
    expect(native.rpc).toHaveBeenCalledWith('unregister_device_push_token', { p_installation_id: 'installation-1' })
    expect(native.pushUnregister).toHaveBeenCalledOnce()
  })

  it('cleans up after an OS registration failure and permits a later retry', async () => {
    native.pushRegister.mockRejectedValueOnce(new Error('OS registration unavailable'))
    await expect(service.registerForClassNotifications()).rejects.toThrow('OS registration unavailable')
    expect(native.removals.every(listener => listener.mock.calls.length === 1)).toBe(true)
    const retry = service.registerForClassNotifications()
    await flushPromises()
    native.pushHandlers.get('registration')!({ value: 'retry-token' })
    expect((await retry).tokenRegistered).toBe(true)
    expect(native.pushRegister).toHaveBeenCalledTimes(2)
  })

  it('waits for an already-sent token save before removing the installation on sign-out', async () => {
    const saving = deferred<{ data: null; error: null }>()
    const writes: string[] = []
    native.rpc.mockImplementation(async (name: string) => {
      if (name === 'register_device_push_token') {
        await saving.promise
        writes.push('registered')
      } else if (name === 'unregister_device_push_token') writes.push('unregistered')
      return { data: null, error: null }
    })
    const registering = service.registerForClassNotifications()
    await flushPromises()
    native.pushHandlers.get('registration')!({ value: 'already-sending-token' })
    await flushPromises()
    const unregistering = service.unregisterFromClassNotifications()
    await flushPromises()
    expect(native.pushUnregister).toHaveBeenCalledOnce()
    expect(writes).toEqual([])
    saving.resolve({ data: null, error: null })
    await Promise.allSettled([registering, unregistering])
    expect(writes).toEqual(['registered', 'unregistered'])
    expect(native.pushUnregister).toHaveBeenCalledOnce()
  })

  it('does not let delayed logout cleanup remove a newer account’s device mapping', async () => {
    const oldSave = deferred<{ data: null; error: null }>()
    let saves = 0
    native.rpc.mockImplementation(async (name: string) => {
      if (name === 'register_device_push_token' && ++saves === 1) return oldSave.promise
      return { data: null, error: null }
    })
    const original = service.registerForClassNotifications()
    await flushPromises()
    native.pushHandlers.get('registration')!({ value: 'old-token' })
    await flushPromises()
    const removing = service.unregisterFromClassNotifications()
    expect(native.pushUnregister).toHaveBeenCalledOnce()
    native.getUser.mockResolvedValue({ data: { user: { id: 'user-2' } }, error: null })
    const replacement = service.registerForClassNotifications()
    await flushPromises()
    native.pushHandlers.get('registration')!({ value: 'new-token' })
    await replacement
    oldSave.resolve({ data: null, error: null })
    await Promise.allSettled([original, removing])
    expect(native.rpc.mock.calls.some(call => call[0] === 'unregister_device_push_token')).toBe(false)
    expect(native.pushUnregister).toHaveBeenCalledOnce()
  })

  it('handles a native error event and register rejection without leaking a rejected token promise', async () => {
    native.pushRegister.mockImplementationOnce(async () => {
      native.pushHandlers.get('registrationError')!({ error: 'Registration event failed' })
      throw new Error('Native register failed')
    })
    await expect(service.registerForClassNotifications()).rejects.toThrow(/register failed|event failed/i)
    await flushPromises()
    expect(native.removals.every(listener => listener.mock.calls.length === 1)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('times out a registration that never receives an OS token and removes both listeners', async () => {
    const registering = service.registerForClassNotifications()
    const rejected = expect(registering).rejects.toThrow('timed out')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(20_000)
    await rejected
    expect(native.removals.every(listener => listener.mock.calls.length === 1)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
