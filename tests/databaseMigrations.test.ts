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
const beforeParentConsentMigrations: string[] = []
let parentConsentMigration = ''

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
    if (file.endsWith('parent_consent_and_meeting_simplification.sql')) parentConsentMigration = sql
    else if (!parentConsentMigration) beforeParentConsentMigrations.push(sql)
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
const parentId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268851'
const unrelatedId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268852'
const adminId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268853'

async function seedClass(mode = 'self_on_site', _minutesBefore = 0) {
  await database.exec(`
    insert into auth.users (id, email, email_confirmed_at) values
      ('${teacherId}', 'database-teacher@example.invalid', now()),
      ('${studentId}', 'database-student@example.invalid', now()),
      ('${pendingTeacherId}', 'database-pending@example.invalid', now()),
      ('${parentId}', 'verified-parent@example.invalid', now());
    update public.profiles set role = 'teacher', teacher_approval_status = 'approved', teacher_approved_at = now(), onboarding_completed_at = now() where id = '${teacherId}';
    update public.profiles set role = 'teacher', teacher_approval_status = 'pending', onboarding_completed_at = now() where id = '${pendingTeacherId}';
    update public.profiles set role='student',onboarding_completed_at=now() where id='${studentId}';
    update public.profiles set role='parent',onboarding_completed_at=now() where id='${parentId}';
    insert into public.student_profiles(user_id,guardian_email,registration_completed_at)
      values('${studentId}','verified-parent@example.invalid',now());
    insert into public.guardian_link_requests(student_id,parent_id,parent_email,status,responded_at)
      values('${studentId}','${parentId}','verified-parent@example.invalid','approved',now());
    insert into public.guardian_links(parent_id,student_id,verified_guardian_email)
      values('${parentId}','${studentId}','verified-parent@example.invalid');
    insert into public.classes (id, teacher_id, name, section, join_code, default_max_accuracy_m)
      values ('${classId}', '${teacherId}', 'Database integration', '4-F1', 'DBTEST01', 75);
    insert into public.class_enrollments (class_id, student_id) values ('${classId}', '${studentId}');
    insert into public.class_schedules (id, class_id, day_of_week, starts_at, ends_at, attendance_mode, check_in_minutes_before)
      values ('${scheduleId}', '${classId}', 1, '10:00', '11:00', '${mode}', 0);
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

async function seedOnlineEvidence() {
  await seedClass('self_online')
  await database.exec(`
    insert into auth.users(id,email,email_confirmed_at) values
      ('${unrelatedId}','unrelated-parent@example.invalid',now()),
      ('${adminId}','database-admin@example.invalid',now());
    update public.profiles set role='parent',onboarding_completed_at=now() where id in ('${parentId}','${unrelatedId}');
    update public.profiles set role='admin',onboarding_completed_at=now() where id='${adminId}';
    update public.meetings set attendance_opens_at=now()-interval '1 hour',attendance_closes_at=now()+interval '1 hour'
      where schedule_id='${scheduleId}';
    insert into private.face_verification_sessions(student_id,meeting_id,model_version,similarity,liveness_score,antispoof_score,matched)
      select '${studentId}',id,'test-model',0.99,0.99,0.99,true from public.meetings where schedule_id='${scheduleId}';
    insert into storage.objects(bucket_id,name) select 'attendance-selfies','${studentId}/'||id||'/selfie.jpg'
      from public.meetings where schedule_id='${scheduleId}';
  `)
  const meeting = await database.query<{ id: string }>(`select id from public.meetings where schedule_id='${scheduleId}'`)
  return meeting.rows[0].id
}

describe('actual database migrations', () => {
  it('migrates legacy email-only links to pending consent without deleting attendance or enrollments', async () => {
    const legacy = new PGlite({ extensions: { pgcrypto } })
    try {
      await legacy.exec(platformScaffold)
      for (const sql of beforeParentConsentMigrations) {
        await legacy.exec(sql.replace(/^create extension if not exists pg_cron with schema pg_catalog;\r?$/gim, ''))
      }
      await legacy.exec(`insert into auth.users(id,email,email_confirmed_at) values
        ('${teacherId}','legacy-teacher@example.invalid',now()),('${studentId}','legacy-student@example.invalid',now()),
        ('${parentId}','legacy-parent@example.invalid',now());
        update public.profiles set role='teacher',teacher_approval_status='approved',teacher_approved_at=now(),onboarding_completed_at=now() where id='${teacherId}';
        update public.profiles set role='parent',onboarding_completed_at=now() where id='${parentId}';
        insert into public.student_profiles(user_id,guardian_email,registration_completed_at) values('${studentId}','legacy-parent@example.invalid',now());
        select private.link_guardians_for_student('${studentId}','legacy-parent@example.invalid');
        insert into public.classes(id,teacher_id,name,join_code) values('${classId}','${teacherId}','Legacy course','LEGACY01');
        insert into public.class_enrollments(class_id,student_id) values('${classId}','${studentId}');
        insert into public.class_schedules(id,class_id,day_of_week,starts_at,ends_at,check_in_minutes_before)
          values('${scheduleId}','${classId}',1,'10:00','11:00',25);
        insert into public.attendance_records(meeting_id,student_id,status,source,recorded_by)
          select id,'${studentId}','present','teacher','${teacherId}' from public.meetings where schedule_id='${scheduleId}';`)
      expect((await legacy.query('select count(*)::integer as count from public.guardian_links')).rows).toEqual([{ count: 1 }])
      await legacy.exec(parentConsentMigration)
      expect((await legacy.query('select count(*)::integer as count from public.guardian_links')).rows).toEqual([{ count: 0 }])
      expect((await legacy.query('select status from public.guardian_link_requests')).rows).toEqual([{ status: 'pending' }])
      expect((await legacy.query('select status,source from public.attendance_records')).rows).toEqual([{ status: 'present', source: 'teacher' }])
      expect((await legacy.query('select is_active from public.class_enrollments')).rows).toEqual([{ is_active: true }])
      expect((await legacy.query('select check_in_minutes_before from public.class_schedules')).rows).toEqual([{ check_in_minutes_before: 0 }])
      expect((await legacy.query(`select column_name from information_schema.columns where table_schema='public' and table_name='meetings' and column_name='title'`)).rows).toHaveLength(0)
      expect((await legacy.query(`select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname in('public','private') and(position('m.title' in p.prosrc)>0 or position('meeting_title' in p.prosrc)>0)`)).rows).toHaveLength(0)
    } finally { await legacy.close() }
  }, 60000)

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
    expect(result.rows[0]).toMatchObject({ attendance_mode: mode, opens_minutes: 0, radius_m: 180, max_accuracy_m: 75 })
    expect(result.rows[0].latitude).toBe(mode === 'self_online' ? null : 13.387419)
    expect(result.rows[0].longitude).toBe(mode === 'self_online' ? null : 121.162494)
  })

  it('preserves a cancelled or individually edited meeting across schedule regeneration', async () => {
    await seedClass()
    await database.exec(`update public.meetings set attendance_enabled = false, attendance_mode = 'self_online' where schedule_id = '${scheduleId}';
      update public.class_schedules set attendance_mode = 'teacher_manual' where id = '${scheduleId}';
      select private.generate_current_week_meetings('${classId}');`)
    const result = await database.query(`select attendance_enabled, attendance_mode, extract(epoch from (starts_at - attendance_opens_at))::integer / 60 as opens_minutes from public.meetings where schedule_id = '${scheduleId}'`)
    expect(result.rows).toEqual([{ attendance_enabled: false, attendance_mode: 'self_online', opens_minutes: 0 }])
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
    expect(result.rows).toEqual([{ attendance_mode: 'self_online', latitude: null, longitude: null, max_accuracy_m: 75, opens_minutes: 0 }])
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

  it('stores online location privately, requires GPS and exposes it only to a currently verified linked parent', async () => {
    const meetingId = await seedOnlineEvidence()
    const selfie = `${studentId}/${meetingId}/selfie.jpg`
    await become(studentId)
    await database.exec('savepoint missing_online_location;')
    await expect(database.query(`select * from public.submit_self_attendance('${meetingId}','${selfie}',null,null,null,null)`))
      .rejects.toThrow('Allow location access')
    await database.exec('rollback to savepoint missing_online_location;')
    const submitted = await database.query(`select latitude,longitude,accuracy_m,distance_m,status from public.submit_self_attendance(
      '${meetingId}','${selfie}',null,14.5995,120.9842,250)`)
    expect(submitted.rows).toEqual([{ latitude: null, longitude: null, accuracy_m: null, distance_m: null, status: 'present' }])
    const visible = await database.query('select * from public.student_available_meetings')
    expect(visible.rows).toHaveLength(0)
    for (const actor of [studentId, teacherId, adminId, unrelatedId]) {
      await become(actor)
      await database.exec('savepoint privacy_denied;')
      await expect(database.query(`select * from public.parent_online_attendance_locations('${studentId}')`))
        .rejects.toThrow('Only a verified linked parent')
      await database.exec('rollback to savepoint privacy_denied;')
    }
    await become(parentId)
    const location = await database.query(`select latitude,longitude,accuracy_m from public.parent_online_attendance_locations('${studentId}')`)
    expect(location.rows).toEqual([{ latitude: 14.5995, longitude: 120.9842, accuracy_m: 250 }])
    await database.exec('reset role;')
    await database.exec(`update auth.users set email_confirmed_at=null where id='${parentId}';`)
    await become(parentId)
    await database.exec('savepoint unverified_parent;')
    await expect(database.query(`select * from public.parent_online_attendance_locations('${studentId}')`))
      .rejects.toThrow('Only a verified linked parent')
    await database.exec('rollback to savepoint unverified_parent;')
    const permissions = await database.query(`select has_table_privilege('authenticated','private.online_attendance_locations','select') as can_read,
      has_function_privilege('authenticated','private.submit_self_attendance_evidence_impl(uuid,text,text,double precision,double precision,double precision)','execute') as bypass`)
    expect(permissions.rows).toEqual([{ can_read: false, bypass: false }])
  })

  it('locks one-time face enrollment until an administrator grants one validated retake', async () => {
    await seedOnlineEvidence()
    await become(studentId)
    await database.exec(`select public.enroll_my_face(array_fill(0.25::double precision,array[64]),'test-model',3);`)
    expect((await database.query('select * from public.my_face_enrollment_access()')).rows[0])
      .toMatchObject({ is_enrolled: true, can_retake: false })
    await database.exec('savepoint face_locked;')
    await expect(database.query(`select public.enroll_my_face(array_fill(0.5::double precision,array[64]),'test-model',3)`))
      .rejects.toThrow('already enrolled')
    await database.exec('rollback to savepoint face_locked; savepoint face_delete;')
    await expect(database.query('select public.delete_my_face()')).rejects.toThrow('enrollment is locked')
    await database.exec('rollback to savepoint face_delete; savepoint no_self_grant;')
    await expect(database.query(`select public.admin_grant_face_retake('${studentId}','self grant')`)).rejects.toThrow('Administrator access')
    await database.exec('rollback to savepoint no_self_grant;')
    await become(adminId)
    await database.exec(`select public.admin_grant_face_retake('${studentId}','Camera changed');`)
    expect((await database.query(`select student_id,enrolled,can_retake from public.admin_student_face_enrollments() where student_id='${studentId}'`)).rows)
      .toEqual([{ student_id: studentId, enrolled: true, can_retake: true }])
    await become(studentId)
    expect((await database.query('select * from public.my_face_enrollment_access()')).rows[0]).toMatchObject({ can_retake: true })
    await database.exec('savepoint invalid_retake;')
    await expect(database.query(`select public.enroll_my_face(array[0.1::double precision],'test-model',3)`)).rejects.toThrow('template is invalid')
    await database.exec('rollback to savepoint invalid_retake;')
    expect((await database.query('select * from public.my_face_enrollment_access()')).rows[0]).toMatchObject({ can_retake: true })
    await database.exec(`select public.enroll_my_face(array_fill(0.5::double precision,array[64]),'test-model',3);`)
    expect((await database.query('select * from public.my_face_enrollment_access()')).rows[0]).toMatchObject({ can_retake: false })
  })

  it('inherits the teacher-defined closing offset and preserves existing occurrence overrides', async () => {
    await seedClass()
    await database.exec(`update public.class_schedules set check_in_minutes_after_start=20 where id='${scheduleId}';`)
    const nextWeek = await database.query<{ week: string }>("select (date_trunc('week',timezone('Asia/Manila',now()))+interval '7 days')::date::text as week")
    await database.exec(`select private.generate_schedule_week('${nextWeek.rows[0].week}', '${classId}',null);`)
    const windows = await database.query<{ minutes: number }>(`select extract(epoch from(attendance_closes_at-starts_at))::integer/60 as minutes
      from public.meetings where class_id='${classId}' order by starts_at`)
    expect(windows.rows).toEqual([{ minutes: 60 }, { minutes: 20 }])
  })

  it('archives a class without losing history and cancels reminders and future generation', async () => {
    await seedDueReminders()
    await database.exec(`insert into public.student_profiles(user_id) values('${studentId}') on conflict(user_id) do nothing;
      insert into public.attendance_records(meeting_id,student_id,status,source,recorded_by)
      select id,'${studentId}','present','teacher','${teacherId}' from public.meetings where schedule_id='${scheduleId}';
      select private.enqueue_class_notifications();`)
    await become(studentId)
    await database.exec('savepoint no_student_archive;')
    await expect(database.query(`select public.set_class_archived('${classId}')`)).rejects.toThrow('Only the class teacher')
    await database.exec('rollback to savepoint no_student_archive;')
    await become(teacherId)
    await database.exec(`select public.set_class_archived('${classId}'); reset role;`)
    const history = await database.query(`select status from public.attendance_records where student_id='${studentId}'`)
    expect(history.rows).toEqual([{ status: 'present' }])
    expect((await database.query<{ state: string }>('select state from private.class_notification_queue')).rows.every((r) => r.state === 'cancelled')).toBe(true)
    await database.exec(`select private.generate_schedule_week((date_trunc('week',timezone('Asia/Manila',now()))+interval '7 days')::date,'${classId}',null);`)
    expect((await database.query('select count(*)::integer as count from public.meetings')).rows).toEqual([{ count: 1 }])
    await become(studentId)
    await database.exec('savepoint archived_join;')
    await expect(database.query("select public.join_class('DBTEST01')")).rejects.toThrow('archived')
    await database.exec('rollback to savepoint archived_join;')
  })

  it('uses each student’s reminder choices, supports off, and rejects changing another student’s choices', async () => {
    await seedDueReminders()
    await become(studentId)
    await database.exec(`insert into public.student_schedule_notification_preferences(schedule_id,student_id,reminder_minutes)
      values('${scheduleId}','${studentId}',array[0]::smallint[]);`)
    await database.exec('reset role;')
    expect((await database.query(`select reminder_offset_minutes from private.class_notification_queue where audience='student'`)).rows)
      .toEqual([{ reminder_offset_minutes: 0 }])
    await become(teacherId)
    const changed = await database.query(`update public.student_schedule_notification_preferences set reminder_minutes='{}' where student_id='${studentId}' returning student_id`)
    expect(changed.rows).toHaveLength(0)
    await become(studentId)
    await database.exec(`update public.student_schedule_notification_preferences set reminder_minutes='{}' where student_id='${studentId}'; reset role;`)
    expect((await database.query(`select state from private.class_notification_queue where audience='student'`)).rows)
      .toEqual([{ state: 'cancelled' }])
  })

  it('allows owner avatars and recipient-only realtime counters, including deleted resources', async () => {
    await seedClass()
    await become(studentId)
    await database.exec(`insert into storage.objects(bucket_id,name) values('profile-avatars','${studentId}/avatar.jpg');
      update public.profiles set avatar_path='${studentId}/avatar.jpg' where id='${studentId}';`)
    await database.exec('savepoint no_avatar_overwrite;')
    await expect(database.query(`insert into storage.objects(bucket_id,name) values('profile-avatars','${teacherId}/avatar.jpg')`)).rejects.toThrow('row-level security')
    await database.exec('rollback to savepoint no_avatar_overwrite;')
    const counters = await database.query<{ user_id: string; revision: number }>(`select user_id,revision from public.portal_change_events`)
    expect(counters.rows).toHaveLength(1)
    expect(counters.rows[0].user_id).toBe(studentId)
    const revisionBefore = Number(counters.rows[0].revision)
    await database.exec('reset role;')
    await database.exec(`delete from public.class_schedules where id='${scheduleId}';`)
    await become(studentId)
    expect(Number((await database.query<{ revision: number }>('select revision from public.portal_change_events')).rows[0].revision)).toBeGreaterThan(revisionBefore)
    const permissions = await database.query(`select has_table_privilege('authenticated','public.portal_change_events','update') as can_update`)
    expect(permissions.rows).toEqual([{ can_update: false }])
  })

  it('shows inferred past absences and not-counted meetings to a student and verified parent, without counting before enrollment', async () => {
    await seedOnlineEvidence()
    await database.exec(`update public.class_enrollments set joined_at=now()-interval '3 days' where student_id='${studentId}';
      insert into public.attendance_records(meeting_id,student_id,status,source,recorded_by)
        select id,'${studentId}','present','teacher','${teacherId}' from public.meetings where schedule_id='${scheduleId}';
      insert into public.meetings(class_id,meeting_date,starts_at,ends_at,attendance_opens_at,attendance_closes_at,attendance_enabled,created_by)
        values('${classId}',current_date-1,now()-interval '25 hours',now()-interval '24 hours',now()-interval '26 hours',now()-interval '24 hours',true,'${teacherId}'),
          ('${classId}',current_date-2,now()-interval '49 hours',now()-interval '48 hours',now()-interval '50 hours',now()-interval '48 hours',false,'${teacherId}'),
          ('${classId}',current_date-10,now()-interval '241 hours',now()-interval '240 hours',now()-interval '242 hours',now()-interval '240 hours',true,'${teacherId}');`)
    for (const actor of [studentId, parentId]) {
      await become(actor)
      const history = await database.query<{ status: string; is_inferred: boolean; attendance_enabled: boolean }>(`
        select status,is_inferred,attendance_enabled from public.student_attendance_history('${studentId}')`)
      expect(history.rows).toHaveLength(3)
      expect(history.rows).toContainEqual({ status: 'absent', is_inferred: true, attendance_enabled: true })
      expect(history.rows).toContainEqual({ status: 'absent', is_inferred: true, attendance_enabled: false })
    }
    await become(unrelatedId)
    await database.exec('savepoint no_unlinked_history;')
    await expect(database.query(`select * from public.student_attendance_history('${studentId}')`)).rejects.toThrow('verified linked parent')
    await database.exec('rollback to savepoint no_unlinked_history; reset role;')
    await database.exec(`update public.classes set archived_at=now() where id='${classId}';`)
    await become(parentId)
    expect((await database.query(`select * from public.student_attendance_history('${studentId}')`)).rows).toHaveLength(3)
  })

  it('does not infer absence while self-check is open, after withdrawal, or for meetings after archive', async () => {
    await seedOnlineEvidence()
    await database.exec(`update public.class_enrollments set joined_at=now()-interval '30 days' where student_id='${studentId}';
      update public.meetings set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour',
        attendance_opens_at=now()-interval '3 hours',attendance_closes_at=now()+interval '1 hour'
        where schedule_id='${scheduleId}';`)
    await become(studentId)
    expect((await database.query('select * from public.student_attendance_history()')).rows).toHaveLength(0)
    await database.exec('reset role;')
    await database.exec(`update public.meetings set attendance_closes_at=now()-interval '1 minute' where schedule_id='${scheduleId}';`)
    await become(studentId)
    expect((await database.query('select * from public.student_attendance_history()')).rows).toHaveLength(1)
    await database.exec('reset role;')
    await database.exec(`update public.classes set archived_at=now()-interval '3 hours' where id='${classId}';`)
    await become(studentId)
    expect((await database.query('select * from public.student_attendance_history()')).rows).toHaveLength(0)
    await database.exec('reset role;')
    await database.exec(`update public.classes set archived_at=null where id='${classId}';
      update public.class_enrollments set is_active=false where student_id='${studentId}';`)
    await become(studentId)
    expect((await database.query('select * from public.student_attendance_history()')).rows).toHaveLength(0)
  })

  it.each(['self_online', 'self_on_site'])('allows the approved teacher to record missing %s attendance manually and blocks archived classes', async mode => {
    await seedClass(mode)
    await database.exec(`insert into public.student_profiles(user_id) values('${studentId}') on conflict(user_id) do nothing;`)
    const meeting = await database.query<{ id: string }>(`select id from public.meetings where schedule_id='${scheduleId}'`)
    const meetingId = meeting.rows[0].id
    await become(teacherId)
    expect((await database.query(`select status,source from public.record_manual_attendance('${meetingId}','${studentId}','present','Camera unavailable')`)).rows)
      .toEqual([{ status: 'present', source: 'teacher' }])
    expect((await database.query(`select status,source from public.record_manual_attendance('${meetingId}','${studentId}','absent',null)`)).rows)
      .toEqual([{ status: 'absent', source: 'teacher' }])
    await become(pendingTeacherId)
    await database.exec('savepoint no_other_teacher;')
    await expect(database.query(`select public.record_manual_attendance('${meetingId}','${studentId}','present',null)`)).rejects.toThrow('Only this class teacher')
    await database.exec('rollback to savepoint no_other_teacher;')
    await become(teacherId)
    await database.exec(`select public.set_class_archived('${classId}'); savepoint no_archived_manual;`)
    await expect(database.query(`select public.record_manual_attendance('${meetingId}','${studentId}','present',null)`)).rejects.toThrow('archived class')
    await database.exec('rollback to savepoint no_archived_manual;')
  })

  it('never replaces a submitted self-check or its protected photo with manual fallback', async () => {
    const meetingId = await seedOnlineEvidence()
    const selfie = `${studentId}/${meetingId}/selfie.jpg`
    await become(studentId)
    await database.exec(`select public.submit_self_attendance('${meetingId}','${selfie}',null,14.5995,120.9842,250);`)
    await become(teacherId)
    await database.exec('savepoint preserve_self_check;')
    await expect(database.query(`select public.record_manual_attendance('${meetingId}','${studentId}','absent','Try overwrite')`)).rejects.toThrow('cannot be replaced')
    await database.exec('rollback to savepoint preserve_self_check;')
    expect((await database.query(`select source,status,selfie_path,verification_status from public.attendance_records where meeting_id='${meetingId}'`)).rows)
      .toEqual([{ source: 'self_check', status: 'present', selfie_path: selfie, verification_status: 'approved' }])
  })

  it('requires a registered parent and explicit consent before joining, without exposing a child to a pending parent', async () => {
    await seedClass()
    await database.exec(`delete from public.guardian_links; delete from public.guardian_link_requests;
      insert into auth.users(id,email,email_confirmed_at) values('${unrelatedId}','unrelated-parent@example.invalid',now());
      update public.profiles set role='parent',onboarding_completed_at=now() where id='${unrelatedId}';`)
    await become(studentId)
    await database.exec('savepoint unregistered_parent;')
    await expect(database.query("select public.request_student_parent_link('not-registered@example.invalid')")).rejects.toThrow('not a registered')
    await database.exec('rollback to savepoint unregistered_parent; savepoint registration_parent;')
    await expect(database.query("select public.complete_student_registration('Student Name','TEST-ID-1234','not-registered@example.invalid')"))
      .rejects.toThrow('not a registered')
    await database.exec('rollback to savepoint registration_parent;')
    const request = await database.query<{ id: string; status: string }>("select id,status from public.request_student_parent_link(' VERIFIED-PARENT@example.invalid ')")
    expect(request.rows[0].status).toBe('pending')
    const requestId = request.rows[0].id
    await database.exec('savepoint joining_without_consent;')
    await expect(database.query("select public.join_class('DBTEST01')")).rejects.toThrow('parent must approve')
    await database.exec('rollback to savepoint joining_without_consent; savepoint no_direct_consent;')
    await expect(database.query(`insert into public.guardian_links(parent_id,student_id,verified_guardian_email)
      values('${parentId}','${studentId}','verified-parent@example.invalid')`)).rejects.toThrow('permission denied')
    await database.exec('rollback to savepoint no_direct_consent;')
    await become(parentId)
    expect((await database.query('select status,student_id from public.my_parent_link_requests()')).rows)
      .toEqual([{ status: 'pending', student_id: studentId }])
    expect((await database.query('select id from public.meetings')).rows).toHaveLength(0)
    await database.exec('savepoint no_pending_history;')
    await expect(database.query(`select * from public.student_attendance_history('${studentId}')`)).rejects.toThrow('verified linked parent')
    await database.exec('rollback to savepoint no_pending_history;')
    await become(unrelatedId)
    expect((await database.query('select * from public.my_parent_link_requests()')).rows).toHaveLength(0)
    await database.exec('savepoint no_other_parent_decision;')
    await expect(database.query(`select public.respond_to_parent_link_request('${requestId}',true,null)`)).rejects.toThrow('requested, email-verified parent')
    await database.exec('rollback to savepoint no_other_parent_decision;')
    await become(parentId)
    await database.exec(`select public.respond_to_parent_link_request('${requestId}',true,'Verified my child');`)
    expect((await database.query('select id from public.meetings')).rows).toHaveLength(1)
    expect((await database.query(`select * from public.visible_schedule_meeting_exceptions(current_date-7,current_date+7)`)).rows).toHaveLength(0)
    await become(studentId)
    expect((await database.query("select name from public.join_class('DBTEST01')")).rows).toEqual([{ name: 'Database integration' }])
    await become(teacherId)
    expect((await database.query(`select parent_email,status from public.student_guardian_summary('${studentId}')`)).rows)
      .toEqual([{ parent_email: 'verified-parent@example.invalid', status: 'approved' }])
    await become(pendingTeacherId)
    await database.exec('savepoint no_unrelated_summary;')
    await expect(database.query(`select * from public.student_guardian_summary('${studentId}')`)).rejects.toThrow('their teacher')
    await database.exec('rollback to savepoint no_unrelated_summary;')
    await become(parentId)
    await database.exec(`select public.respond_to_parent_link_request('${requestId}',false,'Not my child');`)
    expect((await database.query('select id from public.meetings')).rows).toHaveLength(0)
    await database.exec('reset role;')
    expect((await database.query('select is_active from public.class_enrollments')).rows).toEqual([{ is_active: true }])
    await database.exec(`update public.class_enrollments set is_active=false;`)
    await become(teacherId)
    await database.exec('savepoint no_teacher_bypass;')
    await expect(database.query('update public.class_enrollments set is_active=true')).rejects.toThrow('parent must approve')
    await database.exec('rollback to savepoint no_teacher_bypass;')
  })

  it('restricts parent invitations to trusted server calls and locks invited accounts to parent setup', async () => {
    await seedClass()
    const invitedId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268861'
    const permissions = await database.query(`select
      has_function_privilege('anon','public.reserve_parent_invitation(uuid,text)','execute') as anonymous,
      has_function_privilege('authenticated','public.reserve_parent_invitation(uuid,text)','execute') as signed_in,
      has_function_privilege('service_role','public.reserve_parent_invitation(uuid,text)','execute') as server,
      has_table_privilege('authenticated','private.parent_invitations','select') as can_read`)
    expect(permissions.rows).toEqual([{ anonymous: false, signed_in: false, server: true, can_read: false }])
    await database.exec('set local role service_role;')
    const reserved = await database.query<{ invitation_id: string; should_send: boolean }>(`
      select * from public.reserve_parent_invitation('${studentId}',' Invited-Parent@example.invalid ')`)
    expect(reserved.rows[0].should_send).toBe(true)
    expect((await database.query(`select should_send from public.reserve_parent_invitation('${studentId}','invited-parent@example.invalid')`)).rows)
      .toEqual([{ should_send: false }])
    expect((await database.query(`select should_send from public.reserve_parent_invitation('${studentId}','database-teacher@example.invalid')`)).rows)
      .toEqual([{ should_send: false }])
    await database.exec('savepoint pending_inviter;')
    await expect(database.query(`select * from public.reserve_parent_invitation('${pendingTeacherId}','not-allowed@example.invalid')`)).rejects.toThrow('approved teachers')
    await database.exec('rollback to savepoint pending_inviter;')
    await database.exec(`select public.finish_parent_invitation('${reserved.rows[0].invitation_id}',true); reset role;
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
        ('${invitedId}','invited-parent@example.invalid',now(),'{"role":"admin","invitation_kind":"student"}');`)
    expect((await database.query(`select role,onboarding_completed_at from public.profiles where id='${invitedId}'`)).rows)
      .toEqual([{ role: 'parent', onboarding_completed_at: null }])
    await become(invitedId)
    expect((await database.query('select public.my_parent_invitation() as invited')).rows).toEqual([{ invited: true }])
    await database.exec('savepoint invited_role_escape;')
    await expect(database.query("select public.complete_account_setup('Invited Parent','student')")).rejects.toThrow('parent account')
    await database.exec('rollback to savepoint invited_role_escape;')
    await database.exec("select public.complete_account_setup('Invited Parent','parent');")
    expect((await database.query(`select student_id,status from public.my_parent_link_requests()`)).rows)
      .toEqual([{ student_id: studentId, status: 'pending' }])
    expect((await database.query('select * from public.guardian_links')).rows).toHaveLength(0)
    expect((await database.query('select id from public.meetings')).rows).toHaveLength(0)
    await database.exec('reset role; set local role service_role;')
    for (let index = 0; index < 4; index += 1) {
      await database.query(`select * from public.reserve_parent_invitation('${studentId}','quota-${index}@example.invalid')`)
    }
    await database.exec('savepoint invite_quota;')
    await expect(database.query(`select * from public.reserve_parent_invitation('${studentId}','quota-last@example.invalid')`)).rejects.toThrow('wait before sending')
    await database.exec('rollback to savepoint invite_quota;')
  })

  it('registers the scanned ID without a parent but still prevents course enrollment until consent', async () => {
    await seedClass()
    await database.exec(`insert into auth.users(id,email,email_confirmed_at) values('${unrelatedId}','id-only-student@example.invalid',now());`)
    await become(unrelatedId)
    await database.exec(`select public.complete_account_setup('ID Only Student','student');
      select public.complete_student_registration('ID Only Student','SCHOOL-ID-ONLY-1234',null);`)
    expect((await database.query(`select guardian_email,registration_completed_at is not null as registered from public.student_profiles where user_id='${unrelatedId}'`)).rows)
      .toEqual([{ guardian_email: null, registered: true }])
    await database.exec('savepoint no_parent_course;')
    await expect(database.query("select public.join_class('DBTEST01')")).rejects.toThrow('parent must approve')
    await database.exec('rollback to savepoint no_parent_course; reset role;')
    expect((await database.query(`select student_id from private.student_credentials where student_id='${unrelatedId}'`)).rows)
      .toEqual([{ student_id: unrelatedId }])
  })

  it('revokes stale email consent and requires a fresh parent decision for the new confirmed address', async () => {
    await seedClass()
    await become(parentId)
    expect((await database.query('select id from public.meetings')).rows).toHaveLength(1)
    await database.exec(`reset role; update auth.users set email='changed-parent@example.invalid',email_confirmed_at=now() where id='${parentId}';`)
    await become(parentId)
    expect((await database.query('select id from public.meetings')).rows).toHaveLength(0)
    expect((await database.query('select * from public.my_parent_link_requests()')).rows).toHaveLength(0)
    await become(studentId)
    expect((await database.query(`select status from public.student_guardian_summary('${studentId}')`)).rows).toEqual([{ status: 'rejected' }])
    await database.exec('savepoint stale_parent_join;')
    await expect(database.query("select public.join_class('DBTEST01')")).rejects.toThrow('parent must approve')
    await database.exec('rollback to savepoint stale_parent_join;')
    const requestId = (await database.query<{ id: string }>("select id from public.request_student_parent_link('changed-parent@example.invalid')")).rows[0].id
    await become(parentId)
    expect((await database.query('select status from public.my_parent_link_requests()')).rows).toEqual([{ status: 'pending' }])
    await database.exec(`select public.respond_to_parent_link_request('${requestId}',true,null);`)
    expect((await database.query('select id from public.meetings')).rows).toHaveLength(1)
    await database.exec(`reset role; update auth.users set email_confirmed_at=null where id='${parentId}';`)
    await become(parentId)
    expect((await database.query('select id from public.meetings')).rows).toHaveLength(0)
  })

  it('recovers stale invitation leases and safely resends only trusted unconfirmed parent invitations', async () => {
    await seedClass()
    const invitedId = 'a36236ea-e56a-4bd4-ad0d-9b5b40268862'
    await database.exec('set local role service_role;')
    const first = (await database.query<{ invitation_id: string }>(`
      select invitation_id from public.reserve_parent_invitation('${studentId}','retry-parent@example.invalid')`)).rows[0].invitation_id
    await database.exec(`reset role; update private.parent_invitations set requested_at=now()-interval '2 hours'; set local role service_role;`)
    const second = (await database.query<{ invitation_id: string; should_send: boolean }>(`
      select * from public.reserve_parent_invitation('${teacherId}','retry-parent@example.invalid')`)).rows[0]
    expect(second.should_send).toBe(true)
    expect(second.invitation_id).not.toBe(first)
    // A late completion from an interrupted worker cannot finish a new lease.
    await database.exec(`select public.finish_parent_invitation('${first}',true); reset role;`)
    expect((await database.query('select status,student_id from private.parent_invitations')).rows)
      .toEqual([{ status: 'reserved', student_id: studentId }])
    await database.exec(`insert into auth.users(id,email) values('${invitedId}','retry-parent@example.invalid');
      update private.parent_invitations set requested_at=now()-interval '2 hours',status='sent'; set local role service_role;`)
    const third = (await database.query<{ invitation_id: string; should_send: boolean }>(`
      select * from public.reserve_parent_invitation('${teacherId}','retry-parent@example.invalid')`)).rows[0]
    expect(third.should_send).toBe(true)
    await database.exec(`select public.finish_parent_invitation('${third.invitation_id}',false); reset role;
      update auth.users set email_confirmed_at=now() where id='${invitedId}';`)
    await become(invitedId)
    expect((await database.query('select public.my_parent_invitation() as invited')).rows).toEqual([{ invited: true }])
    await database.exec("select public.complete_account_setup('Retry Parent','parent');")
    expect((await database.query('select student_id,status from public.my_parent_link_requests()')).rows)
      .toEqual([{ student_id: studentId, status: 'pending' }])
    await database.exec('reset role; set local role service_role;')
    expect((await database.query(`select should_send from public.reserve_parent_invitation('${studentId}','retry-parent@example.invalid')`)).rows)
      .toEqual([{ should_send: false }])
  })

  it('removes meeting titles, forces self-check to class start and keeps manual attendance outside the student window', async () => {
    await seedClass('self_online')
    expect((await database.query(`select column_name from information_schema.columns where table_schema='public'
      and table_name in('meetings','student_available_meetings') and column_name in('title','meeting_title')`)).rows).toHaveLength(0)
    await database.exec('savepoint no_early_schedule;')
    await expect(database.query(`update public.class_schedules set check_in_minutes_before=1 where id='${scheduleId}'`)).rejects.toThrow('check_in_starts_at_class')
    await database.exec('rollback to savepoint no_early_schedule;')
    await database.exec(`update public.meetings set starts_at=now()+interval '1 hour',ends_at=now()+interval '2 hours',
      attendance_opens_at=now()-interval '1 hour',attendance_closes_at=now()+interval '90 minutes' where schedule_id='${scheduleId}';`)
    expect((await database.query('select attendance_opens_at=starts_at as starts_with_class from public.meetings')).rows)
      .toEqual([{ starts_with_class: true }])
    await become(studentId)
    expect((await database.query('select * from public.student_available_meetings')).rows).toHaveLength(0)
    const meetingId = (await database.query<{ id: string }>('select id from public.meetings')).rows[0].id
    await database.exec('savepoint too_early_self_check;')
    await expect(database.query(`select public.submit_self_attendance('${meetingId}','${studentId}/${meetingId}/selfie.jpg',null,14,121,10)`))
      .rejects.toThrow('window is not open')
    await database.exec('rollback to savepoint too_early_self_check;')
    await become(teacherId)
    await database.exec(`select public.record_manual_attendance('${meetingId}','${studentId}','present',null);`)
    await become(parentId)
    expect((await database.query(`select location_status,latitude,longitude from public.student_attendance_history('${studentId}')`)).rows)
      .toEqual([{ location_status: 'teacher_confirmed_on_campus', latitude: null, longitude: null }])
    await become(teacherId)
    await database.exec(`select public.record_manual_attendance('${meetingId}','${studentId}','absent',null);`)
    await become(parentId)
    expect((await database.query(`select location_status from public.student_attendance_history('${studentId}')`)).rows)
      .toEqual([{ location_status: 'not_recorded' }])
  })
})
