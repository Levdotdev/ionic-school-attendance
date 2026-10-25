import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

export const authEmailTemplates = Object.freeze([
  { name: 'confirmation', subject: 'MinSU Attendance — Confirm your account' },
  { name: 'email_change', subject: 'MinSU Attendance — Confirm your new email address' },
  { name: 'recovery', subject: 'MinSU Attendance — Reset your password' },
  { name: 'invite', subject: 'MinSU Attendance — You are invited to the parent portal' },
  { name: 'password_changed_notification', subject: 'MinSU Attendance — Your password was changed', notification: 'password_changed' },
  { name: 'email_changed_notification', subject: 'MinSU Attendance — Your email address was changed', notification: 'email_changed' },
  { name: 'identity_linked_notification', subject: 'MinSU Attendance — A sign-in method was linked', notification: 'identity_linked' },
  { name: 'identity_unlinked_notification', subject: 'MinSU Attendance — A sign-in method was removed', notification: 'identity_unlinked' },
])

/** Narrow PATCH: no SMTP credentials, rate limits, providers, or redirect changes. */
export async function buildAuthEmailPatch() {
  const patch = { security_manual_linking_enabled: true, mailer_otp_exp: 1800 }
  for (const template of authEmailTemplates) {
    patch[`mailer_subjects_${template.name}`] = template.subject
    patch[`mailer_templates_${template.name}_content`] = await readFile(new URL(`../supabase/templates/${template.name}.html`, import.meta.url), 'utf8')
    if (template.notification) patch[`mailer_notifications_${template.notification}_enabled`] = true
  }
  return patch
}

export async function applyAuthEmailConfiguration(projectRef, accessToken, { checkOnly = false } = {}) {
  if (!/^[a-z0-9]{20}$/.test(projectRef)) throw new Error('Pass the exact 20-character Supabase project reference.')
  if (!accessToken?.trim()) throw new Error('Set SUPABASE_ACCESS_TOKEN in this shell. Do not paste a token into chat or commit it.')
  const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`
  const patch = await buildAuthEmailPatch()
  const request = async (method, body) => {
    const response = await fetch(endpoint, {
      method,
      headers: { Authorization: `Bearer ${accessToken.trim()}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30_000),
    })
    // Auth config responses can contain secrets. Do not log their bodies.
    if (!response.ok) throw new Error(`Supabase Auth configuration ${method} failed (HTTP ${response.status}). No server response body was printed.`)
    return response.json()
  }
  if (!checkOnly) await request('PATCH', patch)
  const current = await request('GET')
  const mismatchedFields = Object.keys(patch).filter(key => current[key] !== patch[key])
  return { projectRef, mode: checkOnly ? 'check' : 'apply', templates: authEmailTemplates.length, manualLinkingEnabled: current.security_manual_linking_enabled === true, matching: mismatchedFields.length === 0, mismatchedFields }
}

async function main() {
  const args = process.argv.slice(2)
  const projectRef = args[args.indexOf('--project-ref') + 1]
  if (!args.includes('--project-ref') || !/^[a-z0-9]{20}$/.test(projectRef ?? '')) throw new Error('Usage: node scripts/configure-auth-emails.mjs --project-ref PROJECT_REF [--apply | --check]')
  if (args.includes('--apply') && args.includes('--check')) throw new Error('Choose --apply or --check, not both.')
  if (!args.includes('--apply') && !args.includes('--check')) {
    const patch = await buildAuthEmailPatch()
    console.log(JSON.stringify({ mode: 'preview', projectRef, templates: authEmailTemplates.map(template => template.name), settings: Object.keys(patch), note: 'No requests were made. Use --apply to publish, or --check to verify. SMTP settings and sending limits are untouched.' }, null, 2))
    return
  }
  console.log(JSON.stringify(await applyAuthEmailConfiguration(projectRef, process.env.SUPABASE_ACCESS_TOKEN, { checkOnly: args.includes('--check') }), null, 2))
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error instanceof Error ? error.message : 'Auth configuration failed.'); process.exitCode = 1 })
}
