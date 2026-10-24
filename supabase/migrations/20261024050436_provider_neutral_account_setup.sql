-- Provider-neutral, single-use account setup. Existing role assignments and
-- teacher approval decisions remain intact. Authorization never trusts JWT
-- user_metadata or an arbitrary role update from the browser.
alter table public.profiles add column onboarding_completed_at timestamptz;

update public.profiles set onboarding_completed_at = created_at;

-- Earlier social registration silently assigned student. Let untouched social
-- accounts choose their actual role without changing any established student.
update public.profiles p
set onboarding_completed_at = null
where p.role = 'student'
  and exists (
    select 1 from auth.users u
    where u.id = p.id
      and (
        u.raw_app_meta_data ->> 'provider' in ('google', 'facebook')
        or u.raw_app_meta_data -> 'providers' ?| array['google', 'facebook']
      )
  )
  and not exists (select 1 from public.student_profiles sp where sp.user_id = p.id)
  and not exists (select 1 from public.class_enrollments ce where ce.student_id = p.id)
  and not exists (select 1 from public.attendance_records ar where ar.student_id = p.id)
  and not exists (select 1 from public.student_tasks st where st.student_id = p.id)
  and not exists (select 1 from public.student_task_categories sc where sc.student_id = p.id);

comment on column public.profiles.onboarding_completed_at is
  'One-time provider-neutral setup completion. Only trusted functions can assign roles or complete setup.';

create or replace function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(new.email));
  v_full_name text := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'User'
  );
begin
  insert into public.profiles (id, role, full_name, email, onboarding_completed_at)
  values (new.id, 'student', v_full_name, v_email, null)
  on conflict (id) do update set email = excluded.email;

  if new.email_confirmed_at is not null
     and exists (select 1 from public.profiles p where p.id = new.id and p.role = 'parent') then
    perform private.link_parent_by_verified_email(new.id, v_email);
  end if;
  return new;
end;
$$;

create or replace function private.protect_profile_authorization_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (
    new.role is distinct from old.role
    or new.id is distinct from old.id
    or new.teacher_approval_status is distinct from old.teacher_approval_status
    or new.teacher_approval_note is distinct from old.teacher_approval_note
    or new.teacher_approved_by is distinct from old.teacher_approved_by
    or new.teacher_approved_at is distinct from old.teacher_approved_at
    or new.onboarding_completed_at is distinct from old.onboarding_completed_at
  ) and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Profile authorization fields cannot be changed directly' using errcode = '42501';
  end if;
  if new.email is distinct from old.email
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Profile email is synchronized from Supabase Auth' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function private.complete_account_setup_impl(p_full_name text, p_role text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_name text := btrim(p_full_name);
  v_role text := lower(btrim(p_role));
  v_profile public.profiles%rowtype;
begin
  if v_actor is null then
    raise exception 'Sign in before completing account setup' using errcode = '42501';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 120 then
    raise exception 'Full name must contain between 2 and 120 characters' using errcode = '22023';
  end if;
  if v_role is null or v_role not in ('student', 'teacher', 'parent') then
    raise exception 'Choose student, teacher, or parent' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = v_actor and u.email_confirmed_at is not null) then
    raise exception 'Confirm your email before completing account setup' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where id = v_actor for update;
  if not found then
    raise exception 'Account profile not found' using errcode = 'P0002';
  end if;
  if v_profile.onboarding_completed_at is not null or v_profile.role <> 'student' then
    raise exception 'Account setup is already complete. Contact the administrator to change roles.' using errcode = '42501';
  end if;
  if v_role <> 'student' and (
    exists (select 1 from public.student_profiles sp where sp.user_id = v_actor)
    or exists (select 1 from public.class_enrollments ce where ce.student_id = v_actor)
    or exists (select 1 from public.attendance_records ar where ar.student_id = v_actor)
    or exists (select 1 from public.student_tasks st where st.student_id = v_actor)
    or exists (select 1 from public.student_task_categories sc where sc.student_id = v_actor)
  ) then
    raise exception 'This account already has student records. Contact the administrator to change roles.' using errcode = '42501';
  end if;

  update public.profiles
  set full_name = v_name,
      role = v_role::public.app_role,
      teacher_approval_status = case when v_role = 'teacher' then 'pending'::public.teacher_approval_status else null end,
      teacher_approval_note = null,
      teacher_approved_by = null,
      teacher_approved_at = null,
      onboarding_completed_at = now()
  where id = v_actor
  returning * into v_profile;
  return v_profile;
end;
$$;

create function public.complete_account_setup(p_full_name text, p_role text)
returns public.profiles
language sql
security invoker
set search_path = ''
as $$
  select private.complete_account_setup_impl(p_full_name, p_role);
$$;

revoke all on function private.complete_account_setup_impl(text, text) from public, anon, authenticated;
grant execute on function private.complete_account_setup_impl(text, text) to authenticated;
revoke all on function public.complete_account_setup(text, text) from public, anon, authenticated;
grant execute on function public.complete_account_setup(text, text) to authenticated;
