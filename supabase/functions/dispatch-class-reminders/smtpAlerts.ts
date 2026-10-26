import { activityEmailContent, type ActivityAlert } from './activityAlerts.ts'

interface MailTransport { sendMail(message: Record<string, unknown>): Promise<{ messageId?: string; accepted?: unknown[]; rejected?: unknown[] }>; verify?(): Promise<unknown> }
interface Mailer { createTransport(options: Record<string, unknown>): MailTransport }
function senderIdentity(value: string): { name: string; address: string } {
  if (/[\r\n]/.test(value) || value.length > 320) throw new Error('Invalid alert sender')
  const formatted = value.match(/^(.+?)\s*<([^<>]+)>$/)
  const address = (formatted?.[2] ?? value).trim()
  let name = formatted?.[1]?.trim() ?? 'MinSU Attendance'
  if (name.startsWith('"') && name.endsWith('"')) name = name.slice(1, -1).trim()
  if (!name || /[<>\r\n]/.test(name) || !/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(address)) throw new Error('Invalid alert sender')
  return { name, address }
}
/** Lazy loading means an SMTP outage/configuration error cannot block push. */
export function createSmtpAlertSender(getSecret: (name: string) => string | undefined, loadMailer?: () => Promise<Mailer>) {
  let transport: MailTransport | undefined
  const required = (name: string) => { const value = getSecret(name)?.trim(); if (!value) throw new Error('Activity email transport is not configured'); return value }
  const getTransport = async () => {
    const from = senderIdentity(required('ALERT_SMTP_FROM'))
    if (!transport) {
      const port = Number(required('ALERT_SMTP_PORT'))
      // Hosted Supabase Edge Functions prohibit outgoing SMTP ports25/587.
      if (port !== 465) throw new Error('Use implicit TLS SMTP port465 for activity email')
      const options = {
        host: required('ALERT_SMTP_HOST'), port, secure: port === 465, requireTLS: true,
        auth: { user: required('ALERT_SMTP_USER'), pass: required('ALERT_SMTP_PASSWORD') },
        tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
        connectionTimeout: 7000, greetingTimeout: 7000, socketTimeout: 10000,
        pool: false, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
      }
      const mailer = loadMailer ? await loadMailer() : (await import('npm:nodemailer@10.2.1')).default
      transport = mailer.createTransport(options)
    }
    return { transport, from }
  }
  const send = async (alert: ActivityAlert): Promise<string> => {
    const { transport, from } = await getTransport()
    const content = activityEmailContent(alert, getSecret('ALERT_SITE_URL') || 'https://ionic-school-attendance.vercel.app')
    const messageId = `<activity-${alert.id}@ionic-school-attendance.vercel.app>`
    const result = await transport.sendMail({ from, to: alert.recipient_email, ...content, messageId, disableFileAccess: true, disableUrlAccess: true })
    if (result.rejected?.length || !result.accepted?.length) throw new Error('Activity email was not accepted by SMTP')
    return result.messageId || messageId
  }
  return Object.assign(send, { verify: async () => {
    const { transport } = await getTransport()
    if (!transport.verify) throw new Error('Activity email transport verification is unavailable')
    await transport.verify()
  } })
}
