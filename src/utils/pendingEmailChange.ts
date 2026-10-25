/** Keep this equal to auth.email.otp_expiry in the narrow hosted configuration. */
export const AUTH_EMAIL_LINK_LIFETIME_SECONDS = 1800
export interface PendingEmailAccount { email?: string; new_email?: string; email_change_sent_at?: string }
export function pendingEmailChange(account: PendingEmailAccount | null | undefined, now = Date.now()) {
  const address = account?.new_email?.trim() ?? ''
  if (!address || address.toLowerCase() === account?.email?.toLowerCase()) return { status: 'none' as const, address: '', requestedAt: null, expiresAt: null }
  const requestedAt = Date.parse(account?.email_change_sent_at ?? '')
  if (!Number.isFinite(requestedAt) || requestedAt > now + 60_000) return { status: 'unknown' as const, address, requestedAt: null, expiresAt: null }
  const expiresAt = requestedAt + AUTH_EMAIL_LINK_LIFETIME_SECONDS * 1000
  return { status: now >= expiresAt ? 'expired' as const : 'pending' as const, address, requestedAt, expiresAt }
}
