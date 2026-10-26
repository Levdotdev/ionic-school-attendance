// @vitest-environment node
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

let db: PGlite
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const teacher = id(1), student = id(2), parent = id(3), admin = id(4), course = id(10), meeting = id(11)
beforeAll(async () => {
  db = new PGlite({ extensions: { pgcrypto } })
  // Reuse the Supabase-owned scaffold, while executing the real migrations.
  const common = await readFile(new URL('./databaseMigrations.test.ts', import.meta.url), 'utf8')
  const scaffold = common.match(/const platformScaffold = (`[\s\S]*?`)\r?\n/)?.[1]
  if (!scaffold) throw new Error('Supabase test scaffold not found')
  await db.exec(new Function(`return ${scaffold}`)())
  const directory = fileURLToPath(new URL('../supabase/migrations/', import.meta.url))
  for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql')).sort()) {
    await db.exec((await readFile(`${directory}/${file}`, 'utf8')).replace(/^create extension if not exists pg_cron with schema pg_catalog;\r?$/gim, ''))
  }
}, 60000)
beforeEach(async () => { await db.exec('begin') })
afterEach(async () => { await db.exec('rollback') })
afterAll(async () => { await db?.close() })

async function seed() {
  await db.exec(`insert into auth.users(id,email,email_confirmed_at) values
    ('${teacher}','teacher@example.test',now()),('${student}','student@example.test',now()),
    ('${parent}','parent@example.test',now()),('${admin}','admin@example.test',now());
    update public.profiles set role='teacher',teacher_approval_status='approved',teacher_approved_at=now(),onboarding_completed_at=now() where id='${teacher}';
    update public.profiles set role='student',onboarding_completed_at=now() where id='${student}';
    update public.profiles set role='parent',onboarding_completed_at=now() where id='${parent}';
    update public.profiles set role='admin',onboarding_completed_at=now() where id='${admin}';
    insert into public.student_profiles(user_id,guardian_email,registration_completed_at) values('${student}','parent@example.test',now());
    insert into public.guardian_link_requests(student_id,parent_id,parent_email,status,responded_at) values('${student}','${parent}','parent@example.test','approved',now());
    insert into public.guardian_links(parent_id,student_id,verified_guardian_email) values('${parent}','${student}','parent@example.test');
    insert into public.classes(id,teacher_id,name,join_code) values('${course}','${teacher}','Alert course','ALERT123');
    insert into public.class_enrollments(class_id,student_id) values('${course}','${student}');
    update public.class_enrollments set joined_at=now()-interval '1 day';
    update private.class_enrollment_periods set enrolled_at=now()-interval '1 day';
    insert into public.meetings(id,class_id,meeting_date,starts_at,ends_at,attendance_mode,attendance_opens_at,attendance_closes_at,created_by)
      values('${meeting}','${course}',current_date,now()-interval '2 hours',now()-interval '1 hour','teacher_manual',now()-interval '2 hours',now()-interval '1 hour','${teacher}');
    insert into public.device_push_tokens(user_id,installation_id,provider,platform,token) values
      ('${student}','${id(21)}','fcm','android','student-device-token-123456'),('${parent}','${id(22)}','fcm','android','parent-device-token-123456');
    delete from private.activity_alert_deliveries;`)
}
async function mark(status = 'present') {
  await db.exec(`insert into public.attendance_records(meeting_id,student_id,status,source,recorded_by)
    values('${meeting}','${student}','${status}','teacher','${teacher}') on conflict(meeting_id,student_id) do update set status=excluded.status;`)
}

describe('actual activity-alert database', () => {
  it('keeps its outbox private and service-only', async () => {
    expect((await db.query(`select has_table_privilege('authenticated','private.activity_alert_deliveries','select') as can_read,
      has_function_privilege('anon','public.claim_activity_alert_deliveries(integer)','execute') as anon_claim,
      has_function_privilege('authenticated','public.resolve_activity_alert_delivery(uuid,uuid)','execute') as user_resolve,
      has_function_privilege('service_role','public.claim_activity_alert_deliveries(integer)','execute') as service_claim`)).rows)
      .toEqual([{ can_read: false, anon_claim: false, user_resolve: false, service_claim: true }])
  })
  it('queues parent push/email and student push only, deduplicates unchanged marks, and supersedes corrections', async () => {
    await seed(); await mark()
    const recipients = await db.query('select audience,channel,status from private.activity_alert_deliveries order by audience,channel')
    expect(recipients.rows).toEqual([{ audience: 'parent', channel: 'email', status: 'present' }, { audience: 'parent', channel: 'push', status: 'present' }, { audience: 'student', channel: 'push', status: 'present' }])
    await mark(); expect((await db.query('select id from private.activity_alert_deliveries')).rows).toHaveLength(3)
    await mark('absent')
    expect((await db.query('select status from private.activity_alert_deliveries where cancelled_at is null')).rows).toEqual([{ status: 'absent' }, { status: 'absent' }, { status: 'absent' }])
    expect((await db.query('select id from private.activity_alert_deliveries where cancelled_at is not null')).rows).toHaveLength(3)
  })
  it('queues a new event after an open-meeting record is deleted and entered again', async () => {
    await seed()
    await db.exec(`update public.meetings set ends_at=now()+interval '1 hour',attendance_closes_at=now()+interval '1 hour' where id='${meeting}'`)
    await mark()
    const original = (await db.query<{ event_key: string }>('select distinct event_key from private.activity_alert_deliveries')).rows[0].event_key
    await db.exec(`delete from public.attendance_records where meeting_id='${meeting}'`)
    expect((await db.query('select meeting_id from private.attendance_alert_state')).rows).toEqual([])
    await mark()
    await mark()
    const events = (await db.query<{ event_key: string; revision: number; cancelled: boolean }>(
      'select event_key,revision,cancelled_at is not null as cancelled from private.activity_alert_deliveries',
    )).rows
    expect(events).toHaveLength(6)
    expect(events.filter(row => row.event_key === original).every(row => row.cancelled)).toBe(true)
    expect(events.filter(row => !row.cancelled)).toHaveLength(3)
    expect(events.filter(row => !row.cancelled).every(row => row.event_key !== original && row.revision === 1)).toBe(true)
  })
  it('never replays old absences and only infers after an eligible counted meeting closes', async () => {
    await seed()
    await db.exec('select private.enqueue_closed_attendance_alerts()')
    expect((await db.query('select id from private.activity_alert_deliveries')).rows).toEqual([])
    await db.exec(`update private.activity_alert_settings set enabled_from=now()-interval '2 hours';
      update public.meetings set attendance_mode='self_online',attendance_closes_at=now()+interval '1 hour' where id='${meeting}';
      select private.enqueue_closed_attendance_alerts();`)
    expect((await db.query('select id from private.activity_alert_deliveries')).rows).toEqual([])
    await db.exec(`update public.meetings set attendance_closes_at=now()-interval '30 minutes' where id='${meeting}';
      select private.enqueue_closed_attendance_alerts(); select private.enqueue_closed_attendance_alerts();`)
    expect((await db.query('select status from private.activity_alert_deliveries')).rows).toEqual([{ status: 'absent' }, { status: 'absent' }, { status: 'absent' }])
  })
  it.each(['cancelled', 'archived', 'withdrawn'])('does not infer attendance for a %s meeting or enrollment', async kind => {
    await seed()
    await db.exec(`update private.activity_alert_settings set enabled_from=now()-interval '2 hours'`)
    if (kind === 'cancelled') await db.exec(`update public.meetings set attendance_enabled=false where id='${meeting}'`)
    if (kind === 'archived') await db.exec(`update public.classes set archived_at=now() where id='${course}'`)
    if (kind === 'withdrawn') await db.exec(`update public.class_enrollments set is_active=false where class_id='${course}'`)
    await db.exec('select private.enqueue_closed_attendance_alerts()')
    expect((await db.query('select id from private.activity_alert_deliveries')).rows).toEqual([])
  })
  it('rechecks revoked consent and token ownership before returning a push or email payload', async () => {
    await seed(); await mark()
    const leases = (await db.query<{ id: string; lease_token: string }>('select * from public.claim_activity_alert_deliveries(25)')).rows
    expect(leases).toHaveLength(3)
    await db.exec(`update public.guardian_link_requests set status='rejected',responded_at=now() where parent_id='${parent}';
      update public.device_push_tokens set is_active=false,disabled_at=now() where user_id='${student}';`)
    for (const lease of leases) expect((await db.query(`select * from public.resolve_activity_alert_delivery('${lease.id}','${lease.lease_token}')`)).rows).toEqual([])
  })
  it('sends an absent correction when self-check is voided, and prevents old status leases from resolving', async () => {
    await seed()
    await db.exec(`insert into public.attendance_records(meeting_id,student_id,status,source,recorded_by,selfie_path,verification_status)
      values('${meeting}','${student}','present','self_check','${student}','${student}/${meeting}/selfie.jpg','approved')`)
    const oldLeases=(await db.query<{id:string;lease_token:string}>('select * from public.claim_activity_alert_deliveries(25)')).rows
    await db.exec(`update public.attendance_records set status='absent',verification_status='rejected',reviewed_by='${teacher}',reviewed_at=now() where meeting_id='${meeting}'`)
    for(const lease of oldLeases) expect((await db.query(`select * from public.resolve_activity_alert_delivery('${lease.id}','${lease.lease_token}')`)).rows).toEqual([])
    expect((await db.query('select status from private.activity_alert_deliveries where cancelled_at is null')).rows).toEqual([{status:'absent'},{status:'absent'},{status:'absent'}])
  })
  it('removes queued alerts through meeting deletion and suppresses a canceled meeting at delivery time', async () => {
    await seed(); await mark()
    const leases=(await db.query<{id:string;lease_token:string}>('select * from public.claim_activity_alert_deliveries(25)')).rows
    await db.exec(`update public.meetings set attendance_enabled=false where id='${meeting}'`)
    for(const lease of leases) expect((await db.query(`select * from public.resolve_activity_alert_delivery('${lease.id}','${lease.lease_token}')`)).rows).toEqual([])
    await db.exec(`delete from public.meetings where id='${meeting}'`)
    expect((await db.query('select id from private.activity_alert_deliveries')).rows).toEqual([])
    expect((await db.query('select meeting_id from private.attendance_alert_state')).rows).toEqual([])
  })
  it('does not infer an absence for a student enrolled after the meeting ended', async () => {
    await seed()
    await db.exec(`update private.activity_alert_settings set enabled_from=now()-interval '2 hours';
      update public.class_enrollments set joined_at=now(); update private.class_enrollment_periods set enrolled_at=now();
      select private.enqueue_closed_attendance_alerts();`)
    expect((await db.query('select id from private.activity_alert_deliveries')).rows).toEqual([])
  })
  it('changes a deleted attendance record to inferred absence only after its meeting is closed', async () => {
    await seed(); await mark()
    await db.exec(`delete from public.attendance_records where meeting_id='${meeting}'`)
    expect((await db.query('select status from private.activity_alert_deliveries where cancelled_at is null')).rows).toEqual([{status:'absent'},{status:'absent'},{status:'absent'}])
  })
  it('uses current verified parent email at delivery instead of a stored destination', async () => {
    await seed(); await mark()
    const leases = (await db.query<{ id: string; lease_token: string }>('select * from public.claim_activity_alert_deliveries(25)')).rows
    await db.exec(`update auth.users set email='new-parent@example.test',email_confirmed_at=now() where id='${parent}';
      update public.guardian_link_requests set parent_email='new-parent@example.test',status='approved' where parent_id='${parent}';
      insert into public.guardian_links(parent_id,student_id,verified_guardian_email) values('${parent}','${student}','new-parent@example.test')
        on conflict(parent_id,student_id) do update set verified_guardian_email=excluded.verified_guardian_email;`)
    const payloads = []
    for (const lease of leases) payloads.push(...(await db.query<{ audience: string; recipient_email: string }>(`select * from public.resolve_activity_alert_delivery('${lease.id}','${lease.lease_token}')`)).rows)
    expect(payloads.filter(row => row.audience === 'parent').every(row => row.recipient_email === 'new-parent@example.test')).toBe(true)
    expect(payloads.filter(row => row.audience === 'parent')).toHaveLength(2)
  })
  it('leases once, rejects stale acknowledgements, retries failures, and completes successful sends', async () => {
    await seed(); await mark()
    const leases = (await db.query<{ id: string; lease_token: string }>('select * from public.claim_activity_alert_deliveries(25)')).rows
    expect((await db.query('select * from public.claim_activity_alert_deliveries(25)')).rows).toEqual([])
    const lease = leases[0]
    expect((await db.query(`select public.complete_activity_alert_delivery('${lease.id}','${id(99)}',true) as completed`)).rows).toEqual([{ completed: false }])
    expect((await db.query(`select public.complete_activity_alert_delivery('${lease.id}','${lease.lease_token}',false) as completed`)).rows).toEqual([{ completed: true }])
    expect((await db.query('select * from public.claim_activity_alert_deliveries(25)')).rows).toEqual([])
    await db.exec(`update private.activity_alert_deliveries set next_attempt_at=now()-interval '1 second' where id='${lease.id}'`)
    const retry = (await db.query<{ id: string; lease_token: string }>('select * from public.claim_activity_alert_deliveries(25)')).rows[0]
    expect(retry.id).toBe(lease.id); expect(retry.lease_token).not.toBe(lease.lease_token)
    await db.exec(`select public.complete_activity_alert_delivery('${retry.id}','${retry.lease_token}',true,'local-message-id',false)`)
    expect((await db.query(`select completed_at is not null as done from private.activity_alert_deliveries where id='${retry.id}'`)).rows).toEqual([{ done: true }])
  })
  it('emails admins for a new completed teacher request and emails the teacher for a decision only', async () => {
    await seed()
    const applicant = id(30)
    await db.exec(`insert into auth.users(id,email,email_confirmed_at) values('${applicant}','applicant@example.test',now());
      update public.profiles set role='teacher',onboarding_completed_at=now(),teacher_approval_status='pending' where id='${applicant}';`)
    expect((await db.query('select kind,audience,channel,status from private.activity_alert_deliveries')).rows).toEqual([{ kind: 'teacher_request', audience: 'admin', channel: 'email', status: 'pending' }])
    await db.exec(`update public.profiles set teacher_approval_status='approved',teacher_approved_by='${admin}',teacher_approved_at=now() where id='${applicant}'`)
    expect((await db.query('select kind,audience,channel,status from private.activity_alert_deliveries where cancelled_at is null')).rows).toEqual([{ kind: 'teacher_decision', audience: 'teacher', channel: 'email', status: 'approved' }])
    await db.exec(`update public.profiles set teacher_approval_status='rejected',teacher_approved_by='${admin}',teacher_approved_at=now() where id='${applicant}'`)
    expect((await db.query('select status from private.activity_alert_deliveries where cancelled_at is null')).rows).toEqual([{ status: 'rejected' }])
  })
})
