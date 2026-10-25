interface AlertClient {
  rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>
}
interface AlertLease { id: string; lease_token: string }
export interface ActivityAlert {
  id: string; channel: 'email' | 'push'; kind: 'attendance' | 'teacher_request' | 'teacher_decision'
  audience: 'student' | 'parent' | 'teacher' | 'admin'; status: 'present' | 'absent' | 'pending' | 'approved' | 'rejected'
  recipient_email: string; push_token: string | null; subject_name: string
  class_name: string | null; meeting_starts_at: string | null; decision_note: string | null
}
export interface ActivityAlertResult { claimed: number; sent: number; failed: number; cancelled: number; error: boolean }
export interface AlertTransports {
  sendPush: (alert: ActivityAlert) => Promise<string>
  sendEmail: (alert: ActivityAlert) => Promise<string>
  isUnregisteredToken: (error: unknown) => boolean
  now?: () => number
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function validAlert(value: unknown, id: string): value is ActivityAlert {
  if (!value || typeof value !== 'object') return false
  const item = value as ActivityAlert
  if (item.id !== id || typeof item.subject_name !== 'string' || item.subject_name.length > 500) return false
  if (item.channel === 'email') {
    if (typeof item.recipient_email !== 'string' || item.recipient_email.length > 320 || !/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(item.recipient_email)) return false
  } else if (item.channel !== 'push' || typeof item.push_token !== 'string' || item.push_token.length < 16 || item.push_token.length > 4096 || /\s/.test(item.push_token)) return false
  if (item.kind === 'attendance') return ['present', 'absent'].includes(item.status) && (item.audience === 'parent' || item.audience === 'student' && item.channel === 'push')
  if (item.kind === 'teacher_request') return item.channel === 'email' && item.audience === 'admin' && item.status === 'pending'
  return item.kind === 'teacher_decision' && item.channel === 'email' && item.audience === 'teacher' && ['approved', 'rejected'].includes(item.status)
}

/** Failures stay within the activity queue; reminders and photo cleanup continue. */
export async function dispatchActivityAlerts(client: AlertClient, transports: AlertTransports): Promise<ActivityAlertResult> {
  const result: ActivityAlertResult = { claimed: 0, sent: 0, failed: 0, cancelled: 0, error: false }
  const now = transports.now ?? Date.now
  const startedAt = now()
  try {
    const claim = await client.rpc('claim_activity_alert_deliveries', { p_limit: 25 })
    if (claim.error || !Array.isArray(claim.data) || claim.data.length > 25) throw new Error('Alert queue unavailable')
    const leases = claim.data as AlertLease[]
    if (leases.some(item => !item || !UUID.test(item.id) || !UUID.test(item.lease_token)) || new Set(leases.map(item => item.id)).size !== leases.length) throw new Error('Invalid alert leases')
    result.claimed = leases.length
    for (const lease of leases) {
      // Leave the rest leased for a later invocation rather than exhausting the
      // dispatcher's Cron timeout or stopping scheduled reminders.
      if (now() - startedAt >= 35_000) break
      try {
        const resolution = await client.rpc('resolve_activity_alert_delivery', { p_id: lease.id, p_lease_token: lease.lease_token })
        if (resolution.error || !Array.isArray(resolution.data) || resolution.data.length > 1) throw new Error('Alert authorization unavailable')
        if (!resolution.data.length) { result.cancelled++; continue }
        const alert = resolution.data[0]
        if (!validAlert(alert, lease.id)) throw new Error('Invalid activity alert')
        const messageId = await (alert.channel === 'email' ? transports.sendEmail(alert) : transports.sendPush(alert))
        const completion = await client.rpc('complete_activity_alert_delivery', {
          p_id: lease.id, p_lease_token: lease.lease_token, p_succeeded: true,
          p_provider_message_id: String(messageId).slice(0, 250), p_disable_token: false,
        })
        if (completion.error || completion.data !== true) throw new Error('Alert completion unavailable')
        result.sent++
      } catch (error) {
        result.failed++
        try {
          await client.rpc('complete_activity_alert_delivery', {
            p_id: lease.id, p_lease_token: lease.lease_token, p_succeeded: false,
            p_provider_message_id: null, p_disable_token: transports.isUnregisteredToken(error),
          })
        } catch { /* The short lease expires and a later Cron invocation retries. */ }
      }
    }
  } catch { result.error = true }
  return result
}

export function activityAlertRoute(alert: Pick<ActivityAlert, 'audience'>): string {
  if (alert.audience === 'parent') return '/parent?section=history'
  if (alert.audience === 'student') return '/student?section=history'
  if (alert.audience === 'admin') return '/admin?section=teachers'
  return '/teacher'
}

export function activityPushContent(alert: ActivityAlert) {
  const present = alert.status === 'present'
  return {
    title: `Attendance: ${present ? 'Present' : 'Absent'}`,
    body: `${alert.audience === 'parent' ? 'Your linked child was' : 'You were'} marked ${present ? 'present' : 'absent'}. Open MinSU Attendance for details.`,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}
export function activityEmailContent(alert: ActivityAlert, site = 'https://ionic-school-attendance.vercel.app') {
  const base = new URL(site)
  if (base.protocol !== 'https:') throw new Error('Activity email requires an HTTPS site URL')
  const subject = alert.kind === 'attendance'
    ? `MinSU Attendance — ${alert.status === 'present' ? 'Present' : 'Absent'} attendance update`
    : alert.kind === 'teacher_request' ? 'MinSU Attendance — New teacher approval request'
      : `MinSU Attendance — Teacher registration ${alert.status}`
  const title = alert.kind === 'attendance' ? `${alert.subject_name}: ${alert.status === 'present' ? 'Present' : 'Absent'}`
    : alert.kind === 'teacher_request' ? 'Teacher approval requested' : `Your teacher registration was ${alert.status}`
  const time = alert.meeting_starts_at ? new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'full', timeStyle: 'short' }).format(new Date(alert.meeting_starts_at)) : ''
  const explanation = alert.kind === 'attendance'
    ? `${alert.subject_name} was marked ${alert.status}${alert.class_name ? ` for ${alert.class_name}` : ''}${time ? ` (${time})` : ''}. Open the parent portal to view the attendance record. If the teacher corrects attendance, you will receive the updated status.`
    : alert.kind === 'teacher_request' ? `${alert.subject_name} has completed teacher registration and is waiting for your review. Sign in as an administrator to approve or reject the request.`
      : alert.status === 'approved' ? 'Your teacher account is approved. You can now manage your classes, weekly schedules, and attendance.'
        : 'Your teacher registration was rejected. Contact the project administrator if you need help with your registration.'
  const note = alert.kind === 'teacher_decision' && alert.decision_note ? alert.decision_note.slice(0, 500) : ''
  const link = new URL(activityAlertRoute(alert), base).toString()
  const logo = new URL('/minsu-logo.png', base).toString()
  const text = `${title}\n\n${explanation}${note ? `\n\nAdministrator note: ${note}` : ''}\n\nOpen MinSU Attendance: ${link}\n\nThis is an automated message from the MinSU Attendance student project.`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;padding:28px 12px;background:#f1f4ee;color:#263c30;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dfe6dd;border-radius:14px;overflow:hidden"><tr><td style="height:5px;background:#087443"></td></tr><tr><td style="padding:30px 32px 16px;text-align:center"><img src="${escapeHtml(logo)}" width="72" height="72" alt="Mindoro State University seal" style="display:block;margin:0 auto 14px"><strong style="font-size:23px;color:#29483a">MinSU Attendance</strong></td></tr><tr><td style="padding:10px 32px 32px"><h1 style="font-size:24px;line-height:32px;margin:0 0 16px">${escapeHtml(title)}</h1><p style="font-size:15px;line-height:25px;color:#56635c">${escapeHtml(explanation)}</p>${note ? `<p style="padding:14px;background:#f2f5ef;border:1px solid #dfe6dd;line-height:23px">Administrator note: ${escapeHtml(note)}</p>` : ''}<p style="margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 24px;background:#087443;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold">Open your portal</a></p><p style="font-size:12px;line-height:20px;color:#647168">If the button does not work, copy this link:<br><a href="${escapeHtml(link)}" style="color:#087443;word-break:break-all">${escapeHtml(link)}</a></p></td></tr><tr><td style="padding:18px 32px;background:#f6f7f3;border-top:1px solid #dfe6dd;font-size:11px;line-height:18px;color:#69736d">Automated notification from the MinSU Attendance student project. This is not an official university email service.</td></tr></table></td></tr></table></body></html>`
  return { subject, text, html }
}
