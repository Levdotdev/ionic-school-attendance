# Class reminder dispatcher

This server-only Edge Function claims due class reminders from Postgres and
sends Android push notifications through the Firebase Cloud Messaging HTTP v1
API. Database uniqueness constraints and worker leases prevent duplicate work.

The same authenticated invocation also clears deleted attendance photos through
the Supabase Storage API, including when no reminders are due or Firebase has
not been configured. Apply
`20261025113454_delete_schedule_generated_meetings_and_cleanup_photos.sql` before
deploying this worker update. The existing one-minute Cron is reused; no new
secret or schedule is required.

Each call claims at most 100 private deletion requests with a five-minute lease.
The database excludes unsafe paths and photos still referenced by attendance;
the worker validates the returned paths again and removes objects only from
`attendance-selfies`. It acknowledges successful Storage removal afterward.
Failures release the lease with database-managed retry backoff; if release is
unavailable, the lease expires for a later invocation. Cleanup failures do not
stop reminders. Responses include aggregate `photo_cleanup` counts, and neither
responses nor cleanup logs include photo paths. Keep the minute-by-minute Cron
active even when push delivery is not enabled so queued photo removal can run.

## Required setup

1. In Firebase, create/register the Android app with package ID
   `edu.minsu.attendance`, enable the Cloud Messaging API (HTTP v1), and put
   the downloaded client file at `android/app/google-services.json`.
2. In Firebase Project settings > Service accounts, generate a service-account
   JSON key. Keep it secret; do not add it to this repository.
3. Create a long random dispatcher secret. Set both production secrets:

   ```sh
   supabase secrets set FIREBASE_SERVICE_ACCOUNT_JSON='<single-line-json>'
   supabase secrets set REMINDER_DISPATCH_SECRET='<long-random-value>'
   ```

   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically by
   Supabase Edge Functions. For local development, copy `.env.example` to
   `supabase/functions/.env` and supply local values.
4. Apply the notification migration, deploy the function, and sync Capacitor:

   ```sh
   supabase db push
   supabase functions deploy dispatch-class-reminders --no-verify-jwt
   pnpm cap:sync
   ```

## Invoke every minute

The function deliberately does not create a cron job in the migration because
the deployment URL and secret do not belong in source control. Store them in
Supabase Vault, then schedule the call from SQL or Dashboard > Integrations >
Cron:

```sql
select vault.create_secret(
  'https://YOUR_PROJECT_REF.supabase.co',
  'reminder_project_url'
);
select vault.create_secret(
  'THE_SAME_LONG_RANDOM_VALUE',
  'reminder_dispatch_secret'
);

select cron.schedule(
  'dispatch-class-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'reminder_project_url'
    ) || '/functions/v1/dispatch-class-reminders',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-reminder-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'reminder_dispatch_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
  $$
);
```

The checked-in `verify_jwt = false` setting only bypasses the platform JWT
check for this server-to-server cron endpoint. The function still rejects every
request that does not contain the matching `x-reminder-secret` value.

## Attendance and approval alerts

The same authenticated one-minute Cron dispatcher also drains the private
activity-alert outbox. It sends:

- Present/absent attendance updates to the student's Android app.
- The same updates to each currently approved linked parent's Android app and
  current verified email address.
- New completed teacher-registration requests to verified administrator emails.
- Approval/rejection decisions to the teacher's current verified email.

There are no student attendance emails. Push lock-screen text omits names,
photos, precise location and biometric data. The email identifies the child,
subject and meeting time, with a link to the authenticated portal. Auth email
templates and invitation emails remain managed by Supabase Authentication.

Explicit marks/self-checks enqueue on write. Missing attendance is inferred only
after a counted meeting and its self-check window close, for an eligible enrolled
student. The migration records an activation cutoff so installation does not
send historical absence emails or replay existing teacher requests. Corrections
and voided self-checks supersede pending earlier status alerts. Canceled/deleted
meetings, archived classes, revoked parent consent and transferred/disabled device
tokens are rechecked before sending. Parent identity is the approved parent UUID;
delivery resolves the current verified Auth email and never uses an old mailbox
saved in an outbox payload.

Configure these additional server secrets through the Supabase CLI or dashboard:

```text
ALERT_SMTP_HOST=smtp.gmail.com
ALERT_SMTP_PORT=465
ALERT_SMTP_USER=<existing SMTP username>
ALERT_SMTP_PASSWORD=<existing SMTP app password>
ALERT_SMTP_FROM=MinSU Attendance <verified-sender@example.com>
ALERT_SITE_URL=https://ionic-school-attendance.vercel.app
```

Use implicit TLS on 465 for Gmail. TLS certificate verification remains enabled.
Credentials stay in server secrets, never in the frontend, SQL or repository.
Enter the actual Gmail app password directly in `ALERT_SMTP_PASSWORD`. The Auth
configuration API can return a SHA-256 fingerprint for `smtp_pass`; that is not a
usable SMTP password and must never be copied into the notification secret.
The protected `verify-email-transport` action checks connection/authentication
without sending a message or claiming delivery work. It requires the existing
dispatcher secret and returns only fixed failure categories and SMTP status
codes. Delivery failures also retain a fixed private diagnostic category; raw
provider responses and credentials are not stored.
SMTP is loaded lazily through pinned `npm:nodemailer@10.2.1`; an email transport
failure retries its own delivery and does not prevent Android pushes or class
reminders. Processing is bounded, leases are reclaimed after interruption, and
transient failures use backoff. Delivery is at least once: a provider accepting a
message immediately before a process interruption can cause a retry. Stable email
message IDs and Android notification tags reduce duplicate presentation.

Alerts are normally picked up by the next one-minute Cron run; provider delivery
and Android permissions/connectivity can add delay. This is not an exact-time or
guaranteed-delivery channel. No test email is sent by deployment. Verify actual
mailbox delivery and physical-device notification delivery with explicitly
authorized test recipients.

At present the dispatcher sends Android FCM tokens. The schema can retain APNs
tokens for a future iOS sender, but an APNs provider must be added before iOS
remote notifications are enabled.
