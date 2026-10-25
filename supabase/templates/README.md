# MinSU Attendance email templates

Eight mobile-friendly, inline-HTML templates use the university seal, forest green, warm ivory, and muted gold. The source files are also wired into `supabase/config.toml` for local Auth.

Hosted Supabase does **not** read local template files automatically. To preview the narrow update:

```powershell
node scripts/configure-auth-emails.mjs --project-ref fgfmhpqjokmpplpdaqtn
```

An administrator with an existing `SUPABASE_ACCESS_TOKEN` in their shell can append `--apply`, then `--check`. Never paste or commit that token. The script updates these eight subjects/bodies, enables their four security notifications and manual identity linking, applies the user-approved 1800-second email-action lifetime, and requires email-change confirmation only at the new address. It does not replace SMTP credentials, OAuth provider credentials, redirect URLs, signup-confirmation settings, or sending limits. It never prints complete Auth configuration responses.

Alternatively, use an already authenticated Supabase CLI without reading or exporting its credentials. From the repository root:

```powershell
pnpm exec supabase config diff --project-ref fgfmhpqjokmpplpdaqtn --workdir scripts/auth-config
pnpm exec supabase config push --project-ref fgfmhpqjokmpplpdaqtn --workdir scripts/auth-config
pnpm exec supabase config diff --project-ref fgfmhpqjokmpplpdaqtn --workdir scripts/auth-config
```

Review the first diff before approving the push. The dedicated `scripts/auth-config/supabase/config.toml` declares **only** manual linking, the 1800-second email-action lifetime, new-address-only email-change confirmation, and these templates/notifications; undeclared hosted settings remain unchanged. Its `supabase/templates/` copies have the same HTML content as the source templates (tested) so the CLI’s project-root containment rule is satisfied; update both copies together. Do not push the main local-development config to production. The last diff should have no remaining *declared updates*; it may still list undeclared hosted properties as `remote_only`.

CLI `config diff`/`pull` do not compare HTML bodies. CLI 2.119.0 `config push` does load each file and compare it with the hosted HTML before deciding whether an Auth update is needed. After publishing, run a second push without `--yes` and explicitly decline any unexpected change (`'n' | pnpm exec supabase config push --project-ref fgfmhpqjokmpplpdaqtn --workdir scripts/auth-config`, with no automatic-approval environment variable). The result must contain Auth `status: "up_to_date"` and `changes: []`; this confirms both bodies and declared settings match without sending email or changing settings. A `skipped` or `unavailable` result is not verification. The Management API script’s `--check` remains another option when a scoped token is available.

The current narrow profile and templates require a fresh deployment and matching verification after any edit. SMTP, OAuth providers, redirect URLs, signup confirmations, and email quotas remain outside this update. No test emails are required to publish or compare the configuration.

Templates may also be copied individually into Supabase → Authentication → Email templates. Enable Password changed, Email address changed, Sign-in method linked, and Sign-in method removed notifications there.

The seal uses the canonical public HTTPS PNG URL so a trailing slash or stale Site URL cannot break it. Receiving mail apps may still require the recipient to enable remote images. Keep `/auth/callback` and the Android callback in the redirect allow list. All four action templates open the app with a single-use `TokenHash`; the callback calls `verifyOtp({ type: 'email' | 'email_change' | 'recovery' | 'invite', token_hash })` before continuing, including in a different browser. This avoids coupling emailed links to a shorter-lived PKCE verifier. New email changes require confirmation only from the new inbox (`double_confirm_changes=false`, Management API `mailer_secure_email_change_enabled=false`). Informational email-change notifications remain enabled. The callback retains a truthful pending state for a partially confirmed link issued under older settings. An existing cached session never bypasses token verification or expired-link errors.

The new reviewed configuration sets `auth.email.otp_expiry = 1800` (`mailer_otp_exp` in the Management API). Supabase shares this server-enforced lifetime across registration, invitations, password recovery, magic links/OTPs, and email changes. Security-notification emails are informational and do not expire. Existing expired `new_email` values may remain stored in Auth; the UI uses the authoritative `email_change_sent_at` timestamp to mark them expired and offer a fresh request, never to approve the address. It does not pretend that the server has deleted a pending request.

The parent invite is only sent by the authorized invite-parent Edge Function. Accepting an invitation does not approve a student link: parents still verify each request in the portal. `.Provider` is used only in the linked/removed notifications; `.NewEmail` only in email-change confirmation; `.OldEmail` only in the email-changed notification.

SMTP delivery and Spam placement remain controlled by the sender provider and receiving mail service. No template can guarantee Inbox placement.
