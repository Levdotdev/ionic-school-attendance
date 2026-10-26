// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest'
let db:PGlite
const admin='a0000000-0000-4000-8000-000000000001',student='a0000000-0000-4000-8000-000000000002',otherAdmin='a0000000-0000-4000-8000-000000000003'
beforeAll(async()=>{
  db=new PGlite()
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema private;create schema auth;
    create table auth.users(id uuid primary key,email_confirmed_at timestamptz);
    create table public.profiles(id uuid primary key,role text,onboarding_completed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
    create function private.notify_portal_user(uuid) returns void language sql as $$select$$;
    grant usage on schema private,auth to authenticated,service_role;
    grant execute on function auth.uid() to authenticated,service_role;
    grant select on public.profiles to authenticated;
    insert into auth.users values('${admin}',now()),('${student}',now()),('${otherAdmin}',now());
    insert into public.profiles values('${admin}','admin',now()),('${student}','student',now()),('${otherAdmin}','admin',now());`)
  const sql=await readFile(new URL('../supabase/migrations/20261026105210_app_release_distribution.sql',import.meta.url),'utf8')
  try{await db.exec(sql)}catch(error){const detail=error as {position?:number;message?:string};throw new Error(`${detail.message}; near: ${sql.slice(Math.max(0,Number(detail.position)-100),Number(detail.position)+100)}`)}
},30000)
beforeEach(async()=>{await db.exec('begin')})
afterEach(async()=>{await db.exec('rollback')})
afterAll(async()=>{await db?.close()})
async function reserve(actor=admin,platform='android'){
  return(await db.query<{id:string;staging_key:string;object_key:string}>(`select * from public.reserve_app_release_upload($1,$2,'1.0.0','Android 9','New version',$3,100,$4,$5)`,[actor,platform,platform==='android'?'attendance.apk':'attendance.ipa',platform==='android'?'application/vnd.android.package-archive':'application/octet-stream','a'.repeat(64)])).rows[0]
}
describe('private app release distribution',()=>{
  it('reserves immutable per-upload keys and atomically replaces the active platform release',async()=>{
    const first=await reserve()
    expect(first.staging_key).toBe(`staging/${first.id}/app.apk`)
    expect(first.object_key).toBe(`releases/${first.id}/app.apk`)
    await db.query('select public.publish_app_release($1,$2)',[admin,first.id])
    const second=await reserve()
    await db.query('select public.publish_app_release($1,$2)',[admin,second.id])
    expect((await db.query('select id from public.app_releases where is_active')).rows).toEqual([{id:second.id}])
    expect((await db.query('select count(*)::integer as count from public.app_releases')).rows).toEqual([{count:2}])
    await db.exec(`set role authenticated;select set_config('request.jwt.claims','{"sub":"${student}"}',true)`)
    expect((await db.query('select id from public.app_releases')).rows).toEqual([{id:second.id}])
    expect((await db.query(`select has_table_privilege('authenticated','private.app_release_uploads','SELECT') as upload_access,
      has_function_privilege('authenticated','public.publish_app_release(uuid,uuid,text,text,text,text)','EXECUTE') as publish_access`)).rows).toEqual([{upload_access:false,publish_access:false}])
  })
  it('requires a verified admin and a valid matching package',async()=>{
    await db.exec('savepoint wrong_role')
    await expect(reserve(student)).rejects.toThrow('Administrator access required')
    await db.exec('rollback to savepoint wrong_role;savepoint mismatch')
    await expect(db.query(`select * from public.reserve_app_release_upload($1,'android','1.0','','','app.ipa',100,'application/octet-stream',$2)`,[admin,'a'.repeat(64)])).rejects.toThrow('correct app package')
    await db.exec('rollback to savepoint mismatch')
    const upload=await reserve()
    expect((await db.query('select * from public.app_release_upload_for_publish($1,$2)',[otherAdmin,upload.id])).rows).toEqual([])
  })
  it('accepts only Apple-owned iOS invitation links and keeps binary paths private',async()=>{
    await db.exec('savepoint unsafe_ios')
    await expect(db.query("select public.publish_app_release($1,null,'https://attacker.invalid/app','1.0','','')",[admin])).rejects.toThrow('Apple App Store')
    await db.exec('rollback to savepoint unsafe_ios')
    const published=(await db.query<{id:string}>("select public.publish_app_release($1,null,'https://testflight.apple.com/join/AbCd1234','1.0','iOS 15','Test version') as id",[admin])).rows[0]
    expect((await db.query('select platform,delivery,file_name from public.app_releases where id=$1',[published.id])).rows).toEqual([{platform:'ios',delivery:'ios_store',file_name:null}])
    expect((await db.query('select * from public.app_release_object($1,$2)',[student,published.id])).rows).toEqual([])
  })
  it('does not publish expired reservations and hides an unpublished download from normal users',async()=>{
    const upload=await reserve()
    await db.query("update private.app_release_uploads set expires_at=now()-interval '1 minute' where id=$1",[upload.id])
    expect((await db.query('select * from public.app_release_upload_for_publish($1,$2)',[admin,upload.id])).rows).toEqual([])
    await db.query("update private.app_release_uploads set expires_at=now()+interval '1 minute' where id=$1",[upload.id])
    await db.query('select public.publish_app_release($1,$2)',[admin,upload.id])
    expect((await db.query('select * from public.app_release_object($1,$2)',[student,upload.id])).rows).toHaveLength(1)
    await db.query('select public.unpublish_app_release($1,$2)',[admin,upload.id])
    expect((await db.query('select * from public.app_release_object($1,$2)',[student,upload.id])).rows).toEqual([])
    expect((await db.query('select * from public.app_release_object($1,$2)',[admin,upload.id])).rows).toHaveLength(1)
  })
})
