# Class reminder dispatcher

This server-only Edge Function claims due class reminders from Postgres and
sends Android push notifications through the Firebase Cloud Messaging HTTP v1
API. Database uniqueness constraints and worker leases prevent duplicate work.

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

At present the dispatcher sends Android FCM tokens. The schema can retain APNs
tokens for a future iOS sender, but an APNs provider must be added before iOS
remote notifications are enabled.
