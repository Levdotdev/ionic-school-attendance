// @vitest-environment node
import { readFile,readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest'

const directory=fileURLToPath(new URL('../supabase/migrations/',import.meta.url))
const migrationName='20261102132822_administrator_authorized_student_barcode_retakes.sql'
const id=(n:number)=>`b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const admin=id(1),student=id(2),otherStudent=id(3),teacher=id(4),otherTeacher=id(5),parent=id(6),freshStudent=id(7)
const course=id(10),otherCourse=id(11),meeting=id(12)
const original='Original aB12 /- CODE',replacement='Replacement cD34 /- CODE',otherBarcode='Other Student EF56'
let db:PGlite,scaffold:string
const migrations:Array<{name:string;sql:string}>=[]

beforeAll(async()=>{
  const common=await readFile(new URL('./databaseMigrations.test.ts',import.meta.url),'utf8')
  const literal=common.match(/const platformScaffold = (`[\s\S]*?`)\r?\n/)?.[1]
  if(!literal) throw new Error('Supabase test scaffold missing')
  scaffold=new Function(`return ${literal}`)()
  for(const name of(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort()) {
    migrations.push({name,sql:(await readFile(`${directory}/${name}`,'utf8')).replace(/^create extension if not exists pg_cron with schema pg_catalog;\r?$/gim,'')})
  }
  db=new PGlite({extensions:{pgcrypto}})
  await db.exec(scaffold)
  for(const migration of migrations) await db.exec(migration.sql)
},60000)
beforeEach(async()=>{await db.exec('begin')})
afterEach(async()=>{await db.exec('rollback')})
afterAll(async()=>{await db?.close()})

async function actor(userId:string) {
  await db.exec(`reset role; select set_config('request.jwt.claims','{"sub":"${userId}","role":"authenticated"}',false);set local role authenticated;`)
}
async function rejects(sql:string,values:unknown[],message:string|RegExp) {
  await db.exec('savepoint rejected_call')
  await expect(db.query(sql,values)).rejects.toThrow(message)
  await db.exec('rollback to savepoint rejected_call;release savepoint rejected_call;')
}
async function seed() {
  await db.exec(`insert into auth.users(id,email,email_confirmed_at) values
    ('${admin}','barcode-admin@example.invalid',now()),('${student}','barcode-student@example.invalid',now()),
    ('${otherStudent}','barcode-other@example.invalid',now()),('${teacher}','barcode-teacher@example.invalid',now()),
    ('${otherTeacher}','barcode-other-teacher@example.invalid',now()),('${parent}','barcode-parent@example.invalid',now()),
    ('${freshStudent}','barcode-fresh@example.invalid',now());
    update public.profiles set role='admin',onboarding_completed_at=now() where id='${admin}';
    update public.profiles set role='teacher',onboarding_completed_at=now(),teacher_approval_status='approved',teacher_approved_at=now()
      where id in('${teacher}','${otherTeacher}');
    update public.profiles set role='parent',onboarding_completed_at=now() where id='${parent}';
    update public.profiles set role='student',onboarding_completed_at=now() where id in('${student}','${otherStudent}','${freshStudent}');`)
  await actor(student)
  await db.query('select public.complete_student_registration($1,$2,$3,$4)',['Ana','Student',original,'barcode-parent@example.invalid'])
  await actor(otherStudent)
  await db.query('select public.complete_student_registration($1,$2,$3,$4)',['Bea','Other',otherBarcode,'barcode-parent@example.invalid'])
  await db.exec('reset role')
  await db.exec(`update public.guardian_link_requests set status='approved',responded_at=now() where student_id in('${student}','${otherStudent}');
    insert into public.guardian_links(parent_id,student_id,verified_guardian_email) values
      ('${parent}','${student}','barcode-parent@example.invalid'),('${parent}','${otherStudent}','barcode-parent@example.invalid');
    insert into public.classes(id,teacher_id,name,join_code) values('${course}','${teacher}','Barcode test','BARCODE1'),('${otherCourse}','${otherTeacher}','Other course','BARCODE2');
    insert into public.class_enrollments(class_id,student_id) values('${course}','${student}'),('${otherCourse}','${otherStudent}');
    insert into public.meetings(id,class_id,meeting_date,starts_at,ends_at,attendance_mode,attendance_opens_at,attendance_closes_at,created_by)
      values('${meeting}','${course}',current_date,now()-interval '2 hours',now()-interval '1 hour','teacher_manual',now()-interval '2 hours',now()-interval '1 hour','${teacher}');
    insert into public.attendance_records(meeting_id,student_id,status,source,recorded_by)
      values('${meeting}','${student}','present','teacher','${teacher}');`)
}
async function grant(target=student) {
  await actor(admin)
  await db.query('select public.admin_grant_barcode_retake($1,$2)',[target,'Correct the school ID'])
}

describe('administrator-authorized student barcode retakes',()=>{
  it('stores initial exact-case payload privately while returning no value or hash to the student',async()=>{
    await seed()
    expect((await db.query('select barcode_value,barcode_hash=encode(extensions.digest($1,\'sha256\'),\'hex\') as matched from private.student_credentials where student_id=$2',[original,student])).rows)
      .toEqual([{barcode_value:original,matched:true}])
    await actor(student)
    const access=(await db.query<Record<string,unknown>>('select * from public.my_barcode_registration_access()')).rows[0]
    expect(access).toMatchObject({is_registered:true,can_retake:false,granted_at:null})
    expect(Object.keys(access).sort()).toEqual(['can_retake','granted_at','is_registered','registered_at'])
    await rejects('select barcode_value from private.student_credentials',[],/permission denied/)
    await rejects('update private.student_credentials set barcode_value=$1 where student_id=$2',[replacement,student],/permission denied/)
  })
  it('keeps credentials, grants and the original registration helper inaccessible to clients',async()=>{
    expect((await db.query(`select has_table_privilege('authenticated','private.barcode_retake_grants','select') as grant_read,
      has_table_privilege('authenticated','private.barcode_retake_grants','insert') as grant_write,
      has_table_privilege('authenticated','private.student_credentials','select') as credential_read,
      has_function_privilege('authenticated','private.complete_student_registration_initial_impl(text,text,text)','execute') as old_helper,
      has_function_privilege('anon','public.replace_student_barcode(text,uuid)','execute') as anon_replace,
      has_function_privilege('anon','public.class_student_barcode_values(uuid)','execute') as anon_read`)).rows)
      .toEqual([{grant_read:false,grant_write:false,credential_read:false,old_helper:false,anon_replace:false,anon_read:false}])
    expect((await db.query(`select bool_and(not p.prosecdef) as safe from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in('admin_grant_barcode_retake','my_barcode_registration_access','replace_student_barcode','admin_student_barcode_registrations','class_student_barcode_values')`)).rows)
      .toEqual([{safe:true}])
  })
  it('retains parent validation and atomic onboarding for a student registering their ID for the first time',async()=>{
    await seed();await actor(freshStudent)
    await rejects('select public.complete_student_registration($1,$2,$3,$4)',
      ['Fresh','Student','Fresh New ID-aB123','not-registered@example.invalid'],'not a registered')
    await db.exec('reset role')
    expect((await db.query('select user_id from public.student_profiles where user_id=$1',[freshStudent])).rows).toEqual([])
    expect((await db.query('select student_id from private.student_credentials where student_id=$1',[freshStudent])).rows).toEqual([])
  })
  it('requires an administrator to grant a retake and rejects students without initial registration',async()=>{
    await seed()
    for(const user of [student,teacher,parent]) {
      await actor(user)
      await rejects('select public.admin_grant_barcode_retake($1)',[student],'Administrator access required')
      await rejects('select * from public.admin_student_barcode_registrations()',[],'Administrator access required')
    }
    await actor(admin)
    await rejects('select public.admin_grant_barcode_retake($1)',[freshStudent],'initial school ID registration')
    await rejects('select public.admin_grant_barcode_retake($1)',[teacher],'Student not found')
    await rejects('select public.admin_grant_barcode_retake($1,$2)',[student,'x'.repeat(501)],'at most 500')
  })
  it('grants one replacement without changing the active ID and consumes the permission only after success',async()=>{
    await seed();await actor(student)
    await rejects('select public.replace_student_barcode($1,$2)',[replacement,student],'administrator to approve')
    await grant();await grant()
    await db.exec('reset role')
    expect((await db.query('select barcode_value from private.student_credentials where student_id=$1',[student])).rows).toEqual([{barcode_value:original}])
    expect((await db.query('select note from private.barcode_retake_grants where student_id=$1',[student])).rows).toEqual([{note:'CORRECT THE SCHOOL ID'}])
    await actor(student)
    expect((await db.query('select can_retake from public.my_barcode_registration_access()')).rows).toEqual([{can_retake:true}])
    await db.query('select public.replace_student_barcode($1,$2)',[`  ${replacement}  `,student])
    expect((await db.query('select can_retake from public.my_barcode_registration_access()')).rows).toEqual([{can_retake:false}])
    await rejects('select public.replace_student_barcode($1,$2)',['Another XY77 ID',student],'administrator to approve')
    await db.exec('reset role')
    expect((await db.query('select barcode_value,barcode_hash=encode(extensions.digest($1,\'sha256\'),\'hex\') as matched from private.student_credentials where student_id=$2',[replacement,student])).rows)
      .toEqual([{barcode_value:replacement,matched:true}])
    expect((await db.query('select student_id from private.barcode_retake_grants')).rows).toEqual([])
  })
  it('preserves the old credential and approval after invalid or already-registered scans',async()=>{
    await seed();await grant();await actor(student)
    for(const value of [null,'abc','x'.repeat(257),'ABCD\n123',otherBarcode]) {
      await rejects('select public.replace_student_barcode($1,$2)',[value,student],value===otherBarcode?'already registered':'barcode is invalid')
    }
    expect((await db.query('select can_retake from public.my_barcode_registration_access()')).rows).toEqual([{can_retake:true}])
    await db.exec('reset role')
    expect((await db.query('select barcode_value from private.student_credentials where student_id=$1',[student])).rows).toEqual([{barcode_value:original}])
  })
  it('captures a legacy missing value only through an approved rescan without inventing or changing its hash',async()=>{
    await seed();await db.query('update private.student_credentials set barcode_value=null where student_id=$1',[student])
    const before=(await db.query<{barcode_hash:string}>('select barcode_hash from private.student_credentials where student_id=$1',[student])).rows[0]
    await actor(admin)
    expect((await db.query('select barcode_value from public.admin_student_barcode_registrations() where student_id=$1',[student])).rows).toEqual([{barcode_value:null}])
    await grant();await actor(student);await db.query('select public.replace_student_barcode($1,$2)',[original,student]);await db.exec('reset role')
    expect((await db.query('select barcode_hash,barcode_value from private.student_credentials where student_id=$1',[student])).rows)
      .toEqual([{...before,barcode_value:original}])
  })
  it('checks the expected student identity so a delayed scan cannot update another signed-in student',async()=>{
    await seed();await grant();await grant(otherStudent);await actor(otherStudent)
    await rejects('select public.replace_student_barcode($1,$2)',[replacement,student],'student account changed')
    await rejects('select public.replace_student_barcode($1,$2)',[replacement,null],'student account changed')
    await db.exec('reset role')
    expect((await db.query('select student_id from private.barcode_retake_grants order by student_id')).rows).toHaveLength(2)
    expect((await db.query('select barcode_value from private.student_credentials where student_id=$1',[otherStudent])).rows).toEqual([{barcode_value:otherBarcode}])
  })
  it('blocks all old registration signatures from replacing a registered barcode or rewriting onboarding',async()=>{
    await seed();await grant();await actor(student)
    await rejects('select public.complete_student_registration($1,$2,$3,$4)',['Changed','Name',replacement,null],'registration is complete')
    await rejects('select public.complete_student_registration($1,$2,$3)',['Changed Name',replacement,null],'registration is complete')
    await rejects('select private.complete_student_registration_impl($1,$2,$3,$4)',['Changed','Name',replacement,null],'registration is complete')
    await rejects('select private.complete_student_registration_impl($1,$2,$3)',['Changed Name',replacement,null],'registration is complete')
    await rejects('select private.complete_student_registration_initial_impl($1,$2,$3)',['Changed Name',replacement,null],/permission denied/)
    await db.exec('reset role')
    expect((await db.query('select full_name from public.profiles where id=$1',[student])).rows).toEqual([{full_name:'ANA STUDENT'}])
    expect((await db.query('select barcode_value from private.student_credentials where student_id=$1',[student])).rows).toEqual([{barcode_value:original}])
    expect((await db.query('select student_id from private.barcode_retake_grants where student_id=$1',[student])).rows).toHaveLength(1)
  })
  it('retains parent consent, registration dates, enrollment, attendance and independent face enrollment/grants',async()=>{
    await seed();await actor(student)
    await db.query("select public.enroll_my_face(array_fill(1::double precision,array[1024]),'human-faceres-3.3.6-fresh-v2',3)")
    await actor(admin);await db.query('select public.admin_grant_face_retake($1)',[student])
    await db.exec('reset role')
    const before=(await db.query('select registration_completed_at,guardian_email from public.student_profiles where user_id=$1',[student])).rows
    const originalAttendance=(await db.query('select * from public.attendance_records where student_id=$1',[student])).rows
    const originalFace=(await db.query('select model_version,enrolled_at from private.student_face_templates where student_id=$1',[student])).rows
    await grant();await actor(student);await db.query('select public.replace_student_barcode($1,$2)',[replacement,student]);await db.exec('reset role')
    expect((await db.query('select registration_completed_at,guardian_email from public.student_profiles where user_id=$1',[student])).rows).toEqual(before)
    expect((await db.query('select * from public.attendance_records where student_id=$1',[student])).rows).toEqual(originalAttendance)
    expect((await db.query('select model_version,enrolled_at from private.student_face_templates where student_id=$1',[student])).rows).toEqual(originalFace)
    expect((await db.query('select student_id from private.face_retake_grants where student_id=$1',[student])).rows).toHaveLength(1)
    expect((await db.query('select student_id from public.guardian_links where student_id=$1',[student])).rows).toHaveLength(1)
    expect((await db.query('select student_id from public.guardian_link_requests where student_id=$1 and status=\'approved\'',[student])).rows).toHaveLength(1)
    expect((await db.query('select student_id from public.class_enrollments where student_id=$1 and is_active',[student])).rows).toHaveLength(1)
  })
  it('reveals raw values only to admins and the currently approved class-owning teacher',async()=>{
    await seed();await actor(teacher)
    expect((await db.query('select * from public.class_student_barcode_values($1)',[course])).rows).toEqual([{student_id:student,barcode_value:original}])
    await rejects('select * from public.class_student_barcode_values($1)',[otherCourse],'Only this class teacher')
    for(const user of [otherTeacher,parent,student]) {
      await actor(user);await rejects('select * from public.class_student_barcode_values($1)',[course],'Only this class teacher')
    }
    await db.exec(`reset role;update public.profiles set teacher_approval_status='rejected' where id='${teacher}';`)
    await actor(teacher);await rejects('select * from public.class_student_barcode_values($1)',[course],'Only this class teacher')
    await actor(admin)
    expect((await db.query('select * from public.class_student_barcode_values($1)',[course])).rows).toEqual([{student_id:student,barcode_value:original}])
    const entries=(await db.query('select student_id,barcode_value from public.admin_student_barcode_registrations()')).rows
    expect(entries).toContainEqual({student_id:student,barcode_value:original})
    expect(entries).toContainEqual({student_id:freshStudent,barcode_value:null})
  })
  it('includes withdrawn students in the owning teacher’s historical roster without leaking unrelated IDs',async()=>{
    await seed();await db.exec(`update public.class_enrollments set is_active=false where class_id='${course}';`)
    await actor(teacher)
    expect((await db.query('select * from public.class_student_barcode_values($1)',[course])).rows).toEqual([{student_id:student,barcode_value:original}])
  })
  it('invalidates current admin/student/teacher views through counters without publishing barcode payloads',async()=>{
    await seed()
    const before=(await db.query<{revision:number}>('select revision from public.portal_change_events where user_id=$1',[teacher])).rows[0].revision
    await grant();await actor(student);await db.query('select public.replace_student_barcode($1,$2)',[replacement,student]);await db.exec('reset role')
    expect((await db.query<{revision:number}>('select revision from public.portal_change_events where user_id=$1',[teacher])).rows[0].revision).toBeGreaterThan(before)
    expect((await db.query<{payload:string}>('select row_to_json(e)::text as payload from public.portal_change_events e')).rows.every(row=>!row.payload.includes(replacement))).toBe(true)
  })
  it('preserves a legacy hash and exposes no invented ID when the migration is applied',async()=>{
    const legacy=new PGlite({extensions:{pgcrypto}})
    try {
      await legacy.exec(scaffold)
      for(const migration of migrations) if(migration.name!==migrationName) await legacy.exec(migration.sql)
      await legacy.exec(`insert into auth.users(id,email,email_confirmed_at) values('${student}','legacy-barcode@example.invalid',now());
        update public.profiles set role='student',onboarding_completed_at=now() where id='${student}';
        select set_config('request.jwt.claims','{"sub":"${student}","role":"authenticated"}',false);set role authenticated;
        select public.complete_student_registration('Legacy','Student','Legacy Hash Case-bB123',null);reset role;`)
      const before=(await legacy.query<{barcode_hash:string;created_at:Date;updated_at:Date}>('select barcode_hash,created_at,updated_at from private.student_credentials')).rows[0]
      await legacy.exec(migrations.find(migration=>migration.name===migrationName)!.sql)
      expect((await legacy.query('select barcode_hash,created_at,updated_at,barcode_value from private.student_credentials')).rows)
        .toEqual([{...before,barcode_value:null}])
    } finally {await legacy.close()}
  },60000)
})
