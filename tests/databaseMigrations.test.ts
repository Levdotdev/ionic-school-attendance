// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const migrationDirectory = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
let database: PGlite
let originalClaimSql = ''
let claimFixSql = ''

// Supabase-owned tables/functions and Cron transport are the only scaffolds.
// Application schemas, triggers, policies, grants, and RPCs below are the
// actual checked-in migrations, executed by PostgreSQL in memory.
const platformScaffold = `
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create role supabase_admin;
  create schema auth;
  create table auth.users (
    id uuid primary key, aud text, role text, email text,
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb default '{}'::jsonb,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now(), updated_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null
  );
  alter table storage.objects enable row level security;
  create function storage.foldername(text) returns text[] language sql immutable as $$
    select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1]
  $$;
  create function storage.extension(text) returns text language sql immutable as $$
    select substring($1 from '\\.([^./]+)$')
  $$;
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to service_role;
  grant select, insert, update, delete on storage.objects to authenticated;
  create schema cron;
  create table cron.job (jobid bigint generated always as identity primary key, jobname text unique, schedule text, command text);
  create function cron.schedule(text, text, text) returns bigint language sql as $$
    insert into cron.job(jobname, schedule, command) values ($1, $2, $3) returning jobid
  $$;
  create function cron.unschedule(bigint) returns boolean language sql as $$
    delete from cron.job where jobid = $1 returning true
  $$;
`

beforeAll(async () => {
  database = new PGlite({ extensions: { pgcrypto } })
  await database.exec(platformScaffold)
  const migrations = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of migrations) {
    const sql = await readFile(`${migrationDirectory}/${file}`, 'utf8')
    if (file.endsWith('class_notification_infrastructure.sql')) {
      const start = sql.indexOf('create function private.claim_due_class_notification_deliveries_impl(')
      const end = sql.indexOf('create function public.claim_due_class_notification_deliveries(', start)
      originalClaimSql = sql.slice(start, end).replace('create function', 'create or replace function')
    }
    if (file.endsWith('fix_reminder_delivery_claim_conflict.sql')) claimFixSql = sql
    try {
      await database.exec(sql.replace(/^create extension if not exists pg_cron with schema pg_catalog;\r?$/gim, ''))
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}, 60000)

beforeEach(async () => { await database.exec('begin;') })
afterEach(async () => { await database.exec('rollback;') })
afterAll(async () => { await database?.close() })

const teacherId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268801'
const studentId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268802'
const pendingTeacherId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268803'
const classId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268811'
const scheduleId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268821'
const workerId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268831'

async function seedClass(mode = 'self_on_site', minutesBefore = 25) {
  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${teacherId}', 'database-teacher@example.invalid', now()),
      ('${studentId}', 'database-student@example.invalid', now()),
      ('${pendingTeacherId}', 'database-pending@example.invalid', now());
    update public.profiles set role = 'teacher', teacher_approval_status = 'approved', teacher_approved_at = now(), onboarding_completed_at = now() where id = '${teacherId}';
    update public.profiles set role = 'teacher', teacher_approval_status = 'pending', onboarding_completed_at = now() where id = '${pendingTeacherId}';
    insert into public.classes (id, teacher_id, name, section, join_code, default_max_accuracy_m)
      values ('${classId}', '${teacherId}', 'Database integration', '4-F1', 'DBTEST01', 75);
    insert into public.class_enrollments (class_id, student_id) values ('${classId}', '${studentId}');
    insert into public.class_schedules (id, class_id, day_of_week, starts_at, ends_at, attendance_mode, check_in_minutes_before)
      values ('${scheduleId}', '${classId}', 1, '10:00', '11:00', '${mode}', ${minutesBefore});
  `)
}

async function become(userId: string, role = 'authenticated') {
  await database.exec(`set local role ${role}; select set_config('request.jwt.claims', '${JSON.stringify({ sub: userId, role })}', true);`)
}

async function seedDueReminders() {
  await seedClass('teacher_manual')
  await database.exec(`
    update public.class_schedules set teacher_reminder_minutes = array[0]::smallint[], student_reminder_minutes = array[0]::smallint[] where id = '${scheduleId}';
    update public.meetings set starts_at = now() - interval '30 seconds', ends_at = now() + interval '1 hour',
      meeting_date = timezone('Asia/Manila', now())::date,
      attendance_opens_at = now() - interval '15 minutes', attendance_closes_at = now() + interval '1 hour'
      where schedule_id = '${scheduleId}';
    insert into public.device_push_tokens (user_id, installation_id, provider, platform, token) values
      ('${teacherId}', 'a36236ea-e56a-4bd4-ad0d-9b5b40268841', 'fcm', 'android', 'teacher-device-token-integration'),
      ('${studentId}', 'a36236ea-e56a-4bd4-ad0d-9b5b40268842', 'fcm', 'android', 'student-device-token-integration');
  `)
}

describe('actual database migrations', () => {
  it('enforces account setup, provider neutrality, immutable roles, and pending teacher approval', async () => {
    const sql = await readFile(new URL('../supabase/tests/account_setup.sql', import.meta.url), 'utf8')
    await database.exec(sql)
    const result = await database.query<{ count: number }>("select count(*)::integer as count from auth.users where email like 'setup-%@example.invalid'")
    expect(result.rows[0].count).toBe(0)
  })

  it.each(['teacher_manual', 'self_on_site', 'self_online'])('inherits %s and the check-in window from the weekly schedule', async (mode) => {
    await seedClass(mode, 25)
    const result = await database.query<{ attendance_mode: string; opens_minutes: number; latitude: number | null; longitude: number | null; radius_m: number; max_accuracy_m: number }>(`
      select attendance_mode, extract(epoch from (starts_at - attendance_opens_at))::integer / 60 as opens_minutes,
        latitude, longitude, radius_m, max_accuracy_m from public.meetings where schedule_id = '${scheduleId}'
    `)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({ attendance_mode: mode, opens_minutes: 25, radius_m: 180, max_accuracy_m: 75 })
    expect(result.rows[0].latitude).toBe(mode === 'self_online' ? null : 13.387419)
    expect(result.rows[0].longitude).toBe(mode === 'self_online' ? null : 121.162494)
  })

  it('preserves a cancelled or individually edited meeting across schedule regeneration', async () => {
    await seedClass()
    await database.exec(`update public.meetings set attendance_enabled = false, title = 'No class this week', attendance_mode = 'self_online' where schedule_id = '${scheduleId}';
      update public.class_schedules set attendance_mode = 'teacher_manual', check_in_minutes_before = 10 where id = '${scheduleId}';
      select private.generate_current_week_meetings('${classId}');`)
    const result = await database.query(`select title, attendance_enabled, attendance_mode, extract(epoch from (starts_at - attendance_opens_at))::integer / 60 as opens_minutes from public.meetings where schedule_id = '${scheduleId}'`)
    expect(result.rows).toEqual([{ title: 'No class this week', attendance_enabled: false, attendance_mode: 'self_online', opens_minutes: 25 }])
  })

  it('keeps a deliberately deleted occurrence deleted', async () => {
    await seedClass()
    await database.exec(`delete from public.meetings where schedule_id = '${scheduleId}'; select private.generate_current_week_meetings('${classId}');`)
    const result = await database.query<{ count: number }>(`select count(*)::integer as count from public.meetings where schedule_id = '${scheduleId}'`)
    expect(result.rows[0].count).toBe(0)
    const tombstone = await database.query<{ count: number }>(`select count(*)::integer as count from private.schedule_meeting_exceptions where schedule_id = '${scheduleId}'`)
    expect(tombstone.rows[0].count).toBe(1)
  })

  it('preserves meeting history when its weekly schedule is deleted', async () => {
    await seedClass()
    await database.exec(`delete from public.class_schedules where id = '${scheduleId}';`)
    const result = await database.query(`select schedule_id, attendance_mode from public.meetings where class_id = '${classId}'`)
    expect(result.rows).toEqual([{ schedule_id: null, attendance_mode: 'self_on_site' }])
  })

  it('applies schedule attendance defaults to meetings created ahead of the Monday boundary', async () => {
    await seedClass('self_online', 45)
    const nextWeek = await database.query<{ week: string }>("select (date_trunc('week', timezone('Asia/Manila', now())) + interval '7 days')::date::text as week")
    const week = nextWeek.rows[0].week
    await database.exec(`select private.generate_imminent_schedule_meetings(('${week}'::date + time '09:00') at time zone 'Asia/Manila');`)
    const result = await database.query(`select attendance_mode, latitude, longitude, max_accuracy_m, extract(epoch from (starts_at - attendance_opens_at))::integer / 60 as opens_minutes
      from public.meetings where schedule_id = '${scheduleId}' and schedule_week_start = '${week}'`)
    expect(result.rows).toEqual([{ attendance_mode: 'self_online', latitude: null, longitude: null, max_accuracy_m: 75, opens_minutes: 45 }])
  })

  it('blocks unapproved teachers from generating meetings or editing another class', async () => {
    await seedClass()
    await become(pendingTeacherId)
    const edited = await database.query(`update public.class_schedules set room = 'Unauthorized' where id = '${scheduleId}' returning id`)
    expect(edited.rows).toEqual([])
    await database.exec('savepoint pending_teacher;')
    await expect(database.query(`select * from public.ensure_current_week_meetings('${classId}')`)).rejects.toThrow('Only an approved teacher')
    await database.exec('rollback to savepoint pending_teacher;')
  })

  it('reproduces the old reminder-claim ambiguity and verifies the actual repair', async () => {
    await seedDueReminders()
    await database.exec(originalClaimSql)
    await database.exec('savepoint old_claim; set local role service_role;')
    await expect(database.query(`select * from public.claim_due_class_notification_deliveries('${workerId}', 50)`)).rejects.toThrow('push_token_id')
    await database.exec('rollback to savepoint old_claim;')
    await database.exec(claimFixSql)
    await database.exec('set local role service_role;')
    const claimed = await database.query<{ audience: string }>(`select * from public.claim_due_class_notification_deliveries('${workerId}', 50)`)
    expect(claimed.rows).toHaveLength(2)
    expect(claimed.rows.map((row) => row.audience).sort()).toEqual(['student', 'teacher'])
    const repeated = await database.query(`select * from public.claim_due_class_notification_deliveries('${workerId}', 50)`)
    expect(repeated.rows).toHaveLength(0)
  })

  it('cancels unsent reminders when a teacher disables attendance for one meeting', async () => {
    await seedDueReminders()
    const claimed = await database.query(`select * from public.claim_due_class_notification_deliveries('${workerId}', 50)`)
    expect(claimed.rows).toHaveLength(2)
    await database.exec(`update public.meetings set attendance_enabled = false where schedule_id = '${scheduleId}'; select private.enqueue_class_notifications();`)
    const cancelled = await database.query('select status from private.class_notification_deliveries')
    expect(cancelled.rows).toEqual([{ status: 'cancelled' }, { status: 'cancelled' }])
    const retry = await database.query(`select * from public.claim_due_class_notification_deliveries('${workerId}', 50)`)
    expect(retry.rows).toHaveLength(0)
  })

  it('keeps reminder claim/dispatch RPCs inaccessible to students and anonymous callers', async () => {
    const permissions = await database.query(`select
      has_function_privilege('anon', 'public.claim_due_class_notification_deliveries(uuid,integer)', 'execute') as anon,
      has_function_privilege('authenticated', 'public.claim_due_class_notification_deliveries(uuid,integer)', 'execute') as authenticated,
      has_function_privilege('service_role', 'public.claim_due_class_notification_deliveries(uuid,integer)', 'execute') as dispatcher`)
    expect(permissions.rows).toEqual([{ anon: false, authenticated: false, dispatcher: true }])
  })
})
