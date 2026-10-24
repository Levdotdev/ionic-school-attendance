import { createClient } from 'npm:@supabase/supabase-js@2.117.2'
import { createInviteParentHandler } from './handler.ts'

const siteUrl = Deno.env.get('SITE_URL') || 'https://ionic-school-attendance.vercel.app'
const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
const allowedOrigins = [
  new URL(siteUrl).origin,
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
  'https://localhost', 'capacitor://localhost',
]

Deno.serve(createInviteParentHandler({
  siteUrl,
  allowedOrigins,
  async identify(token) {
    // getUser verifies the user token with Auth, not an untrusted decoded JWT.
    const { data, error } = await admin.auth.getUser(token)
    return error || !data.user ? null : { id: data.user.id, emailVerified: Boolean(data.user.email_confirmed_at) }
  },
  async reserve(actorId, email) {
    const { data, error } = await admin.rpc('reserve_parent_invitation', { p_actor: actorId, p_email: email })
    if (error) throw error
    if (!data?.[0]) throw new Error('Invitation reservation failed')
    return data[0]
  },
  async invite(email, redirectTo) {
    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      // Display context only. Authorization comes from the server-only
      // invitation reservation and immutable database profile, never this.
      data: { invitation_kind: 'parent' },
    })
    if (error) console.error('Parent invitation delivery failed', { code: error.code || 'unknown' })
    return !error
  },
  async finish(invitationId, sent) {
    const { error } = await admin.rpc('finish_parent_invitation', { p_invitation_id: invitationId, p_sent: sent })
    if (error) throw error
  },
  reportError(code) { console.error('Parent invitation request failed', { code }) },
}))
