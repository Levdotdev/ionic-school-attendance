# Ionic School Attendance MVP

An Ionic Vue attendance app backed by Supabase Auth, PostgreSQL, Row Level Security, and private Storage.

## MVP features

- Student and parent email/password registration; school-provisioned teacher accounts.
- Student registration with either the device camera or an armed, hidden USB/dongle barcode input.
- Raw barcode values are never stored in the browser or public tables; PostgreSQL stores a one-way hash in a private schema.
- Teacher-created classes, join codes, weekly schedules, and individual meetings.
- Four attendance modes:
  - teacher manually marks present or absent;
  - on-site student self-check with ID barcode, a newly captured selfie, and location;
  - event self-check with the same physical evidence;
  - online self-check with a newly captured selfie only.
- Server-side checks for class enrollment, check-in window, matching ID barcode, GPS accuracy, and allowed radius.
- Private selfie storage with short-lived teacher-only viewing links.
- Teacher approval/rejection of self-check evidence and the ability to disable attendance for one meeting.
- Parent view for linked students' attendance and submitted location. Parents cannot open selfies.

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

The schema is in [`supabase/migrations/20261004043138_attendance_mvp.sql`](supabase/migrations/20261004043138_attendance_mvp.sql). It creates the tables, RPCs, RLS policies, private selfie bucket, and the Auth profile trigger.

For another Supabase project:

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref your-project-ref
pnpm exec supabase db push
```

The connected `School Attendance Project` already has this migration applied.

### Create the first teacher

Teacher signup is deliberately unavailable in the client so a student cannot grant themselves teacher access.

1. In Supabase Dashboard, open **Authentication → Users** and add the teacher user.
2. In the SQL Editor, promote only that verified school account:

```sql
update public.profiles
set role = 'teacher'
where email = lower('teacher@school.edu');
```

The teacher can then sign in, create a class, and share its join code. Students must finish barcode registration before joining.

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

The official Capacitor barcode scanner requires Android API 26 or newer; this project sets `minSdkVersion` to 26.

## Barcode-reader behavior

The USB/dongle field is visually hidden and only listens after the user presses **Use barcode reader**. Rapid keyboard-wedge scans and readers that paste the complete value are supported. Slow typing and dropped text are rejected.

Web software cannot reliably distinguish a hardware reader's paste event from a person pressing paste. The armed capture window and validation reduce accidental entry, while the camera scanner provides stronger assurance that the physical ID was present.

## MVP boundaries

This version intentionally leaves out polished visual design, push/email alerts, Google Calendar cloud sync, automatic generation of every meeting from a recurring schedule, and production retention automation for selfies/location. Before a real deployment, define consent and retention rules for minors' photos and location data, then add automatic deletion and school-approved notification providers.
