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

Review the first diff before approving the push. The dedicated `scripts/auth-config/supabase/config.toml` declares **only** manual linking and these templates/notifications; undeclared hosted settings remain unchanged. Its `supabase/templates/` copies have the same HTML content as the source templates (tested) so the CLI’s project-root containment rule is satisfied; update both copies together. Do not push the main local-development config to production. The last diff should have no remaining *declared updates*; it may still list undeclared hosted properties as `remote_only`.

CLI `config diff`/`pull` do not compare HTML bodies. CLI 2.119.0 `config push` does load each file and compare it with the hosted HTML before deciding whether an Auth update is needed. After publishing, run a second push without `--yes` and explicitly decline any unexpected change (`'n' | pnpm exec supabase config push --project-ref fgfmhpqjokmpplpdaqtn --workdir scripts/auth-config`, with no automatic-approval environment variable). The result must contain Auth `status: "up_to_date"` and `changes: []`; this confirms both bodies and declared settings match without sending email or changing settings. A `skipped` or `unavailable` result is not verification. The Management API script’s `--check` remains another option when a scoped token is available.

On October 25, the narrow profile was published to the attendance project. The second, non-approving push confirmed Auth was up to date with no changes. All eight subjects/bodies, four security notifications, and manual identity linking matched; SMTP, OAuth providers, redirect URLs, confirmation rules, and email quotas were left unchanged. No test emails were sent.

Templates may also be copied individually into Supabase → Authentication → Email templates. Enable Password changed, Email address changed, Sign-in method linked, and Sign-in method removed notifications there.

The hosted Site URL must point to the deployed app so the seal loads. Keep `/auth/callback` and the Android callback in the redirect allow list. The recovery and invitation templates open the app with a single-use `TokenHash`; the callback calls `verifyOtp({ type: 'recovery' | 'invite', token_hash })` before continuing, including when the email opens in a different browser. The invite hash is important because admin invitations do not support PKCE and ordinary implicit-grant redirects are incompatible with this app’s PKCE client. Standard registration and email-change messages use Supabase's `ConfirmationURL`.

The parent invite is only sent by the authorized invite-parent Edge Function. Accepting an invitation does not approve a student link: parents still verify each request in the portal. `.Provider` is used only in the linked/removed notifications; `.NewEmail` only in email-change confirmation; `.OldEmail` only in the email-changed notification.

SMTP delivery and Spam placement remain controlled by the sender provider and receiving mail service. No template can guarantee Inbox placement.
