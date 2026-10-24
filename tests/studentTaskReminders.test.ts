import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalNotificationSchema } from '@capacitor/local-notifications'
import type { StudentTask } from '@/types/studentTasks'

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(), getPlatform: vi.fn(), checkPermissions: vi.fn(),
  requestPermissions: vi.fn(), createChannel: vi.fn(), getPending: vi.fn(),
  cancel: vi.fn(), schedule: vi.fn(), addListener: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: mocks }))
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: mocks }))
import { cancelStudentTaskReminders, syncStudentTaskReminders } from '@/services/studentTaskReminders'

function task(overrides: Partial<StudentTask> = {}): StudentTask {
  return { id: 'task', student_id: 'student', title: 'Read', description: '', due_at: '2026-10-24T03:00:00Z',
    priority: 'medium', recurrence: 'none', recurrence_until: null, reminder_minutes: [5, 30],
    sort_order: 0, class_id: null, category_id: null, course: null, category: null, links: [], files: [],
    created_at: '', updated_at: '', occurrences: [], ...overrides }
}

let pending: LocalNotificationSchema[]
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T02:00:00Z'))
  vi.clearAllMocks()
  pending = [{ id: 42, title: 'Class', body: 'Class starts soon', extra: { kind: 'class-reminder' } }]
  mocks.isNativePlatform.mockReturnValue(true); mocks.getPlatform.mockReturnValue('android')
  mocks.checkPermissions.mockResolvedValue({ display: 'granted' }); mocks.requestPermissions.mockResolvedValue({ display: 'granted' })
  mocks.createChannel.mockResolvedValue(undefined)
  mocks.getPending.mockImplementation(async () => ({ notifications: [...pending] }))
  mocks.cancel.mockImplementation(async ({ notifications }: { notifications: { id: number }[] }) => { pending = pending.filter(item => !notifications.some(cancel => cancel.id === item.id)) })
  mocks.schedule.mockImplementation(async ({ notifications }: { notifications: LocalNotificationSchema[] }) => { pending.push(...notifications) })
})
afterEach(async () => { await cancelStudentTaskReminders(); vi.useRealTimers() })

describe('student task reminder lifecycle', () => {
  it('replaces task notifications without canceling class notifications and uses stable separate IDs', async () => {
    const first = await syncStudentTaskReminders('student', [task()])
    const ids = pending.filter(item => item.extra?.kind === 'student-task-reminder').map(item => item.id)
    expect(first.scheduled).toBe(2)
    expect(ids.every(id => id >= 1_000_000_000 && id < 2_000_000_000)).toBe(true)
    await syncStudentTaskReminders('student', [task()])
    expect(pending.map(item => item.id)).toEqual([42, ...ids])
    await syncStudentTaskReminders('student', [])
    expect(pending.map(item => item.id)).toEqual([42])
  })

  it('does not schedule skipped/completed dates or reminders whose time passed', async () => {
    const saved = { id: 'done', task_id: 'task', due_at: '2026-10-24T03:00:00Z', status: 'completed' as const, completed_at: '2026-10-24T01:00:00Z', created_at: '', updated_at: '' }
    const completed = await syncStudentTaskReminders('student', [task({ occurrences: [saved] })])
    expect(completed.scheduled).toBe(0)
    const skipped = await syncStudentTaskReminders('student', [task({ occurrences: [{ ...saved, status: 'skipped', completed_at: null }] })])
    expect(skipped.scheduled).toBe(0)
    const near = await syncStudentTaskReminders('student', [task({ due_at: '2026-10-24T02:10:00Z' })])
    expect(near.scheduled).toBe(1)
  })

  it('keeps the nearest 40 reminders and reports later reminders for refill', async () => {
    const result = await syncStudentTaskReminders('student', [task({ recurrence: 'daily', reminder_minutes: [5, 15, 30, 60] })])
    expect(result.scheduled).toBe(40)
    expect(result.deferred).toBeGreaterThan(0)
    const reminders = pending.filter(item => item.extra?.kind === 'student-task-reminder')
    const dates = reminders.map(item => item.schedule!.at!.getTime())
    expect(dates).toEqual([...dates].sort((a, b) => a - b))
  })

  it('finishes signout cleanup after an in-flight native schedule', async () => {
    let finishSchedule!: () => void
    const started = new Promise<void>(resolve => {
      mocks.schedule.mockImplementationOnce(async ({ notifications }: { notifications: LocalNotificationSchema[] }) => {
        resolve()
        await new Promise<void>(done => { finishSchedule = done })
        pending.push(...notifications)
      })
    })
    const sync = syncStudentTaskReminders('student', [task()])
    await started
    const cleanup = cancelStudentTaskReminders()
    finishSchedule()
    await Promise.all([sync, cleanup])
    expect(pending.map(item => item.id)).toEqual([42])
  })

  it('does not resume scheduling after logout while permissions are pending', async () => {
    let finishPermission!: (value: { display: string }) => void
    mocks.checkPermissions.mockImplementationOnce(() => new Promise(resolve => { finishPermission = resolve }))
    const sync = syncStudentTaskReminders('student', [task()], true)
    await cancelStudentTaskReminders()
    finishPermission({ display: 'granted' })
    await sync
    expect(mocks.schedule).not.toHaveBeenCalled()
    expect(mocks.requestPermissions).not.toHaveBeenCalled()
  })

  it('only requests permission after the student asks and clears stale reminders after denial', async () => {
    await syncStudentTaskReminders('student', [task()])
    mocks.checkPermissions.mockResolvedValue({ display: 'denied' })
    const denied = await syncStudentTaskReminders('student', [task()])
    expect(denied.granted).toBe(false)
    expect(mocks.requestPermissions).not.toHaveBeenCalled()
    expect(pending.map(item => item.id)).toEqual([42])
    const granted = await syncStudentTaskReminders('student', [task()], true)
    expect(mocks.requestPermissions).toHaveBeenCalledOnce()
    expect(granted.scheduled).toBe(2)
  })
})
