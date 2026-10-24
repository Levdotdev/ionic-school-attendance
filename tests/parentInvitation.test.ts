// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createInviteParentHandler, type InviteParentDependencies } from '../supabase/functions/invite-parent/handler'

const origin = 'https://ionic-school-attendance.vercel.app'
function setup(overrides: Partial<InviteParentDependencies> = {}) {
  const dependencies: InviteParentDependencies = {
    siteUrl: origin,
    allowedOrigins: [origin],
    identify: vi.fn(async () => ({ id: 'verified-actor', emailVerified: true })),
    reserve: vi.fn(async () => ({ invitation_id: 'reservation-1', should_send: true })),
    invite: vi.fn(async () => true),
    finish: vi.fn(async () => undefined),
    reportError: vi.fn(),
    ...overrides,
  }
  return { dependencies, handler: createInviteParentHandler(dependencies) }
}
function request(email = 'parent@example.com', headers: Record<string, string> = {}) {
  return new Request(`${origin}/functions/v1/invite-parent`, {
    method: 'POST', headers: { authorization: 'Bearer verified-user-token', origin, 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ email }),
  })
}

describe('parent invitation endpoint', () => {
  it('verifies the user, normalizes email, reserves before delivery and uses a fixed safe callback', async () => {
    const { dependencies, handler } = setup()
    const response = await handler(request(' Parent@Example.com '))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ accepted: true })
    expect(dependencies.identify).toHaveBeenCalledWith('verified-user-token')
    expect(dependencies.reserve).toHaveBeenCalledWith('verified-actor', 'parent@example.com')
    expect(dependencies.invite).toHaveBeenCalledWith('parent@example.com', `${origin}/auth/callback`)
    expect(dependencies.finish).toHaveBeenCalledWith('reservation-1', true)
    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('does not disclose or resend an existing or duplicate identity', async () => {
    const { dependencies, handler } = setup({ reserve: vi.fn(async () => ({ invitation_id: null, should_send: false })) })
    const existing = await handler(request())
    const successful = await setup().handler(request())
    expect(await existing.json()).toEqual(await successful.json())
    expect(dependencies.invite).not.toHaveBeenCalled()
    expect(dependencies.finish).not.toHaveBeenCalled()
  })

  it.each([null, { id: 'unverified', emailVerified: false }])('rejects an invalid or unverified session before privileged work', async (identity) => {
    const { dependencies, handler } = setup({ identify: vi.fn(async () => identity) })
    expect((await handler(request())).status).toBe(401)
    expect(dependencies.reserve).not.toHaveBeenCalled()
    expect(dependencies.invite).not.toHaveBeenCalled()
  })

  it('requires authorization and rejects unknown browser origins and unsupported methods', async () => {
    const { dependencies, handler } = setup()
    expect((await handler(request('parent@example.com', { authorization: '' }))).status).toBe(401)
    expect((await handler(request('parent@example.com', { origin: 'https://untrusted.example' }))).status).toBe(403)
    expect((await handler(new Request(origin))).status).toBe(405)
    expect(dependencies.identify).not.toHaveBeenCalled()
    expect((await handler(new Request(origin, { method: 'OPTIONS', headers: { origin } }))).status).toBe(204)
  })

  it.each(['bad', 'parent@example.com\nBcc:other@example.com', '', 'x'.repeat(321) + '@example.com'])('rejects invalid email input without a reservation', async email => {
    const { dependencies, handler } = setup()
    expect((await handler(request(email))).status).toBe(400)
    expect(dependencies.reserve).not.toHaveBeenCalled()
  })

  it('rejects malformed and oversized payloads', async () => {
    const { dependencies, handler } = setup()
    const make = (body: string) => new Request(origin, { method: 'POST', headers: { authorization: 'Bearer token' }, body })
    expect((await handler(make('{'))).status).toBe(400)
    expect((await handler(make('x'.repeat(4097)))).status).toBe(413)
    expect(dependencies.reserve).not.toHaveBeenCalled()
  })

  it.each([['42501', 403], ['42901', 429], ['22023', 400]])('honors database authorization and abuse controls (%s)', async (code, status) => {
    const { dependencies, handler } = setup({ reserve: vi.fn(async () => { throw { code, message: 'Sensitive internals' } }) })
    const response = await handler(request())
    expect(response.status).toBe(status)
    expect(JSON.stringify(await response.json())).not.toContain('Sensitive internals')
    expect(dependencies.invite).not.toHaveBeenCalled()
  })

  it('records failed delivery and does not falsely claim an email was sent', async () => {
    const { dependencies, handler } = setup({ invite: vi.fn(async () => false) })
    const response = await handler(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('could not send') })
    expect(dependencies.finish).toHaveBeenCalledWith('reservation-1', false)
  })

  it('records a transport failure without logging an address or exposing an Auth response', async () => {
    const { dependencies, handler } = setup({ invite: vi.fn(async () => { throw new Error('secret-invite-link') }) })
    const response = await handler(request())
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('secret-invite-link')
    expect(dependencies.finish).toHaveBeenCalledWith('reservation-1', false)
    expect(dependencies.reportError).toHaveBeenCalledWith('unknown')
  })
})
