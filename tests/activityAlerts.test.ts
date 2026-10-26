// @vitest-environment node
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { describe, expect, it, vi } from 'vitest'
import { activityAlertRoute, activityEmailContent, activityPushContent, dispatchActivityAlerts, type ActivityAlert } from '../supabase/functions/dispatch-class-reminders/activityAlerts'

const id = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function alert(input: Partial<ActivityAlert> = {}): ActivityAlert {
  return { id: id(1), channel: 'email', kind: 'attendance', audience: 'parent', status: 'present', recipient_email: 'parent@example.test',
    push_token: null, subject_name: 'Child Example', class_name: 'System Integration', meeting_starts_at: '2026-10-26T01:00:00Z', decision_note: null, ...input }
}
function fixture(values = [alert()]) {
  const leases = values.map((value, index) => ({ id: value.id, lease_token: id(index + 100) }))
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'claim_activity_alert_deliveries') return { data: leases, error: null }
    if (name === 'resolve_activity_alert_delivery') return { data: values.filter(value => value.id === args.p_id), error: null }
    return { data: true, error: null }
  })
  const sendPush = vi.fn(async () => 'push-message'), sendEmail = vi.fn(async () => 'email-message')
  return { rpc, client: { rpc }, transports: { sendPush, sendEmail, isUnregisteredToken: (error: unknown) => error instanceof Error && error.message === 'UNREGISTERED' } }
}

describe('activity-alert delivery worker', () => {
  it('resolves fresh permission/destination before sending and acknowledges its lease', async () => {
    const f = fixture()
    expect(await dispatchActivityAlerts(f.client, f.transports)).toEqual({ claimed: 1, sent: 1, failed: 0, cancelled: 0, error: false })
    expect(f.transports.sendEmail).toHaveBeenCalledWith(alert())
    expect(f.transports.sendPush).not.toHaveBeenCalled()
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(['claim_activity_alert_deliveries', 'resolve_activity_alert_delivery', 'complete_activity_alert_delivery'])
    expect(f.rpc).toHaveBeenLastCalledWith('complete_activity_alert_delivery', expect.objectContaining({ p_lease_token: id(100), p_succeeded: true, p_provider_message_id: 'email-message' }))
  })
  it('contains SMTP failures while still sending student and parent push notifications', async () => {
    const f = fixture([alert(), alert({ id: id(2), channel: 'push', audience: 'student', push_token: 'student-native-token-123456' }), alert({ id: id(3), channel: 'push', push_token: 'parent-native-token-123456' })])
    f.transports.sendEmail.mockRejectedValue(new Error('PRIVATE SMTP CREDENTIAL AND RECIPIENT'))
    const result = await dispatchActivityAlerts(f.client, f.transports)
    expect(result).toEqual({ claimed: 3, sent: 2, failed: 1, cancelled: 0, error: false })
    expect(f.transports.sendPush).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
    expect(f.rpc).toHaveBeenCalledWith('complete_activity_alert_delivery', expect.objectContaining({ p_id: id(1), p_succeeded: false, p_provider_message_id: null }))
  })
  it('does not send revoked or expired leases', async () => {
    const f = fixture()
    f.rpc.mockImplementation(async name => ({ data: name === 'claim_activity_alert_deliveries' ? [{ id: id(1), lease_token: id(100) }] : [], error: null }))
    expect((await dispatchActivityAlerts(f.client, f.transports)).cancelled).toBe(1)
    expect(f.transports.sendEmail).not.toHaveBeenCalled()
    expect(f.transports.sendPush).not.toHaveBeenCalled()
  })
  it('rejects student email, wrong audience and malformed addresses without transmitting', async () => {
    for (const value of [alert({ audience: 'student' }), alert({ recipient_email: 'parent@example.test\r\nBcc: victim@example.test' }), alert({ kind: 'teacher_request', audience: 'parent', status: 'pending' })]) {
      const f = fixture([value])
      expect((await dispatchActivityAlerts(f.client, f.transports)).failed).toBe(1)
      expect(f.transports.sendEmail).not.toHaveBeenCalled()
    }
  })
  it('disables only an unregistered device token and leaves generic failures retryable', async () => {
    const f = fixture([alert({ channel: 'push', audience: 'student', push_token: 'student-native-token-123456' })])
    f.transports.sendPush.mockRejectedValue(new Error('UNREGISTERED'))
    await dispatchActivityAlerts(f.client, f.transports)
    expect(f.rpc).toHaveBeenLastCalledWith('complete_activity_alert_delivery', expect.objectContaining({ p_succeeded: false, p_disable_token: true }))
  })
  it('rejects malformed/oversized claims and contains queue outages', async () => {
    const f = fixture()
    f.rpc.mockResolvedValueOnce({ data: [{ id: 'not-an-id', lease_token: id(2) }], error: null })
    expect((await dispatchActivityAlerts(f.client, f.transports)).error).toBe(true)
    f.rpc.mockRejectedValueOnce(new Error('PRIVATE database details'))
    expect((await dispatchActivityAlerts(f.client, f.transports)).error).toBe(true)
    expect(f.transports.sendEmail).not.toHaveBeenCalled()
  })
  it('uses bounded processing so remaining leases can be recovered without blocking reminders', async () => {
    const f = fixture([alert(), alert({ id: id(2) })])
    let ticks = 0
    const result = await dispatchActivityAlerts(f.client, { ...f.transports, now: () => ticks++ < 2 ? 0 : 36000 })
    expect(result.sent).toBe(1)
    expect(f.transports.sendEmail).toHaveBeenCalledTimes(1)
  })
})

describe('private attendance push and branded email content', () => {
  it('keeps names, photos, GPS and provider credentials off the push lock screen', () => {
    const payload = activityPushContent(alert())
    expect(payload.title).toContain('Present')
    expect(payload.body).toContain('linked child')
    expect(JSON.stringify(payload)).not.toContain('Child Example')
    expect(activityAlertRoute(alert())).toBe('/parent?section=history')
    expect(activityAlertRoute(alert({ audience: 'student' }))).toBe('/student?section=history')
  })
  it.each(['present', 'absent'] as const)('renders parent %s email with class/date and real logo URL', status => {
    const email = activityEmailContent(alert({ status }))
    expect(email.text).toContain(`was marked ${status}`)
    expect(email.text).toContain('System Integration')
    expect(email.text).toContain('Monday')
    expect(email.html).toContain('https://ionic-school-attendance.vercel.app/minsu-logo.png')
    expect(email.html).toContain('/parent?section=history')
    expect(email.html).not.toContain('token_hash')
  })
  it('renders admin request and teacher decisions, escaping names and notes', () => {
    const request = activityEmailContent(alert({ kind: 'teacher_request', audience: 'admin', status: 'pending', subject_name: '<script>alert(1)</script>' }))
    expect(request.subject).toContain('New teacher approval request')
    expect(request.html).not.toContain('<script>')
    expect(request.html).toContain('&lt;script&gt;')
    for (const status of ['approved', 'rejected'] as const) {
      const decision = activityEmailContent(alert({ kind: 'teacher_decision', audience: 'teacher', status, decision_note: '<b>Admin note</b>' }))
      expect(decision.subject).toContain(status)
      expect(decision.html).toContain('&lt;b&gt;Admin note&lt;/b&gt;')
    }
  })
})

function smtpSender() {
  const output = ts.transpileModule(readFileSync(new URL('../supabase/functions/dispatch-class-reminders/smtpAlerts.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const result: { createSmtpAlertSender?: (env: (name: string) => string | undefined, load: () => Promise<unknown>) => ((item: ActivityAlert) => Promise<string>) & {verify:()=>Promise<void>} } = {}
  runInNewContext(output, { exports: result, require: () => ({ activityEmailContent }) })
  return result.createSmtpAlertSender!
}
describe('SMTP alert transport', () => {
  it('verifies SMTP authentication without sending any email', async () => {
    const verify=vi.fn().mockResolvedValue(true),sendMail=vi.fn()
    const values:Record<string,string>={ALERT_SMTP_HOST:'smtp.gmail.com',ALERT_SMTP_PORT:'465',ALERT_SMTP_USER:'sender@example.test',ALERT_SMTP_PASSWORD:'PRIVATE',ALERT_SMTP_FROM:'sender@example.test'}
    const sender=smtpSender()(name=>values[name],async()=>({createTransport:()=>({verify,sendMail})}))
    await sender.verify()
    expect(verify).toHaveBeenCalledOnce()
    expect(sendMail).not.toHaveBeenCalled()
  })
  it('requires TLS, uses stable message ID and verified destination, and disables file/URL access', async () => {
    const sendMail = vi.fn(async () => ({ messageId: 'accepted-message', accepted: ['parent@example.test'], rejected: [] }))
    const createTransport = vi.fn(() => ({ sendMail }))
    const values: Record<string, string> = { ALERT_SMTP_HOST: 'smtp.gmail.com', ALERT_SMTP_PORT: '465', ALERT_SMTP_USER: 'sender@example.test', ALERT_SMTP_PASSWORD: 'PRIVATE', ALERT_SMTP_FROM: 'MinSU Attendance <sender@example.test>' }
    const sender = smtpSender()(name => values[name], async () => ({ createTransport }))
    expect(await sender(alert())).toBe('accepted-message')
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: true, requireTLS: true, tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true }))
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ to: 'parent@example.test', messageId: `<activity-${id(1)}@ionic-school-attendance.vercel.app>` }))
    expect(JSON.stringify(sendMail.mock.calls)).not.toContain('PRIVATE')
  })
  it('fails safely when SMTP configuration is missing without loading any transport', async () => {
    const load = vi.fn()
    await expect(smtpSender()(() => undefined, load)(alert())).rejects.toThrow('not configured')
    expect(load).not.toHaveBeenCalled()
  })
})
