export interface InvitationReservation {
  invitation_id: string | null
  should_send: boolean
}

export interface InviteParentDependencies {
  siteUrl: string
  allowedOrigins: string[]
  identify: (token: string) => Promise<{ id: string; emailVerified: boolean } | null>
  reserve: (actorId: string, email: string) => Promise<InvitationReservation>
  invite: (email: string, redirectTo: string) => Promise<boolean>
  finish: (invitationId: string, sent: boolean) => Promise<void>
  reportError?: (code: string) => void
}

/** All privileged access stays behind these verified-user and database gates. */
export function createInviteParentHandler(dependencies: InviteParentDependencies) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin')
    const cors: Record<string, string> = {
      'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
      'cache-control': 'no-store',
      vary: 'Origin',
    }
    const response = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: cors })
    if (origin && !dependencies.allowedOrigins.includes(origin)) return response({ error: 'Origin not allowed' }, 403)
    if (origin) cors['access-control-allow-origin'] = origin
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405)
    const token = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (!token) return response({ error: 'Sign in before inviting a parent.' }, 401)

    try {
      const user = await dependencies.identify(token)
      if (!user?.emailVerified) return response({ error: 'Sign in with a verified email before inviting a parent.' }, 401)
      if (Number(request.headers.get('content-length') || 0) > 4096) return response({ error: 'Request is too large.' }, 413)
      const body = await request.text()
      if (body.length > 4096) return response({ error: 'Request is too large.' }, 413)
      let parsed: unknown
      try { parsed = JSON.parse(body) } catch { return response({ error: 'Enter a valid parent email.' }, 400) }
      const email = parsed && typeof parsed === 'object' && 'email' in parsed && typeof parsed.email === 'string'
        ? parsed.email.trim().toLowerCase() : ''
      if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response({ error: 'Enter a valid parent email.' }, 400)
      const reservation = await dependencies.reserve(user.id, email)
      if (reservation.should_send && reservation.invitation_id) {
        let sent = false
        try {
          sent = await dependencies.invite(email, new URL('/auth/callback', dependencies.siteUrl).toString())
        } finally {
          await dependencies.finish(reservation.invitation_id, sent)
        }
        if (!sent) return response({ error: 'The invitation service could not send the email. Please contact the administrator.' }, 503)
      }
      // Neither existing identities nor invitation duplication are disclosed.
      return response({ accepted: true, message: 'If eligible, a parent invitation has been sent. Ask them to check their inbox and spam folder.' })
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'unknown'
      dependencies.reportError?.(code)
      if (code === '42901') return response({ error: 'Please wait before sending more parent invitations.' }, 429)
      if (code === '42501') return response({ error: 'Only verified students, approved teachers and administrators can invite parents.' }, 403)
      if (code === '22023') return response({ error: 'Enter a valid parent email.' }, 400)
      return response({ error: 'The invitation could not be requested. Please try again later.' }, 503)
    }
  }
}
