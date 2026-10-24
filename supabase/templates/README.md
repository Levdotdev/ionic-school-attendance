# MinSU Attendance email templates

Eight mobile-friendly, inline-HTML templates use the university seal, forest green, warm ivory, and muted gold. The source files are also wired into `supabase/config.toml` for local Auth.

Hosted Supabase does **not** read local template files automatically. To preview the narrow update:

```powershell
node scripts/configure-auth-emails.mjs --project-ref fgfmhpqjokmpplpdaqtn
```

An administrator with an existing `SUPABASE_ACCESS_TOKEN` in their shell can append `--apply`, then `--check`. Never paste or commit that token. The script only updates these eight subjects/bodies, enables their four security notifications, and enables manual identity linking. It does not replace SMTP credentials, OAuth provider credentials, redirect URLs, confirmation policies, or sending limits. It never prints complete Auth configuration responses.

Alternatively, use an already authenticated Supabase CLI without reading or exporting its credentials. From the repository root:

```powershell
pnpm exec supabase config diff --project-ref fgfmhpqjokmpplpdaqtn --workdir scripts/auth-config
pnpm exec supabase config push --project-ref fgfmhpqjokmpplpdaqtn --workdir scripts/auth-config
pnpm exec supabase config diff --project-ref fgfmhpqjokmpplpdaqtn --workdir scripts/auth-config
```

Review the first diff before approving the push. The dedicated `scripts/auth-config/supabase/config.toml` declares **only** manual linking and these templates/notifications; undeclared hosted settings remain unchanged. Its `supabase/templates/` copies have the same HTML content as the source templates (tested) so the CLI’s project-root containment rule is satisfied; update both copies together. Do not push the main local-development config to production. The last diff should report no remaining changes. The CLI may show subjects/flags in its diff but loads HTML bodies during push, so verify hosted bodies separately with `--check` using the Management API script when a token is available. CLI `--help` must confirm support for `config diff`/`push` and `--workdir` in the installed version.

Templates may also be copied individually into Supabase → Authentication → Email templates. Enable Password changed, Email address changed, Sign-in method linked, and Sign-in method removed notifications there.

The hosted Site URL must point to the deployed app so the seal loads. Keep `/auth/callback` and the Android callback in the redirect allow list. The recovery and invitation templates open the app with a single-use `TokenHash`; the callback calls `verifyOtp({ type: 'recovery' | 'invite', token_hash })` before continuing, including when the email opens in a different browser. The invite hash is important because admin invitations do not support PKCE and ordinary implicit-grant redirects are incompatible with this app’s PKCE client. Standard registration and email-change messages use Supabase's `ConfirmationURL`.

The parent invite is only sent by the authorized invite-parent Edge Function. Accepting an invitation does not approve a student link: parents still verify each request in the portal. `.Provider` is used only in the linked/removed notifications; `.NewEmail` only in email-change confirmation; `.OldEmail` only in the email-changed notification.

SMTP delivery and Spam placement remain controlled by the sender provider and receiving mail service. No template can guarantee Inbox placement.
