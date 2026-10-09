# MinSU School Attendance

An Ionic Vue school attendance system backed by Supabase Auth, PostgreSQL, Row Level Security, Edge Functions, and private Storage.

## Implemented features

### Accounts and access

- Student, parent, and teacher registration with email and password.
- Google and Facebook sign-in support through Supabase OAuth.
- New teacher accounts remain pending until an administrator approves them.
- Role-based side menus for administrators, teachers, students, and parents.
- MinSU green-and-gold light and dark themes.
- Responsive sign-in and registration layout with a fixed information panel on wide screens.

Social sign-in creates a student account by default. Teachers and parents should use the role-aware email registration form so the teacher-approval and parent-linking workflows are applied.

### Attendance

- Camera-only scanning for long 1D student ID barcodes: Code 128, Code 39, Code 93, Codabar, ITF, EAN, and UPC.
- Raw barcode values are not stored in browser storage or public tables. PostgreSQL stores a one-way hash in a private schema.
- Manual teacher attendance with present and absent controls.
- On-site self-check requires the physical ID barcode, a newly captured selfie, the school geofence, and face verification when a template is enrolled.
- Online self-check requires a newly captured selfie and face verification when a template is enrolled.
- Event self-check is disabled; event attendance is handled manually by the teacher.
- Self-check submissions are accepted immediately. The teacher can inspect the evidence photo, void an invalid submission, or restore it.
- The captured photo contains a visible Manila timestamp and submitted coordinates/accuracy.
- Evidence photos are stored privately and are available only to the student, approved class teacher, and verified linked parent as authorized by database policies.
- The school geofence is fixed at `13.387419, 121.162494` with a `180` meter radius.

### Face verification

- Students can enroll, replace, or remove a private facial template.
- Enrollment uses three live camera samples and stores the derived template, not the enrollment photos.
- Self-check performs on-device face analysis and submits an actor-bound verification request to Supabase.
- A manual evidence-review fallback remains available when a student cannot enroll or the device cannot complete face analysis.

Face matching is an attendance aid, not a guarantee of identity. Teachers should still review questionable evidence and the school should define consent, retention, and access rules before production use with minors.

### Classes and schedules

- Teachers can create, edit, and delete classes, weekly schedules, and individual meetings through modals.
- A weekly schedule automatically produces the current week's meeting.
- Only the current Monday-to-Sunday schedule is shown to users.
- Teachers can disable, restore, edit, or remove one meeting without changing the repeating schedule.
- The database uses the Asia/Manila timezone when creating weekly occurrences and reminders.

### Notifications

- Teacher reminders: 5 minutes before class and at the start time.
- Student reminders: 2 hours, 1 hour, 30 minutes, 15 minutes, 5 minutes, and at the start time.
- Reminder preferences are created with each weekly schedule, so teachers do not enter them repeatedly.
- Native Android push tokens are registered after sign-in, notification taps open the schedule, and sign-out removes the account/device mapping.
- A protected Supabase Edge Function claims queued deliveries and sends Android notifications through Firebase Cloud Messaging.

The notification code, schema, queue, and Edge Function are deployed, but actual delivery requires the Firebase credentials and scheduled invocation described in [`supabase/functions/dispatch-class-reminders/README.md`](supabase/functions/dispatch-class-reminders/README.md).

### Student tasks

- Course-linked tasks that use enrolled classes as subjects.
- Optional custom categories in addition to subjects.
- Create, edit, delete, complete, and reopen tasks.
- Priority, due date/time, recurrence, notes, links, search, filtering, and sorting.
- Private task attachments with database and Storage access policies.
- Task summary and occurrence tracking.

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

The currently connected School Attendance Project already has all checked-in migrations and the `dispatch-class-reminders` Edge Function deployed.

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
- Configure Firebase, Edge Function secrets, Vault, and the one-minute dispatcher schedule.
- Define school-approved consent and retention rules for minors' photos, facial templates, and location evidence.
- Build Android with JDK 21 and test permissions, barcode scanning, geofencing, deep links, and notifications on physical devices.
