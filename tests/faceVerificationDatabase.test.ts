// @vitest-environment node
import { readFile,readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest'

const directory=fileURLToPath(new URL('../supabase/migrations/',import.meta.url))
const migrationName='20261026105417_fix_faceres_distance_and_fresh_face_checks.sql'
const teacher='f0000000-0000-4000-8000-000000000001',student='f0000000-0000-4000-8000-000000000002'
const parent='f0000000-0000-4000-8000-000000000003'
const course='f0000000-0000-4000-8000-000000000010',meeting='f0000000-0000-4000-8000-000000000011'
let db:PGlite
let scaffold=''
const migrations:Array<{name:string;sql:string}>=[]
const vector=(value:number)=>`array_fill(${value}::double precision,array[1024])`
beforeAll(async()=>{
  const common=await readFile(new URL('./databaseMigrations.test.ts',import.meta.url),'utf8')
  const literal=common.match(/const platformScaffold = (`[\s\S]*?`)\r?\n/)?.[1]
  if(!literal) throw new Error('Supabase platform scaffold missing')
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

async function seed(database=db){
  await database.exec(`insert into auth.users(id,email,email_confirmed_at) values('${teacher}','face-teacher@example.invalid',now()),('${student}','face-student@example.invalid',now()),('${parent}','face-parent@example.invalid',now());
    update public.profiles set role='teacher',onboarding_completed_at=now(),teacher_approval_status='approved',teacher_approved_at=now() where id='${teacher}';
    update public.profiles set role='student',onboarding_completed_at=now() where id='${student}';
    update public.profiles set role='parent',onboarding_completed_at=now() where id='${parent}';
    insert into public.student_profiles(user_id,guardian_email,registration_completed_at) values('${student}','face-parent@example.invalid',now());
    insert into public.guardian_link_requests(student_id,parent_id,parent_email,status,responded_at) values('${student}','${parent}','face-parent@example.invalid','approved',now());
    insert into public.guardian_links(parent_id,student_id,verified_guardian_email) values('${parent}','${student}','face-parent@example.invalid');
    insert into public.classes(id,teacher_id,name,join_code) values('${course}','${teacher}','Face comparison regression','FACETEST');
    insert into public.class_enrollments(class_id,student_id) values('${course}','${student}');
    insert into public.meetings(id,class_id,meeting_date,starts_at,ends_at,attendance_mode,attendance_opens_at,attendance_closes_at,created_by)
      values('${meeting}','${course}',current_date,now()-interval '10 minutes',now()+interval '50 minutes','self_online',now()-interval '10 minutes',now()+interval '50 minutes','${teacher}');
    select set_config('request.jwt.claims','{"sub":"${student}","role":"authenticated"}',false);
    set role authenticated;
    select public.enroll_my_face(${vector(1)},'human-faceres-3.3.6-fresh-v2',3);
    reset role;`)
}
const verify=(candidate=1,live=.99,real=.99,model='human-faceres-3.3.6-fresh-v2')=>`select * from public.verify_my_face_for_meeting('${meeting}',${vector(candidate)},'${model}',${live},${real})`

describe('actual server FaceRes verification',()=>{
  it('uses the exact model matcher and rejects cosine-identical but distant descriptors',async()=>{
    expect((await db.query(`select private.faceres_similarity(${vector(1)},${vector(2)}) as different,
      private.faceres_similarity(${vector(1)},${vector(1)}) as same,
      private.faceres_similarity(${vector(1)},${vector(1.3)}) as borderline`)).rows)
      .toEqual([{different:0,same:1,borderline:.53}])
    await seed();await db.exec('set local role authenticated;')
    expect((await db.query<{matched:boolean;similarity:number}>(verify(2))).rows[0]).toMatchObject({matched:false,similarity:0})
    expect((await db.query<{matched:boolean;similarity:number}>(verify(1))).rows[0]).toMatchObject({matched:true,similarity:1})
  })
  it('revokes an earlier successful proof when a later photo fails matching',async()=>{
    await seed();await db.exec('set local role authenticated;')
    await db.query(verify(1));await db.query(verify(2));await db.exec('reset role;')
    expect((await db.query(`select count(*)::integer as usable from private.face_verification_sessions where student_id='${student}' and matched and consumed_at is null`)).rows)
      .toEqual([{usable:0}])
    expect((await db.query(`select count(*)::integer as retained from private.face_verification_sessions where student_id='${student}'`)).rows)
      .toEqual([{retained:2}])
    await db.exec('set local role authenticated; savepoint failed_photo;')
    await expect(db.query(`select * from public.submit_self_attendance('${meeting}','${student}/${meeting}/different.jpg',null,14,121,10)`)).rejects.toThrow('Complete face verification')
    await db.exec('rollback to savepoint failed_photo;')
  })
  it('does not accept a low-liveness or spoofed photo even when its descriptor matches',async()=>{
    await seed();await db.exec('set local role authenticated;')
    expect((await db.query<{matched:boolean}>(verify(1,.25,.99))).rows[0].matched).toBe(false)
    expect((await db.query<{matched:boolean}>(verify(1,.99,.25))).rows[0].matched).toBe(false)
    expect((await db.query<{matched:boolean}>(verify(1,.99,.99))).rows[0].matched).toBe(true)
  })
  it('rejects malformed model input and unsupported saved formats without accepting a fallback match',async()=>{
    await seed();await db.exec('set local role authenticated; savepoint bad_model;')
    await expect(db.query(verify(1,.99,.99,'invented-model'))).rejects.toThrow('Update the app')
    await db.exec('rollback to savepoint bad_model; savepoint bad_descriptor;')
    await expect(db.query(`select * from public.verify_my_face_for_meeting('${meeting}',${vector(0)},'human-faceres-3.3.6-fresh-v2',.99,.99)`)).rejects.toThrow('new face photo is invalid')
    await db.exec('rollback to savepoint bad_descriptor; reset role;')
    for(const value of ['array_fill(0::double precision,array[1024])','array_fill(1::double precision,array[64])',"array_fill('NaN'::double precision,array[1024])","array_fill('Infinity'::double precision,array[1024])",'array_fill(1::double precision,array[32,32])']) {
      expect((await db.query<{valid:boolean}>(`select private.validate_face_embedding(${value}) as valid`)).rows[0].valid).toBe(false)
    }
    await db.exec(`update private.student_face_templates set model_version='legacy-model' where student_id='${student}';set local role authenticated;savepoint old_template;`)
    await expect(db.query(verify())).rejects.toThrow('administrator to authorize a retake')
    await db.exec('rollback to savepoint old_template;')
  })
  it('keeps the model comparator and all enrolled vectors private',async()=>{
    expect((await db.query(`select has_function_privilege('authenticated','private.faceres_similarity(double precision[],double precision[])','execute') as client_comparison,
      has_table_privilege('authenticated','private.student_face_templates','select') as templates,
      has_function_privilege('anon','public.verify_my_face_for_meeting(uuid,double precision[],text,double precision,double precision)','execute') as anonymous_verification`)).rows)
      .toEqual([{client_comparison:false,templates:false,anonymous_verification:false}])
  })
  it('requires fresh capture from updated clients while retaining compatible earlier enrollments',async()=>{
    await seed()
    await db.exec(`update private.student_face_templates set model_version='human-faceres-3.3.6' where student_id='${student}';set local role authenticated;savepoint old_client;`)
    await expect(db.query(verify(1,.99,.99,'human-faceres-3.3.6'))).rejects.toThrow('Update the app')
    await db.exec('rollback to savepoint old_client;')
    expect((await db.query<{matched:boolean}>(verify())).rows[0].matched).toBe(true)
    await db.exec('reset role;')
    expect((await db.query(`select model_version from private.student_face_templates where student_id='${student}'`)).rows)
      .toEqual([{model_version:'human-faceres-3.3.6'}])
  })
  it('invalidates only unused grants issued by the old metric when the real migration is applied',async()=>{
    const legacy=new PGlite({extensions:{pgcrypto}})
    try{
      await legacy.exec(scaffold)
      for(const migration of migrations) if(migration.name!==migrationName) await legacy.exec(migration.sql)
      await seed(legacy)
      await legacy.exec(`insert into private.face_verification_sessions(student_id,meeting_id,model_version,similarity,liveness_score,antispoof_score,matched)
        values('${student}','${meeting}','human-faceres-3.3.6',.99,.99,.99,true);`)
      await legacy.exec(migrations.find(migration=>migration.name===migrationName)!.sql)
      expect((await legacy.query('select consumed_at is not null as consumed from private.face_verification_sessions')).rows).toEqual([{consumed:true}])
      expect((await legacy.query('select count(*)::integer as count from private.student_face_templates')).rows).toEqual([{count:1}])
      expect((await legacy.query('select count(*)::integer as count from public.attendance_records')).rows).toEqual([{count:0}])
    }finally{await legacy.close()}
  },60000)
})
