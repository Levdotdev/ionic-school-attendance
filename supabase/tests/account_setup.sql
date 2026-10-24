-- Run against a local database after all migrations. Every fixture and change
-- is rolled back. The script fails immediately when an assertion is violated.
begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('7ad92533-2122-4b6f-90de-03551a3ef001', 'authenticated', 'authenticated', 'setup-teacher@example.invalid', now(), '{"provider":"google","providers":["google"]}', '{"role":"admin","full_name":"Teacher Fixture"}', now(), now()),
  ('7ad92533-2122-4b6f-90de-03551a3ef002', 'authenticated', 'authenticated', 'setup-parent@example.invalid', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('7ad92533-2122-4b6f-90de-03551a3ef003', 'authenticated', 'authenticated', 'setup-student@example.invalid', now(), '{"provider":"facebook","providers":["facebook"]}', '{}', now(), now()),
  ('7ad92533-2122-4b6f-90de-03551a3ef004', 'authenticated', 'authenticated', 'setup-unverified@example.invalid', null, '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('7ad92533-2122-4b6f-90de-03551a3ef005', 'authenticated', 'authenticated', 'setup-established-student@example.invalid', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now());

insert into public.student_profiles (user_id) values ('7ad92533-2122-4b6f-90de-03551a3ef005');

do $$
begin
  assert (select count(*) = 4 from public.profiles where id in (
    '7ad92533-2122-4b6f-90de-03551a3ef001', '7ad92533-2122-4b6f-90de-03551a3ef002',
    '7ad92533-2122-4b6f-90de-03551a3ef003', '7ad92533-2122-4b6f-90de-03551a3ef004'
  ) and role = 'student' and onboarding_completed_at is null), 'All providers must start unconfigured and metadata must not grant admin';
  assert not has_function_privilege('anon', 'public.complete_account_setup(text,text)', 'execute'), 'Anonymous callers must not execute account setup';
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"7ad92533-2122-4b6f-90de-03551a3ef001","role":"authenticated"}', true);

do $$
begin
  begin
    perform public.complete_account_setup('Teacher Fixture', 'admin');
    raise exception 'TEST FAILURE: self-admin request was accepted';
  exception when invalid_parameter_value then null;
  end;
end;
$$;

select public.complete_account_setup('Teacher Fixture', 'teacher');

do $$
begin
  assert (select role = 'teacher' and teacher_approval_status = 'pending' and teacher_approved_at is null and onboarding_completed_at is not null
    from public.profiles where id = '7ad92533-2122-4b6f-90de-03551a3ef001'), 'A self-registered teacher must always await approval';
  begin
    perform public.complete_account_setup('Teacher Fixture', 'parent');
    raise exception 'TEST FAILURE: completed account changed its role';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set teacher_approval_status = 'approved', teacher_approved_at = now()
    where id = '7ad92533-2122-4b6f-90de-03551a3ef001';
    raise exception 'TEST FAILURE: teacher self-approved directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set role = 'admin', teacher_approval_status = null
    where id = '7ad92533-2122-4b6f-90de-03551a3ef001';
    raise exception 'TEST FAILURE: direct profile update granted admin';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set onboarding_completed_at = null
    where id = '7ad92533-2122-4b6f-90de-03551a3ef001';
    raise exception 'TEST FAILURE: direct profile update reset one-time onboarding';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"7ad92533-2122-4b6f-90de-03551a3ef002","role":"authenticated"}', true);
select public.complete_account_setup('Parent Fixture', 'parent');
do $$
begin
  assert (select role = 'parent' and teacher_approval_status is null and onboarding_completed_at is not null
    from public.profiles where id = '7ad92533-2122-4b6f-90de-03551a3ef002'), 'Email account must support parent onboarding';
end;
$$;

select set_config('request.jwt.claims', '{"sub":"7ad92533-2122-4b6f-90de-03551a3ef003","role":"authenticated"}', true);
select public.complete_account_setup('Student Fixture', 'student');
do $$
begin
  assert (select role = 'student' and onboarding_completed_at is not null
    from public.profiles where id = '7ad92533-2122-4b6f-90de-03551a3ef003'), 'Facebook account must support student onboarding';
end;
$$;

select set_config('request.jwt.claims', '{"sub":"7ad92533-2122-4b6f-90de-03551a3ef004","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.complete_account_setup('Unverified Fixture', 'teacher');
    raise exception 'TEST FAILURE: unverified account completed setup';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"7ad92533-2122-4b6f-90de-03551a3ef005","role":"authenticated"}', true);
do $$
begin
  begin
    perform public.complete_account_setup('Established Student', 'teacher');
    raise exception 'TEST FAILURE: established student bypassed role protection during onboarding';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;
