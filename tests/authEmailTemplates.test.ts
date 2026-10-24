// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyAuthEmailConfiguration, authEmailTemplates, buildAuthEmailPatch } from '../scripts/configure-auth-emails.mjs'

afterEach(() => vi.unstubAllGlobals())

describe('branded authentication emails', () => {
  it('builds all eight inline-HTML templates with university identity and supported variables', async () => {
    const patch = await buildAuthEmailPatch()
    expect(authEmailTemplates).toHaveLength(8)
    for (const template of authEmailTemplates) {
      const html = patch[`mailer_templates_${template.name}_content`]
      expect(html).toContain('MinSU Attendance')
      expect(html).toContain('{{ .SiteURL }}/minsu-logo.png')
      expect(html).toContain('role="presentation"')
      expect(html).not.toContain('MathVerse')
      const variables = [...String(html).matchAll(/{{\s*\.([A-Za-z]+)\s*}}/g)].map(match => match[1])
      expect(variables.every(variable => ['SiteURL', 'ConfirmationURL', 'Email', 'NewEmail', 'OldEmail', 'Provider', 'RedirectTo', 'TokenHash'].includes(variable!))).toBe(true)
      if (template.name !== 'email_change') expect(html).not.toContain('.NewEmail')
      if (template.name !== 'email_changed_notification') expect(html).not.toContain('.OldEmail')
      if (!template.name.startsWith('identity_')) expect(html).not.toContain('.Provider')
    }
    expect(patch.mailer_templates_recovery_content).toContain('?token_hash={{ .TokenHash }}&amp;type=recovery')
    expect(patch.mailer_templates_invite_content).toContain('does not automatically link a child')
    expect(patch.mailer_templates_invite_content).toContain('?token_hash={{ .TokenHash }}&amp;type=invite')
  })
  it('configures local Auth paths and every hosted security notification without touching SMTP or rate limits', async () => {
    const config = await readFile('supabase/config.toml', 'utf8')
    const patch = await buildAuthEmailPatch()
    expect(patch.security_manual_linking_enabled).toBe(true)
    expect(Object.keys(patch).filter(key => /mailer_notifications_.*_enabled/.test(key))).toHaveLength(4)
    expect(Object.keys(patch).some(key => /smtp|rate_limit|site_url|external_/.test(key))).toBe(false)
    for (const template of authEmailTemplates) expect(config).toContain(`./supabase/templates/${template.name}.html`)
    const narrowConfig = await readFile('scripts/auth-config/supabase/config.toml', 'utf8')
    expect(narrowConfig).toContain('enable_manual_linking = true')
    expect(narrowConfig).not.toMatch(/^\s*(smtp_|site_url|additional_redirect_urls|minimum_password_length|email_sent|max_frequency|enable_signup|enable_confirmations)\s*=/m)
    for (const template of authEmailTemplates) {
      expect(narrowConfig).toContain(`./supabase/templates/${template.name}.html`)
      const deploymentCopy = await readFile(`scripts/auth-config/supabase/templates/${template.name}.html`, 'utf8')
      expect(deploymentCopy.trim()).toBe(String(patch[`mailer_templates_${template.name}_content`]).trim())
    }
  })
  it('only sends the reviewed narrow patch, verifies it, and never returns unrelated secret config', async () => {
    const expected = await buildAuthEmailPatch()
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ smtp_pass: 'do-not-expose' }) }).mockResolvedValueOnce({ ok: true, json: async () => ({ ...expected, smtp_pass: 'do-not-expose' }) })
    vi.stubGlobal('fetch', fetchMock)
    const result = await applyAuthEmailConfiguration('fgfmhpqjokmpplpdaqtn', 'test-token')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expected)
    expect(result.matching).toBe(true)
    expect(JSON.stringify(result)).not.toContain('do-not-expose')
    expect(fetchMock.mock.calls[1][1].method).toBe('GET')
  })
  it('check mode is read only, rejects missing credentials and hides failed response bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, json: async () => ({ smtp_pass: 'do-not-expose' }) })
    vi.stubGlobal('fetch', fetchMock)
    await expect(applyAuthEmailConfiguration('fgfmhpqjokmpplpdaqtn', undefined)).rejects.toThrow('SUPABASE_ACCESS_TOKEN')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(applyAuthEmailConfiguration('fgfmhpqjokmpplpdaqtn', 'test-token', { checkOnly: true })).rejects.toThrow('HTTP 403')
    expect(fetchMock.mock.calls[0][1].method).toBe('GET')
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
  })
})
