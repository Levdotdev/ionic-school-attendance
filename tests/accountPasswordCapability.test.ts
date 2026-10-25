// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'

describe('authoritative email password capability', () => {
  it('stamps actual password capability across Auth updates and restricts the status RPC to its own account', async () => {
    const database = new PGlite()
    try {
      await database.exec(`create role anon; create role authenticated; create schema private; create schema auth;
        create table auth.users(id uuid primary key,encrypted_password text default '',raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');
        create table private.realtime_test_events(user_id uuid);
        create function private.notify_portal_user(p_user_id uuid) returns void language sql as $$ insert into private.realtime_test_events values(p_user_id) $$;
        create function auth.uid() returns uuid language sql stable as $$ select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
        grant usage on schema private,auth to authenticated; grant execute on function auth.uid() to authenticated;
      `)
      const migration = await readFile(new URL('../supabase/migrations/20261025233703_account_password_capability.sql', import.meta.url), 'utf8')
      await database.exec(migration)
      const social='a0000000-0000-4000-8000-000000000001', email='a0000000-0000-4000-8000-000000000002'
      await database.exec(`insert into auth.users(id,raw_user_meta_data) values('${social}','{"has_email_password":true}');
        insert into auth.users(id,encrypted_password) values('${email}','test-password-hash-placeholder');`)
      expect((await database.query('select raw_app_meta_data from auth.users order by id')).rows).toEqual([
        {raw_app_meta_data:{has_email_password:false}},{raw_app_meta_data:{has_email_password:true}},
      ])
      await database.exec(`update auth.users set encrypted_password='new-test-hash-placeholder' where id='${social}';
        update auth.users set raw_app_meta_data='{"has_email_password":false,"provider":"google"}' where id='${social}';`)
      expect((await database.query(`select raw_app_meta_data from auth.users where id='${social}'`)).rows).toEqual([{raw_app_meta_data:{has_email_password:true,provider:'google'}}])
      await database.exec(`set role authenticated; select set_config('request.jwt.claims','{"sub":"${social}"}',false);`)
      expect((await database.query('select * from public.my_account_security()')).rows).toEqual([{has_password:true}])
      expect((await database.query(`select has_table_privilege('authenticated','auth.users','SELECT') as can_read_hashes,
        has_function_privilege('anon','public.my_account_security()','EXECUTE') as anonymous_status`)).rows).toEqual([{can_read_hashes:false,anonymous_status:false}])
      await database.exec(`reset role; update auth.users set encrypted_password='' where id='${social}'; set role authenticated;`)
      expect((await database.query('select * from public.my_account_security()')).rows).toEqual([{has_password:false}])
      await database.exec('reset role;')
      expect((await database.query('select user_id from private.realtime_test_events')).rows).toEqual([{user_id:social},{user_id:social}])
    } finally { await database.close() }
  }, 30000)
})
