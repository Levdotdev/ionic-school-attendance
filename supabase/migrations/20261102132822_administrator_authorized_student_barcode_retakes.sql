-- Existing hashes cannot be reversed. Legacy credentials keep a NULL value
-- until the student completes an administrator-authorized camera rescan.
alter table private.student_credentials add column barcode_value text;
alter table private.student_credentials add constraint student_credentials_value_matches_hash check (
  barcode_value is null or (
    barcode_value=btrim(barcode_value) and char_length(barcode_value) between 4 and 256
    and barcode_value!~'[[:cntrl:]]'
    and barcode_hash=encode(extensions.digest(barcode_value,'sha256'),'hex')
  )
);
comment on column private.student_credentials.barcode_value is
  'Exact scanned ID value. Private; only administrator and authorized class-teacher RPCs may return it. NULL for earlier hash-only credentials.';

create table private.barcode_retake_grants (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid not null references public.profiles(id) on delete restrict,
  granted_at timestamptz not null default now(),
  note text check(note is null or char_length(note)<=500)
);
create index barcode_retake_grants_granter_idx on private.barcode_retake_grants(granted_by);
alter table private.barcode_retake_grants enable row level security;
create policy barcode_retake_grants_deny_clients on private.barcode_retake_grants
  for all to public using(false) with check(false);
revoke all on private.barcode_retake_grants from public,anon,authenticated;
grant all on private.barcode_retake_grants to service_role;

-- All old public registration signatures still delegate here. Lock initial
-- registration as well, so repeating a legacy RPC cannot bypass retake approval.
alter function private.complete_student_registration_impl(text,text,text)
  rename to complete_student_registration_initial_impl;
revoke all on function private.complete_student_registration_initial_impl(text,text,text) from public,anon,authenticated;
create function private.complete_student_registration_impl(p_full_name text,p_raw_barcode text,p_guardian_email text)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
begin
  if v_actor is null or private.current_profile_role() is distinct from 'student'::public.app_role then
    raise exception 'Only a signed-in student can complete student registration' using errcode='42501'; end if;
  perform 1 from public.profiles where id=v_actor for update;
  if exists(select 1 from private.student_credentials where student_id=v_actor)
    or exists(select 1 from public.student_profiles where user_id=v_actor and registration_completed_at is not null) then
    raise exception 'Student ID registration is complete. Ask an administrator to approve a barcode retake.' using errcode='42501'; end if;
  perform private.complete_student_registration_initial_impl(p_full_name,p_raw_barcode,p_guardian_email);
  update private.student_credentials set barcode_value=btrim(p_raw_barcode) where student_id=v_actor;
end; $$;
revoke all on function private.complete_student_registration_impl(text,text,text) from public,anon,authenticated;
grant execute on function private.complete_student_registration_impl(text,text,text) to authenticated;

-- Recreate every delegating body after the rename as well, invalidating old
-- cached SQL-function plans that may have referenced the original helper OID.
create or replace function public.complete_student_registration(p_full_name text,p_raw_barcode text,p_guardian_email text default null)
returns void language sql security invoker set search_path='' as $$
  select private.complete_student_registration_impl(p_full_name,p_raw_barcode,p_guardian_email)
$$;
create or replace function private.complete_student_registration_impl(p_first_name text,p_last_name text,p_raw_barcode text,p_guardian_email text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.validate_structured_names(p_first_name,p_last_name);
  perform private.complete_student_registration_impl(btrim(p_first_name)||' '||btrim(p_last_name),p_raw_barcode,p_guardian_email);
  update public.profiles set first_name=p_first_name,last_name=p_last_name where id=(select auth.uid());
end; $$;
create or replace function public.complete_student_registration(p_first_name text,p_last_name text,p_raw_barcode text,p_guardian_email text)
returns void language sql security invoker set search_path='' as $$
  select private.complete_student_registration_impl(p_first_name,p_last_name,p_raw_barcode,p_guardian_email)
$$;

create function private.admin_grant_barcode_retake_impl(p_student_id uuid,p_note text)
returns void language plpgsql security definer set search_path='' as $$
declare v_note text:=nullif(private.uppercase_human_text(btrim(p_note)),'');
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'admin'::public.app_role then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  if char_length(v_note)>500 then raise exception 'The reason must contain at most 500 characters' using errcode='22023'; end if;
  perform 1 from public.profiles where id=p_student_id and role='student' for update;
  if not found then raise exception 'Student not found' using errcode='P0002'; end if;
  if not exists(select 1 from private.student_credentials where student_id=p_student_id)
    or not exists(select 1 from public.student_profiles where user_id=p_student_id and registration_completed_at is not null) then
    raise exception 'This student must complete their initial school ID registration first' using errcode='22023'; end if;
  insert into private.barcode_retake_grants(student_id,granted_by,note)
    values(p_student_id,(select auth.uid()),v_note)
    on conflict(student_id) do update set granted_by=excluded.granted_by,granted_at=now(),note=excluded.note;
  -- Reuse the existing per-user invalidation channel. No ID values are sent.
  update public.profiles set updated_at=now() where id=p_student_id;
end; $$;
create function public.admin_grant_barcode_retake(p_student_id uuid,p_note text default null)
returns void language sql security invoker set search_path='' as $$
  select private.admin_grant_barcode_retake_impl(p_student_id,p_note)
$$;

create function private.my_barcode_registration_access_impl()
returns table(is_registered boolean,can_retake boolean,granted_at timestamptz,registered_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'student'::public.app_role then
    raise exception 'Student access required' using errcode='42501'; end if;
  return query select c.student_id is not null,g.student_id is not null,g.granted_at,c.updated_at
    from(select 1) seed
    left join private.student_credentials c on c.student_id=(select auth.uid())
    left join private.barcode_retake_grants g on g.student_id=(select auth.uid());
end; $$;
create function public.my_barcode_registration_access()
returns table(is_registered boolean,can_retake boolean,granted_at timestamptz,registered_at timestamptz)
language sql stable security invoker set search_path='' as $$ select * from private.my_barcode_registration_access_impl() $$;

create function private.replace_student_barcode_impl(p_raw_barcode text,p_expected_student_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_barcode text:=btrim(p_raw_barcode);
begin
  if v_actor is null or p_expected_student_id is null or v_actor is distinct from p_expected_student_id
    or private.current_profile_role() is distinct from 'student'::public.app_role then
    raise exception 'Your student account changed. Open school ID settings again before rescanning.' using errcode='42501'; end if;
  perform 1 from public.profiles where id=v_actor for update;
  if not exists(select 1 from private.barcode_retake_grants where student_id=v_actor) then
    raise exception 'Ask an administrator to approve one barcode retake before rescanning your school ID.' using errcode='42501'; end if;
  if not exists(select 1 from public.student_profiles where user_id=v_actor and registration_completed_at is not null)
    or not exists(select 1 from private.student_credentials where student_id=v_actor) then
    raise exception 'Complete your initial school ID registration first' using errcode='22023'; end if;
  if v_barcode is null or char_length(v_barcode) not between 4 and 256 or v_barcode~'[[:cntrl:]]' then
    raise exception 'The scanned student ID barcode is invalid' using errcode='22023'; end if;
  begin
    update private.student_credentials
      set barcode_hash=encode(extensions.digest(v_barcode,'sha256'),'hex'),barcode_value=v_barcode where student_id=v_actor;
  exception when unique_violation then
    raise exception 'This student ID barcode is already registered to another student.' using errcode='22023';
  end;
  delete from private.barcode_retake_grants where student_id=v_actor;
  update public.profiles set updated_at=now() where id=v_actor;
end; $$;
create function public.replace_student_barcode(p_raw_barcode text,p_expected_student_id uuid)
returns void language sql security invoker set search_path='' as $$
  select private.replace_student_barcode_impl(p_raw_barcode,p_expected_student_id)
$$;

create function private.admin_student_barcode_registrations_impl()
returns table(student_id uuid,full_name text,email text,is_registered boolean,can_retake boolean,
  granted_at timestamptz,registered_at timestamptz,barcode_value text)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'admin'::public.app_role then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  return query select p.id,p.full_name,p.email,c.student_id is not null,g.student_id is not null,
    g.granted_at,c.updated_at,c.barcode_value
    from public.profiles p left join private.student_credentials c on c.student_id=p.id
    left join private.barcode_retake_grants g on g.student_id=p.id
    where p.role='student' order by p.last_name,p.first_name,p.id;
end; $$;
create function public.admin_student_barcode_registrations()
returns table(student_id uuid,full_name text,email text,is_registered boolean,can_retake boolean,
  granted_at timestamptz,registered_at timestamptz,barcode_value text)
language sql stable security invoker set search_path='' as $$ select * from private.admin_student_barcode_registrations_impl() $$;

create function private.class_student_barcode_values_impl(p_class_id uuid)
returns table(student_id uuid,barcode_value text)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or (private.current_profile_role() is distinct from 'admin'::public.app_role
    and not private.teacher_owns_class(p_class_id)) then
    raise exception 'Only this class teacher or an administrator can view student ID values.' using errcode='42501'; end if;
  if not exists(select 1 from public.classes where id=p_class_id) then raise exception 'Class not found' using errcode='P0002'; end if;
  return query with roster as(
    select e.student_id from public.class_enrollments e where e.class_id=p_class_id
    union select a.student_id from public.attendance_records a join public.meetings m on m.id=a.meeting_id where m.class_id=p_class_id
  )
  select r.student_id,c.barcode_value from roster r join public.profiles p on p.id=r.student_id and p.role='student'
    left join private.student_credentials c on c.student_id=r.student_id;
end; $$;
create function public.class_student_barcode_values(p_class_id uuid)
returns table(student_id uuid,barcode_value text)
language sql stable security invoker set search_path='' as $$ select * from private.class_student_barcode_values_impl(p_class_id) $$;

revoke all on function private.admin_grant_barcode_retake_impl(uuid,text),public.admin_grant_barcode_retake(uuid,text),
  private.my_barcode_registration_access_impl(),public.my_barcode_registration_access(),
  private.replace_student_barcode_impl(text,uuid),public.replace_student_barcode(text,uuid),
  private.admin_student_barcode_registrations_impl(),public.admin_student_barcode_registrations(),
  private.class_student_barcode_values_impl(uuid),public.class_student_barcode_values(uuid)
  from public,anon,authenticated;
grant execute on function private.admin_grant_barcode_retake_impl(uuid,text),public.admin_grant_barcode_retake(uuid,text),
  private.my_barcode_registration_access_impl(),public.my_barcode_registration_access(),
  private.replace_student_barcode_impl(text,uuid),public.replace_student_barcode(text,uuid),
  private.admin_student_barcode_registrations_impl(),public.admin_student_barcode_registrations(),
  private.class_student_barcode_values_impl(uuid),public.class_student_barcode_values(uuid) to authenticated;
