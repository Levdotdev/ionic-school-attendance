# Ionic School Attendance MVP

An Ionic Vue attendance app backed by Supabase Auth, PostgreSQL, Row Level Security, and private Storage.

## MVP features

- Student, parent, and teacher email/password registration. New teachers remain pending until an administrator approves them.
- Student registration with either a wide camera scanner for long 1D barcodes or an armed, hidden USB/dongle barcode input.
- Raw barcode values are never stored in the browser or public tables; PostgreSQL stores a one-way hash in a private schema.
- Teacher-created classes, join codes, weekly schedules, and individual meetings. Classes, schedules, and meetings can be edited or deleted.
- Each active weekly schedule automatically creates one persisted meeting for the current Manila week. Teachers can edit, disable, or delete a single occurrence without changing the recurring schedule.
- Four attendance modes:
  - teacher manually marks present or absent;
  - on-site student self-check with ID barcode, a newly captured selfie, and location;
  - event self-check with the same physical evidence;
  - online self-check with a newly captured selfie only.
- Server-side checks for class enrollment, check-in window, matching ID barcode, GPS accuracy, and allowed radius.
- Private selfie storage with short-lived viewing links for the approved class teacher and the student's verified linked parent.
- Teacher approval/rejection of self-check evidence and the ability to disable attendance for one meeting.
- Parent view for linked students' attendance, submitted location, and check-in photos.
- The school geofence is fixed by the database at `13.387419, 121.162494` with a `180` meter radius, so teachers do not enter coordinates.

## Local setup

Requirements: Node.js 22 or newer, pnpm, and Android Studio/JDK 21 for Android builds.

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

Use only a Supabase publishable key in the app. Never add a service-role key to a `VITE_` variable.

## Database

The database migrations are in [`supabase/migrations`](supabase/migrations). They create the tables, RPCs, RLS policies, private selfie bucket, Auth profile trigger, teacher approval workflow, and parent photo access.

For another Supabase project:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref your-project-ref
pnpm exec supabase db push
```

The connected `School Attendance Project` already has these migrations applied. Supabase Cron creates the new week's scheduled meetings shortly after midnight every Monday in Manila; opening the teacher dashboard also performs an idempotent recovery check.

### Create the first administrator

The administrator role cannot be selected during signup. This prevents users from granting themselves approval access.

1. Register the intended administrator through the app and confirm the email address.
2. In the Supabase SQL Editor, promote only that trusted school account:

```sql
update public.profiles
set role = 'admin',
    teacher_approval_status = null,
    teacher_approval_note = null,
    teacher_approved_by = null,
    teacher_approved_at = null
where email = lower('admin@school.edu');
```

3. Sign out and sign back in. The administrator dashboard will list teacher registrations and allow approval or rejection with an optional note.

Teachers choose **Teacher** when registering. They can sign in while pending, but cannot create classes or access teacher data until approved. Students must finish barcode registration before joining a class.

Parent linking is automatic when a student enters the same confirmed email address used by a parent account.

## Verification commands

```bash
pnpm test
pnpm build
pnpm cap:sync
```

For Android:

```bash
pnpm exec cap open android
```

The official Capacitor barcode scanner requires Android API 26 or newer; this project sets `minSdkVersion` to 26. Browser camera scanning requires HTTPS (or localhost) and camera permission.

## Barcode-reader behavior

The camera scanner is configured for long linear barcodes, including Code 128, Code 39, Code 93, Codabar, ITF, EAN, and UPC. It uses a wide rectangular guide instead of a QR-style square.

The USB/dongle field is visually hidden and only listens after the user presses **Use barcode reader**. Rapid keyboard-wedge scans, readers that paste the complete value, and Enter or Tab suffixes are supported. Slow typing and dropped text are rejected.

Web software cannot reliably distinguish a hardware reader's paste event from a person pressing paste. The armed capture window and validation reduce accidental entry, while the camera scanner provides stronger assurance that the physical ID was present.

## MVP boundaries

This version intentionally leaves out push/email alerts, Google Calendar cloud sync, and production retention automation for selfies/location. Before a real deployment, define consent and retention rules for minors' photos and location data, then add automatic deletion and school-approved notification providers.
