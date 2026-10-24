# MinSU School Attendance

An Ionic Vue school attendance system backed by Supabase Auth, PostgreSQL, Row Level Security, Edge Functions, and private Storage.

## Implemented features

### Accounts and access

- Email/password registration asks only for credentials. A shared account-setup dialog follows authentication.
- Google and Facebook sign-in support through Supabase OAuth.
- New teacher accounts remain pending until an administrator approves them.
- Role-based side menus for administrators, teachers, students, and parents.
- A persistent, collapsible desktop sidebar and mobile navigation drawer for all four roles.
- A profile-picture menu with account role, linked sign-in methods, account settings, change email/password, and sign-out dialogs. The light/dark toggle sits beside the profile picture.
- Mindoro State University logo with shared green-and-gold light and dark themes.
- Responsive sign-in and registration layout with a fixed information panel on wide screens.
- Content-sized dialogs for forms, account actions, attendance photos, and confirmations.
- Password-reset requests with clear provider errors and a dedicated recovery flow. Actual email delivery depends on Supabase's email configuration; see the SMTP section below.

Email, Google, and Facebook use the same one-time student, teacher, or parent setup. Teacher accounts always require administrator approval. Administrators are provisioned separately and cannot be selected during signup. The provider-neutral database setup is applied to the connected project.

### Attendance

- Camera-only scanning for long 1D student ID barcodes: Code 128, Code 39, Code 93, Codabar, ITF, EAN, and UPC.
- Raw barcode values are not stored in browser storage or public tables. PostgreSQL stores a one-way hash in a private schema.
- Manual teacher attendance with present and absent controls, including a fallback for a student who cannot complete a self-check. A manual mark cannot overwrite a submitted self-check or its photo.
- On-site self-check requires the physical ID barcode, a newly captured selfie, the school geofence, and face verification against the enrolled template.
- Online self-check requires a newly captured selfie, face verification, and location permission; no ID barcode or school geofence is required. Coordinates are stored in a private schema and are visible only to a currently verified linked parent.
- Event self-check is disabled; event attendance is handled manually by the teacher.
- Self-check submissions are accepted immediately. The teacher can inspect the evidence photo, void an invalid submission, or restore it.
- The actual submitted photo is previewed with a Manila timestamp and, on site, submitted coordinates/accuracy burned into its pixels.
- Online photos contain the capture timestamp without location coordinates, so teachers can inspect the photo without learning the private online location.
- Evidence photos are stored privately and are available only to the student, approved class teacher, and verified linked parent as authorized by database policies.
- Teachers open photos and void/restore controls directly from each student's Attendance row. There is no separate Evidence workspace.
- Submitted check-ins disappear from the available-check-in list and cannot be submitted a second time.
- The school geofence is fixed at `13.387419, 121.162494` with a `180` meter radius.

### Face verification

- Students enroll a private facial template once. They cannot remove or replace it themselves afterward.
- An administrator can authorize one retake. A successful validated replacement consumes that authorization; failed attempts leave the existing template and authorization intact.
- Enrollment uses three live camera samples and stores the derived template, not the enrollment photos.
- Self-check performs on-device face analysis and submits an actor-bound verification request to Supabase.
- The teacher can record a missing check-in manually when a student cannot enroll or the device cannot complete face analysis. Existing self-check submissions remain available for photo review, voiding, or restoration.

Face matching is an attendance aid, not a guarantee of identity. Teachers should still review questionable evidence and the school should define consent, retention, and access rules before production use with minors.

### Classes and schedules

- Teachers can create, edit, and delete classes, weekly schedules, and individual meetings through modals.
- Class creation asks for a class name; no section field is required.
- Teachers can archive and restore classes. Archiving preserves attendance/enrollment history and stops new joins, check-ins, generated meetings, and class reminders.
- A weekly schedule automatically produces the current week's meeting.
- A shared, responsive week/month/agenda calendar combines all active classes. Teachers can navigate weeks and open a meeting or recurring schedule from the calendar; students can see courses and dated tasks together.
- Calendar projections are labeled as planned until an actual meeting is generated. Actual meeting changes take precedence, and a deleted weekly occurrence is not projected again.
- Parent accounts show linked children's current weekly schedule and their complete available attendance history, including present, recorded absent, inferred absent after a meeting ends, and meetings that were not counted.
- Teachers can disable, restore, edit, or remove one meeting without changing the repeating schedule.
- Weekly schedules save the default attendance mode and both check-in opening and closing offsets. An empty closing offset uses the class end time. Weekly repetition is automatic and has no repeat toggle.
- Weekly schedule changes apply to new occurrences and preserve existing meeting overrides. Date inputs show the selected weekday on mobile and desktop.
- The database uses the Asia/Manila timezone when creating weekly occurrences and reminders.

### Notifications

- Teacher reminders: 5 minutes before class and at the start time.
- Each student chooses which reminders to enable per weekly schedule: 2 hours, 1 hour, 30 minutes, 15 minutes, 5 minutes, and at the start time. All can be turned off.
- The student's own choices are reused for future meetings; teachers do not set student reminder choices.
- Native Android push tokens are registered after sign-in, notification taps open the schedule, and sign-out removes the account/device mapping.
- A protected Supabase Edge Function claims queued deliveries and sends Android notifications through Firebase Cloud Messaging.

The notification code, schema, queue, and Edge Function are deployed, but actual delivery requires the Firebase credentials and scheduled invocation described in [`supabase/functions/dispatch-class-reminders/README.md`](supabase/functions/dispatch-class-reminders/README.md).

### Student tasks

- Course-linked tasks that use enrolled classes as subjects.
- Optional custom categories in addition to subjects.
- Create, edit, delete, complete, and reopen tasks.
- Priority, due date/time, recurrence, notes, links, search, filtering, and sorting.
- Private task attachments with database and Storage access policies.
- The original task manager's date-grouped cards, list/calendar views, summary filters, manual drag ordering, priorities, and recurrence filters.
- Complete/reopen a date, skip one repeat, stop future repeats, or delete an entire series through confirmation dialogs.
- Camera photos, private attachment downloads, and Android's save-file picker.
- Device-local task reminders, notification tap navigation, and sign-out cleanup.
- Task, category, edit, and confirmation dialogs; account/preferences and evidence dialogs use the same campus theme.

### Live updates

- Role dashboards, attendance, schedules, courses, task data, and profile information update automatically without refresh buttons.
- Clients subscribe to their own RLS-protected change counter and then re-read authorized data. Raw attendance, private coordinates, and facial templates are not broadcast to clients.
- Database triggers notify affected recipients after edits and before deletions. Reconnect, app focus, and a quiet time-window check recover missed changes.
- Background refresh preserves open editors and unsaved form values.

## Applied database release

These three migrations were applied to the connected production project on October 24, 2026, with explicit approval. Their local versions match Supabase's recorded versions:

1. `20261024050436_provider_neutral_account_setup.sql` — adds protected one-time role setup; preserves existing roles/approvals; untouched social accounts can select their intended role.
2. `20261024050508_recurring_schedule_attendance_defaults.sql` — saves weekly attendance defaults in both current-week and early-reminder meeting generators.
3. `20261024050518_fix_reminder_delivery_claim_conflict.sql` — fixes the confirmed `push_token_id is ambiguous` delivery-claim failure.

Post-release read-only checks confirmed that existing roles and teacher approval decisions were unchanged, setup and dispatcher permissions remain restricted, and both weekly generators use the new defaults. The first scheduled reminder dispatch after the fix returned HTTP 200 with no due deliveries. No credentials or production data are included in local tests.

Local PostgreSQL regression tests use an in-memory PGlite database with actual application migrations. The harness supplies minimal Auth/Storage fixtures and substitutes Cron scheduling functions; it does not test hosted Auth providers, FCM delivery, or device hardware.

The October 24 follow-up release applied `20261024103507_privacy_realtime_and_class_controls.sql` to production. It adds private online locations, one-time face enrollment with administrator retakes, avatars, class archiving, student reminder preferences, check-in closing offsets, authorized attendance history, manual teacher fallback, and recipient-only realtime counters. Post-release checks confirmed the new tables use RLS, the invalidation counter is published, and the existing attendance records were preserved. The filename matches the migration version recorded by Supabase.

### Parent consent, account security, and attendance simplification

The October 25 release adds `20261024121350_parent_consent_and_meeting_simplification.sql`:

- Parent emails must belong to registered, verified parent accounts. Parents explicitly approve or decline student link requests. Existing email-matched links become pending requests; attendance, photos, and existing course enrollment are retained.
- New enrollment and reactivation require an approved parent link, enforced by both the guarded enrollment function and a database trigger. Pending parents cannot read attendance, photos, locations, or class calendars.
- Students, approved teachers, and administrators can invite parents through the protected `invite-parent` Edge Function. Invitations have hourly limits, duplicate suppression, retry recovery, and trusted parent-only onboarding. An invitation never approves a student link.
- Meetings use course name and date/time; the meeting-title database column is removed. Student self-check begins exactly at class start, with an optional closing offset. Teacher attendance bypasses this time window; teacher-marked Present is labeled on-campus without inventing GPS coordinates.
- Profile contains name and picture settings. Security contains separate linked-account, email, and password dialogs. Manual Google/Facebook linking preserves the current account and role; the last sign-in method cannot be removed.
- Avatars remain stable during background refresh, falling back to the linked Google/Facebook photo when no uploaded picture exists. Attendance shows private photo thumbnails, and parents use the same class calendar as their child. Personal tasks remain student-only.
- Softer dark surfaces, three teacher-approval filters with search, separate face-enrollment filters, and short-lived section-specific feedback improve readability and navigation.

Deploy the migration before relying on parent consent, then deploy `invite-parent` with JWT verification enabled. Publish the eight branded Auth templates and enable manual identity linking with the narrow profile described in [the email-template guide](supabase/templates/README.md). Do not publish the main local-development Auth configuration to the hosted project. No live invitation, password change, or account-link action is part of the automated test suite.

Production verification on October 25 confirmed this migration was applied, `invite-parent` was active with JWT verification, and the eight Auth HTML bodies/settings matched the published files. The existing attendance, meetings, enrollment, and stored evidence counts were unchanged; the old email-only parent connection became a pending consent request. Vercel reported a successful release and the site returned HTTP 200; an anonymous invitation request returned HTTP 401. All 254 automated tests, the web build, and the JDK 21 Android debug build passed. Camera/GPS/face matching/notification delivery still need physical-device testing, and actual email delivery remains subject to the SMTP provider and Spam filtering.

## Local setup

Requirements: Node.js 22 or newer, pnpm, and Android Studio with JDK 21 for Android builds.

```bash
pnpm install
copy .env.example .env.local
pnpm dev
```

Set these values in `.env.local`:

```dotenv
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
```

Use only a Supabase publishable key in the app. Never expose a service-role key in a `VITE_` variable.

## Supabase setup

Database migrations are in [`supabase/migrations`](supabase/migrations). They define the data model, RPCs, RLS policies, private Storage buckets, account workflows, weekly meeting generation, face templates, task management, and notification queue.

To initialize another Supabase project:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref your-project-ref
pnpm exec supabase db push
```

The connected project has `dispatch-class-reminders` and the three rebuild migrations listed above deployed. Newer local migrations must be applied and verified separately before deploying frontend features that depend on them.

### Create the first administrator

The administrator role cannot be selected during registration. Promote only a trusted school account in the Supabase SQL Editor:

```sql
update public.profiles
set role = 'admin',
    teacher_approval_status = null,
    teacher_approval_note = null,
    teacher_approved_by = null,
    teacher_approved_at = null
where email = lower('admin@school.edu');
```

Sign out and back in after the update. The administrator dashboard will then show pending teacher registrations.

### Configure social sign-in

1. Create Google and Facebook OAuth applications.
2. Add their client IDs and secrets under Supabase Authentication providers.
3. Allow the deployed web callback URL ending in `/auth/callback`.
4. Keep `edu.minsu.attendance://auth/callback` available for the Android app flow.

### Configure Android push delivery

1. Register the Android application ID in Firebase.
2. Place the downloaded file at `android/app/google-services.json`; this path is intentionally git-ignored.
3. Set the Edge Function secrets `FIREBASE_SERVICE_ACCOUNT_JSON` and `REMINDER_DISPATCH_SECRET`.
4. Add the matching dispatch secret to Supabase Vault and schedule the protected Edge Function once per minute.

See the Edge Function README linked above for the exact SQL and commands. The current sender supports Android FCM; APNs configuration is still required for native iOS delivery.

### Configure password-reset and account email delivery

Password-reset, confirmation, and email-change messages are sent by Supabase Auth, not by Vercel or the browser. The bundled email service is restricted and is not a production email provider.

1. Configure a custom SMTP provider under Supabase Authentication email settings, including its approved sender address and any required domain verification.
2. Set the deployed site URL and allow its `/auth/callback` redirect. Keep the Android callback in the allow-list as described above.
3. Review the Authentication rate-limit settings against the SMTP provider's account quota and sending policy.
4. Send a reset request to an existing account, inspect Supabase Auth logs and the provider's delivery logs, and complete the password change through the received link.

Custom SMTP credentials and sender/domain verification are external setup requirements and have **not** been configured by this code update. A successful reset-request response does not prove that an email was delivered. The UI reports request errors and has a short resend cooldown; it cannot remove Supabase's server-side abuse controls or an email provider's quotas. No unlimited-email claim is made.

Read-only checks on October 24 confirmed that the connected School Attendance Project already has Gmail SMTP enabled (`smtp.gmail.com`, port `587`) and a Supabase email quota of `1000` per hour. Those settings were not changed. Reset requests returned HTTP 200 without SMTP errors; mailbox delivery and provider-side quotas still require recipient-specific verification. Do not diagnose this project as using the default two-emails-per-hour service.

A recipient-approved production test later confirmed reset-email delivery: Supabase recorded the send, and the recipient found the message in Gmail Spam. Mark the message as **Not spam** and use the latest recovery link in the requesting browser. A different address that has not registered cannot receive a password reset; the public response intentionally does not reveal account existence.

## Verification

```bash
pnpm exec vue-tsc --noEmit
pnpm test
pnpm build
pnpm cap:sync
```

For Android:

```bash
pnpm exec cap open android
```

Use JDK 21 for the included Gradle toolchain. Browser camera and location features require HTTPS or localhost plus user permission.

## Vercel

- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm build`
- Output directory: `dist`

Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as Vercel environment variables, and add the Vercel `/auth/callback` URL to the Supabase redirect allow-list.

## Production checklist

- Enable leaked-password protection in Supabase Authentication settings.
- Configure Google and Facebook provider credentials and redirect URLs.
- Verify the existing SMTP sender and test password-reset, confirmation, and email-change delivery end-to-end.
- Configure Firebase, Edge Function secrets, Vault, and the one-minute dispatcher schedule.
- Define school-approved consent and retention rules for minors' photos, facial templates, and location evidence.
- Build Android with JDK 21 and test permissions, barcode scanning, geofencing, deep links, and notifications on physical devices.
