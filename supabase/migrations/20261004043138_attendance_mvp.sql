-- School attendance MVP for Ionic/Vue and Supabase.
-- All client-facing privileged operations are SECURITY INVOKER wrappers in
-- public. The small SECURITY DEFINER implementation/helper functions live in
-- the unexposed private schema, pin search_path, and bind authorization to
-- auth.uid().

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;

alter default privileges in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges in schema private
  revoke execute on functions from public, anon, authenticated;

create type public.app_role as enum ('teacher', 'student', 'parent');
create type public.attendance_mode as enum (
  'teacher_manual',
  'self_on_site',
  'self_event',
  'self_online'
);
create type public.attendance_status as enum ('present', 'absent');
create type public.attendance_source as enum ('teacher', 'self_check');
create type public.attendance_verification_status as enum ('pending', 'approved', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null default 'student',
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  email text not null check (email = lower(btrim(email)) and position('@' in email) > 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on column public.profiles.role is
  'Authorization role. Self-signup can create student or parent only; teacher is provisioned by a trusted service-role/admin workflow.';

create table public.student_profiles (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  guardian_email text check (
    guardian_email is null
    or (guardian_email = lower(btrim(guardian_email)) and position('@' in guardian_email) > 1)
  ),
  registration_completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.student_profiles is
  'Non-secret student onboarding data. Barcode material is stored only as a SHA-256 hash in private.student_credentials.';

create table public.guardian_links (
  parent_id uuid not null references public.profiles (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  verified_guardian_email text not null,
  created_at timestamptz not null default now(),
  primary key (parent_id, student_id),
  constraint guardian_links_different_users check (parent_id <> student_id)
);

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.profiles (id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  section text check (section is null or char_length(btrim(section)) between 1 and 80),
  join_code text not null unique check (join_code = upper(btrim(join_code)) and char_length(join_code) between 6 and 16),
  timezone text not null default 'Asia/Manila' check (char_length(btrim(timezone)) between 1 and 64),
  default_latitude double precision check (default_latitude between -90 and 90),
  default_longitude double precision check (default_longitude between -180 and 180),
  default_radius_m double precision not null default 100 check (default_radius_m > 0 and default_radius_m <= 10000),
  default_max_accuracy_m double precision not null default 100 check (default_max_accuracy_m > 0 and default_max_accuracy_m <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint classes_default_location_pair check (
    (default_latitude is null) = (default_longitude is null)
  )
);

create table public.class_enrollments (
  class_id uuid not null references public.classes (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

create table public.class_schedules (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  room text check (room is null or char_length(btrim(room)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_schedules_time_order check (ends_at > starts_at)
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes (id) on delete cascade,
  schedule_id uuid references public.class_schedules (id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  meeting_date date not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  attendance_mode public.attendance_mode not null default 'teacher_manual',
  attendance_enabled boolean not null default true,
  attendance_opens_at timestamptz not null,
  attendance_closes_at timestamptz not null,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  radius_m double precision not null default 100 check (radius_m > 0 and radius_m <= 10000),
  max_accuracy_m double precision not null default 100 check (max_accuracy_m > 0 and max_accuracy_m <= 5000),
  created_by uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meetings_time_order check (ends_at > starts_at),
  constraint meetings_attendance_window_order check (attendance_closes_at > attendance_opens_at),
  constraint meetings_location_pair check ((latitude is null) = (longitude is null)),
  constraint meetings_location_required_for_physical_self_check check (
    attendance_mode not in ('self_on_site', 'self_event')
    or (latitude is not null and longitude is not null)
  )
);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  student_id uuid not null references public.profiles (id) on delete cascade,
  status public.attendance_status not null,
  source public.attendance_source not null,
  selfie_path text,
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  accuracy_m double precision check (accuracy_m is null or accuracy_m >= 0),
  distance_m double precision check (distance_m is null or distance_m >= 0),
  barcode_verified boolean not null default false,
  recorded_by uuid not null references public.profiles (id) on delete restrict,
  teacher_note text check (teacher_note is null or char_length(teacher_note) <= 1000),
  verification_status public.attendance_verification_status,
  reviewed_by uuid references public.profiles (id) on delete restrict,
  reviewed_at timestamptz,
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, student_id),
  constraint attendance_records_location_pair check ((latitude is null) = (longitude is null)),
  constraint attendance_records_self_check_evidence check (
    source <> 'self_check'
    or selfie_path is not null
  ),
  constraint attendance_records_verification_consistency check (
    (source = 'teacher' and verification_status is null and reviewed_by is null and reviewed_at is null)
    or
    (
      source = 'self_check'
      and verification_status is not null
      and (
        (verification_status in ('pending', 'approved') and status = 'present')
        or (verification_status = 'rejected' and status = 'absent')
      )
      and (
        (verification_status = 'pending' and reviewed_by is null and reviewed_at is null)
        or (verification_status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
      )
    )
  )
);

create table private.student_credentials (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  barcode_hash text not null unique check (barcode_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.student_credentials enable row level security;

-- Explicit deny policy documents that clients never read or write barcode
-- hashes directly. Trusted definer functions and service_role bypass RLS.
create policy student_credentials_deny_clients
on private.student_credentials
for all
to public
using (false)
with check (false);

-- Foreign keys are not indexed automatically by PostgreSQL.
create index profiles_parent_email_idx on public.profiles (email) where role = 'parent';
create index student_profiles_guardian_email_idx on public.student_profiles (guardian_email) where guardian_email is not null;
create index guardian_links_student_id_idx on public.guardian_links (student_id);
create index classes_teacher_id_idx on public.classes (teacher_id);
create index class_enrollments_student_id_idx on public.class_enrollments (student_id);
create index class_enrollments_active_class_idx on public.class_enrollments (class_id, student_id) where is_active;
create index class_enrollments_active_student_idx on public.class_enrollments (student_id, class_id) where is_active;
create index class_schedules_class_id_idx on public.class_schedules (class_id);
create index class_schedules_active_day_idx on public.class_schedules (class_id, day_of_week) where is_active;
create index meetings_class_id_idx on public.meetings (class_id);
create index meetings_schedule_id_idx on public.meetings (schedule_id) where schedule_id is not null;
create index meetings_created_by_idx on public.meetings (created_by);
create index meetings_class_date_idx on public.meetings (class_id, meeting_date);
create index meetings_open_self_check_idx on public.meetings (attendance_opens_at, attendance_closes_at)
  where attendance_enabled and attendance_mode <> 'teacher_manual';
create index attendance_records_student_id_idx on public.attendance_records (student_id);
create index attendance_records_recorded_by_idx on public.attendance_records (recorded_by);
create index attendance_records_reviewed_by_idx on public.attendance_records (reviewed_by) where reviewed_by is not null;
create index attendance_records_student_submitted_idx on public.attendance_records (student_id, submitted_at desc);
create index attendance_records_pending_review_idx on public.attendance_records (meeting_id, submitted_at)
  where verification_status = 'pending';

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger student_profiles_set_updated_at
before update on public.student_profiles
for each row execute function private.set_updated_at();

create trigger classes_set_updated_at
before update on public.classes
for each row execute function private.set_updated_at();

create trigger class_enrollments_set_updated_at
before update on public.class_enrollments
for each row execute function private.set_updated_at();

create trigger class_schedules_set_updated_at
before update on public.class_schedules
for each row execute function private.set_updated_at();

create trigger meetings_set_updated_at
before update on public.meetings
for each row execute function private.set_updated_at();

create trigger attendance_records_set_updated_at
before update on public.attendance_records
for each row execute function private.set_updated_at();

create trigger student_credentials_set_updated_at
before update on private.student_credentials
for each row execute function private.set_updated_at();

create function private.protect_profile_authorization_fields()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (new.role is distinct from old.role or new.id is distinct from old.id)
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'profile authorization fields cannot be changed by this role'
      using errcode = '42501';
  end if;

  if new.email is distinct from old.email
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'profile email is synchronized from Supabase Auth'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_protect_authorization_fields
before update on public.profiles
for each row execute function private.protect_profile_authorization_fields();

-- Internal guardian-linking helpers are trigger/RPC implementation details.
-- They are never granted to client roles.
create function private.link_parent_by_verified_email(
  p_parent_id uuid,
  p_verified_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_verified_email));
begin
  if not exists (
    select 1
    from auth.users au
    join public.profiles p on p.id = au.id
    where au.id = p_parent_id
      and au.email_confirmed_at is not null
      and lower(au.email) = v_email
      and p.role = 'parent'
  ) then
    return;
  end if;

  delete from public.guardian_links gl
  where gl.parent_id = p_parent_id
    and gl.verified_guardian_email <> v_email;

  insert into public.guardian_links (
    parent_id,
    student_id,
    verified_guardian_email
  )
  select
    p_parent_id,
    sp.user_id,
    v_email
  from public.student_profiles sp
  join public.profiles student on student.id = sp.user_id and student.role = 'student'
  where sp.guardian_email = v_email
  on conflict (parent_id, student_id) do update
    set verified_guardian_email = excluded.verified_guardian_email;
end;
$$;

create function private.link_guardians_for_student(
  p_student_id uuid,
  p_guardian_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(p_guardian_email)), '');
begin
  delete from public.guardian_links gl
  where gl.student_id = p_student_id
    and (v_email is null or gl.verified_guardian_email <> v_email);

  if v_email is null then
    return;
  end if;

  insert into public.guardian_links (
    parent_id,
    student_id,
    verified_guardian_email
  )
  select
    parent_profile.id,
    p_student_id,
    v_email
  from auth.users au
  join public.profiles parent_profile
    on parent_profile.id = au.id
   and parent_profile.role = 'parent'
  where au.email_confirmed_at is not null
    and lower(au.email) = v_email
  on conflict (parent_id, student_id) do update
    set verified_guardian_email = excluded.verified_guardian_email;
end;
$$;

create function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_full_name text;
  v_signup_role public.app_role;
begin
  v_email := lower(btrim(new.email));
  v_full_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'User'
  );

  -- raw_user_meta_data is user-editable. It may select parent/student UX, but
  -- it can never grant the trusted teacher role.
  v_signup_role := case
    when new.raw_user_meta_data ->> 'role' = 'parent' then 'parent'::public.app_role
    else 'student'::public.app_role
  end;

  insert into public.profiles (id, role, full_name, email)
  values (new.id, v_signup_role, v_full_name, v_email)
  on conflict (id) do update
    set email = excluded.email;

  if new.email_confirmed_at is not null
     and exists (
       select 1 from public.profiles p
       where p.id = new.id and p.role = 'parent'
     ) then
    perform private.link_parent_by_verified_email(new.id, v_email);
  end if;

  return new;
end;
$$;

create trigger auth_users_sync_profile
after insert or update of email, email_confirmed_at, raw_user_meta_data on auth.users
for each row execute function private.handle_auth_user_change();

create function private.sync_guardian_links_after_profile_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.role = 'parent' then
    perform private.link_parent_by_verified_email(new.id, new.email);
  elsif old.role = 'parent' and new.role <> 'parent' then
    delete from public.guardian_links where parent_id = new.id;
  end if;
  return new;
end;
$$;

create trigger profiles_sync_guardian_links_after_role_change
after update of role on public.profiles
for each row
when (old.role is distinct from new.role)
execute function private.sync_guardian_links_after_profile_role_change();

-- Authorization helpers used by RLS. Every callable helper derives the actor
-- from auth.uid(); callers cannot supply an alternate user id.
create function private.current_profile_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
$$;

create function private.teacher_owns_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.classes c
      join public.profiles p on p.id = c.teacher_id and p.role = 'teacher'
      where c.id = p_class_id
        and c.teacher_id = (select auth.uid())
    )
$$;

create function private.student_in_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.class_enrollments ce
      join public.profiles p on p.id = ce.student_id and p.role = 'student'
      where ce.class_id = p_class_id
        and ce.student_id = (select auth.uid())
        and ce.is_active
    )
$$;

create function private.parent_has_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.guardian_links gl
      join public.profiles p on p.id = gl.parent_id and p.role = 'parent'
      where gl.parent_id = (select auth.uid())
        and gl.student_id = p_student_id
    )
$$;

create function private.teacher_has_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and exists (
      select 1
      from public.class_enrollments ce
      join public.classes c on c.id = ce.class_id
      where ce.student_id = p_student_id
        and ce.is_active
        and c.teacher_id = (select auth.uid())
    )
$$;

create function private.can_access_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1 from public.classes c
        where c.id = p_class_id and c.teacher_id = (select auth.uid())
      )
      or exists (
        select 1 from public.class_enrollments ce
        where ce.class_id = p_class_id
          and ce.student_id = (select auth.uid())
          and ce.is_active
      )
      or exists (
        select 1
        from public.guardian_links gl
        join public.class_enrollments ce
          on ce.student_id = gl.student_id
         and ce.class_id = p_class_id
         and ce.is_active
        where gl.parent_id = (select auth.uid())
      )
    )
$$;

create function private.can_view_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      p_profile_id = (select auth.uid())
      or exists (
        select 1
        from public.class_enrollments ce
        join public.classes c on c.id = ce.class_id
        where ce.is_active
          and (
            (c.teacher_id = (select auth.uid()) and ce.student_id = p_profile_id)
            or (ce.student_id = (select auth.uid()) and c.teacher_id = p_profile_id)
          )
      )
      or exists (
        select 1
        from public.guardian_links gl
        where gl.parent_id = (select auth.uid())
          and gl.student_id = p_profile_id
      )
    )
$$;

create function private.can_access_attendance(
  p_meeting_id uuid,
  p_student_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      p_student_id = (select auth.uid())
      or exists (
        select 1
        from public.meetings m
        join public.classes c on c.id = m.class_id
        where m.id = p_meeting_id
          and c.teacher_id = (select auth.uid())
      )
      or exists (
        select 1
        from public.guardian_links gl
        where gl.parent_id = (select auth.uid())
          and gl.student_id = p_student_id
      )
    )
$$;

create function private.distance_m(
  p_latitude_a double precision,
  p_longitude_a double precision,
  p_latitude_b double precision,
  p_longitude_b double precision
)
returns double precision
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select 12742000.0 * asin(
    sqrt(
      least(
        1.0,
        power(sin(radians(p_latitude_b - p_latitude_a) / 2.0), 2)
        + cos(radians(p_latitude_a))
        * cos(radians(p_latitude_b))
        * power(sin(radians(p_longitude_b - p_longitude_a) / 2.0), 2)
      )
    )
  )
$$;

alter table public.profiles enable row level security;
alter table public.student_profiles enable row level security;
alter table public.guardian_links enable row level security;
alter table public.classes enable row level security;
alter table public.class_enrollments enable row level security;
alter table public.class_schedules enable row level security;
alter table public.meetings enable row level security;
alter table public.attendance_records enable row level security;

create policy profiles_select_authorized
on public.profiles
for select
to authenticated
using ((select private.can_view_profile(id)));

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy student_profiles_select_authorized
on public.student_profiles
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or (select private.teacher_has_student(user_id))
  or (select private.parent_has_student(user_id))
);

create policy guardian_links_select_participants
on public.guardian_links
for select
to authenticated
using (
  (select auth.uid()) = parent_id
  or (select auth.uid()) = student_id
);

create policy classes_select_members
on public.classes
for select
to authenticated
using ((select private.can_access_class(id)));

create policy classes_update_owner
on public.classes
for update
to authenticated
using ((select private.teacher_owns_class(id)))
with check (teacher_id = (select auth.uid()) and (select private.teacher_owns_class(id)));

create policy classes_delete_owner
on public.classes
for delete
to authenticated
using ((select private.teacher_owns_class(id)));

create policy class_enrollments_select_authorized
on public.class_enrollments
for select
to authenticated
using (
  student_id = (select auth.uid())
  or (select private.teacher_owns_class(class_id))
  or (select private.parent_has_student(student_id))
);

create policy class_enrollments_update_teacher
on public.class_enrollments
for update
to authenticated
using ((select private.teacher_owns_class(class_id)))
with check ((select private.teacher_owns_class(class_id)));

create policy class_enrollments_delete_teacher
on public.class_enrollments
for delete
to authenticated
using ((select private.teacher_owns_class(class_id)));

create policy class_schedules_select_members
on public.class_schedules
for select
to authenticated
using ((select private.can_access_class(class_id)));

create policy class_schedules_insert_teacher
on public.class_schedules
for insert
to authenticated
with check ((select private.teacher_owns_class(class_id)));

create policy class_schedules_update_teacher
on public.class_schedules
for update
to authenticated
using ((select private.teacher_owns_class(class_id)))
with check ((select private.teacher_owns_class(class_id)));

create policy class_schedules_delete_teacher
on public.class_schedules
for delete
to authenticated
using ((select private.teacher_owns_class(class_id)));

create policy meetings_select_members
on public.meetings
for select
to authenticated
using ((select private.can_access_class(class_id)));

create policy meetings_insert_teacher
on public.meetings
for insert
to authenticated
with check (
  created_by = (select auth.uid())
  and (select private.teacher_owns_class(class_id))
);

create policy meetings_update_teacher
on public.meetings
for update
to authenticated
using ((select private.teacher_owns_class(class_id)))
with check (
  created_by = (select auth.uid())
  and (select private.teacher_owns_class(class_id))
);

create policy meetings_delete_teacher
on public.meetings
for delete
to authenticated
using ((select private.teacher_owns_class(class_id)));

create policy attendance_records_select_authorized
on public.attendance_records
for select
to authenticated
using ((select private.can_access_attendance(meeting_id, student_id)));

-- No anonymous access and no broad authenticated writes. Table grants and RLS
-- are deliberately both explicit; RPCs own privileged writes.
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.student_profiles from anon, authenticated;
revoke all on table public.guardian_links from anon, authenticated;
revoke all on table public.classes from anon, authenticated;
revoke all on table public.class_enrollments from anon, authenticated;
revoke all on table public.class_schedules from anon, authenticated;
revoke all on table public.meetings from anon, authenticated;
revoke all on table public.attendance_records from anon, authenticated;

grant select on table public.profiles to authenticated;
grant update (full_name) on table public.profiles to authenticated;
grant select on table public.student_profiles to authenticated;
grant select on table public.guardian_links to authenticated;
grant select on table public.classes to authenticated;
grant update (
  name,
  section,
  timezone,
  default_latitude,
  default_longitude,
  default_radius_m,
  default_max_accuracy_m
) on table public.classes to authenticated;
grant delete on table public.classes to authenticated;
grant select on table public.class_enrollments to authenticated;
grant update (is_active) on table public.class_enrollments to authenticated;
grant delete on table public.class_enrollments to authenticated;
grant select, insert, update, delete on table public.class_schedules to authenticated;
grant select, insert, update, delete on table public.meetings to authenticated;
grant select on table public.attendance_records to authenticated;

grant all on table public.profiles to service_role;
grant all on table public.student_profiles to service_role;
grant all on table public.guardian_links to service_role;
grant all on table public.classes to service_role;
grant all on table public.class_enrollments to service_role;
grant all on table public.class_schedules to service_role;
grant all on table public.meetings to service_role;
grant all on table public.attendance_records to service_role;

grant usage on type public.app_role to authenticated, service_role;
grant usage on type public.attendance_mode to authenticated, service_role;
grant usage on type public.attendance_status to authenticated, service_role;
grant usage on type public.attendance_source to authenticated, service_role;
grant usage on type public.attendance_verification_status to authenticated, service_role;

-- Authenticated needs schema usage only so public SECURITY INVOKER wrappers and
-- RLS policies can call the explicitly granted, identity-bound helpers. The
-- private schema is not exposed through the Data API.
grant usage on schema private to authenticated;
grant execute on function private.current_profile_role() to authenticated;
grant execute on function private.teacher_owns_class(uuid) to authenticated;
grant execute on function private.student_in_class(uuid) to authenticated;
grant execute on function private.parent_has_student(uuid) to authenticated;
grant execute on function private.teacher_has_student(uuid) to authenticated;
grant execute on function private.can_access_class(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;
grant execute on function private.can_access_attendance(uuid, uuid) to authenticated;
grant execute on function private.distance_m(double precision, double precision, double precision, double precision) to authenticated;

-- Privileged write implementations. These live outside the exposed public
-- schema, pin search_path, and always derive the actor from auth.uid().
create function private.complete_student_registration_impl(
  p_full_name text,
  p_raw_barcode text,
  p_guardian_email text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_barcode text := btrim(p_raw_barcode);
  v_guardian_email text := nullif(lower(btrim(p_guardian_email)), '');
begin
  if v_actor is null or private.current_profile_role() <> 'student' then
    raise exception 'Only a signed-in student can complete student registration'
      using errcode = '42501';
  end if;

  if char_length(btrim(p_full_name)) not between 2 and 120 then
    raise exception 'Enter a valid student full name' using errcode = '22023';
  end if;

  if v_barcode !~ '^[A-Za-z0-9._/-]{4,64}$' then
    raise exception 'The scanned student ID barcode is invalid' using errcode = '22023';
  end if;

  if v_guardian_email is not null
     and (position('@' in v_guardian_email) <= 1 or char_length(v_guardian_email) > 320) then
    raise exception 'Enter a valid parent or guardian email' using errcode = '22023';
  end if;

  update public.profiles
  set full_name = btrim(p_full_name)
  where id = v_actor;

  insert into public.student_profiles (
    user_id,
    guardian_email,
    registration_completed_at
  )
  values (v_actor, v_guardian_email, now())
  on conflict (user_id) do update
    set guardian_email = excluded.guardian_email,
        registration_completed_at = now();

  insert into private.student_credentials (student_id, barcode_hash)
  values (
    v_actor,
    encode(extensions.digest(v_barcode, 'sha256'), 'hex')
  )
  on conflict (student_id) do update
    set barcode_hash = excluded.barcode_hash;

  perform private.link_guardians_for_student(v_actor, v_guardian_email);
end;
$$;

create function private.create_class_impl(
  p_name text,
  p_section text,
  p_timezone text,
  p_default_latitude double precision,
  p_default_longitude double precision,
  p_default_radius_m double precision,
  p_default_max_accuracy_m double precision
)
returns public.classes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_code text;
  v_class public.classes%rowtype;
  v_attempt smallint := 0;
begin
  if v_actor is null or private.current_profile_role() <> 'teacher' then
    raise exception 'Only a teacher can create a class' using errcode = '42501';
  end if;

  if char_length(btrim(p_name)) not between 1 and 120 then
    raise exception 'Enter a valid class name' using errcode = '22023';
  end if;

  if (p_default_latitude is null) <> (p_default_longitude is null) then
    raise exception 'Latitude and longitude must be supplied together' using errcode = '22023';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists (select 1 from public.classes c where c.join_code = v_code);
    if v_attempt >= 10 then
      raise exception 'Unable to generate a unique class code';
    end if;
  end loop;

  insert into public.classes (
    teacher_id,
    name,
    section,
    join_code,
    timezone,
    default_latitude,
    default_longitude,
    default_radius_m,
    default_max_accuracy_m
  )
  values (
    v_actor,
    btrim(p_name),
    nullif(btrim(p_section), ''),
    v_code,
    coalesce(nullif(btrim(p_timezone), ''), 'Asia/Manila'),
    p_default_latitude,
    p_default_longitude,
    coalesce(p_default_radius_m, 100),
    coalesce(p_default_max_accuracy_m, 100)
  )
  returning * into v_class;

  return v_class;
end;
$$;

create function private.join_class_impl(p_join_code text)
returns public.classes
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_class public.classes%rowtype;
begin
  if v_actor is null or private.current_profile_role() <> 'student' then
    raise exception 'Only a student can join a class' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.student_profiles sp where sp.user_id = v_actor
  ) then
    raise exception 'Complete student registration before joining a class'
      using errcode = '42501';
  end if;

  select c.* into v_class
  from public.classes c
  where c.join_code = upper(btrim(p_join_code));

  if not found then
    raise exception 'Class code not found' using errcode = 'P0002';
  end if;

  insert into public.class_enrollments (class_id, student_id, is_active)
  values (v_class.id, v_actor, true)
  on conflict (class_id, student_id) do update
    set is_active = true;

  return v_class;
end;
$$;

create function private.record_manual_attendance_impl(
  p_meeting_id uuid,
  p_student_id uuid,
  p_status public.attendance_status,
  p_note text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_class_id uuid;
  v_enabled boolean;
  v_record public.attendance_records%rowtype;
begin
  select m.class_id, m.attendance_enabled
  into v_class_id, v_enabled
  from public.meetings m
  where m.id = p_meeting_id;

  if not found then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;

  if v_actor is null or not private.teacher_owns_class(v_class_id) then
    raise exception 'Only this class teacher can record attendance'
      using errcode = '42501';
  end if;

  if not v_enabled then
    raise exception 'Attendance is disabled for this meeting' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.class_enrollments ce
    join public.profiles p on p.id = ce.student_id and p.role = 'student'
    where ce.class_id = v_class_id
      and ce.student_id = p_student_id
      and ce.is_active
  ) then
    raise exception 'The student is not actively enrolled in this class'
      using errcode = '42501';
  end if;

  insert into public.attendance_records (
    meeting_id,
    student_id,
    status,
    source,
    recorded_by,
    teacher_note,
    verification_status,
    reviewed_by,
    reviewed_at,
    review_note
  )
  values (
    p_meeting_id,
    p_student_id,
    p_status,
    'teacher',
    v_actor,
    nullif(btrim(p_note), ''),
    null,
    null,
    null,
    null
  )
  on conflict (meeting_id, student_id) do update
    set status = excluded.status,
        source = 'teacher',
        selfie_path = null,
        latitude = null,
        longitude = null,
        accuracy_m = null,
        distance_m = null,
        barcode_verified = false,
        recorded_by = excluded.recorded_by,
        teacher_note = excluded.teacher_note,
        verification_status = null,
        reviewed_by = null,
        reviewed_at = null,
        review_note = null,
        submitted_at = now()
  returning * into v_record;

  return v_record;
end;
$$;

create function private.submit_self_attendance_impl(
  p_meeting_id uuid,
  p_selfie_path text,
  p_raw_barcode text,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy_m double precision
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_meeting public.meetings%rowtype;
  v_distance double precision;
  v_record public.attendance_records%rowtype;
begin
  if v_actor is null or private.current_profile_role() <> 'student' then
    raise exception 'Only a signed-in student can submit self-attendance'
      using errcode = '42501';
  end if;

  select m.* into v_meeting
  from public.meetings m
  where m.id = p_meeting_id;

  if not found then
    raise exception 'Meeting not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.class_enrollments ce
    where ce.class_id = v_meeting.class_id
      and ce.student_id = v_actor
      and ce.is_active
  ) then
    raise exception 'You are not enrolled in this class' using errcode = '42501';
  end if;

  if not v_meeting.attendance_enabled then
    raise exception 'Attendance is disabled for this meeting' using errcode = '22023';
  end if;

  if v_meeting.attendance_mode = 'teacher_manual' then
    raise exception 'This meeting does not allow student self-check'
      using errcode = '22023';
  end if;

  if now() < v_meeting.attendance_opens_at or now() > v_meeting.attendance_closes_at then
    raise exception 'The attendance window is not open' using errcode = '22023';
  end if;

  if p_selfie_path is null
     or p_selfie_path not like v_actor::text || '/' || p_meeting_id::text || '/%'
     or position('..' in p_selfie_path) > 0
     or char_length(p_selfie_path) > 1024 then
    raise exception 'A valid selfie upload is required' using errcode = '22023';
  end if;

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'attendance-selfies'
      and o.name = p_selfie_path
  ) then
    raise exception 'The selfie upload was not found' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.attendance_records ar
    where ar.meeting_id = p_meeting_id and ar.student_id = v_actor
  ) then
    raise exception 'Attendance has already been recorded for this meeting'
      using errcode = '23505';
  end if;

  if v_meeting.attendance_mode in ('self_on_site', 'self_event') then
    if p_raw_barcode is null
       or btrim(p_raw_barcode) !~ '^[A-Za-z0-9._/-]{4,64}$'
       or not exists (
         select 1 from private.student_credentials sc
         where sc.student_id = v_actor
           and sc.barcode_hash = encode(extensions.digest(btrim(p_raw_barcode), 'sha256'), 'hex')
       ) then
      raise exception 'The scanned student ID does not match this account'
        using errcode = '42501';
    end if;

    if p_latitude is null or p_longitude is null or p_accuracy_m is null then
      raise exception 'A precise location is required' using errcode = '22023';
    end if;

    if p_latitude not between -90 and 90
       or p_longitude not between -180 and 180
       or p_accuracy_m < 0
       or p_accuracy_m > v_meeting.max_accuracy_m then
      raise exception 'Location accuracy does not meet this meeting requirement'
        using errcode = '22023';
    end if;

    v_distance := private.distance_m(
      v_meeting.latitude,
      v_meeting.longitude,
      p_latitude,
      p_longitude
    );

    if v_distance > v_meeting.radius_m then
      raise exception 'You are outside the allowed attendance location'
        using errcode = '22023';
    end if;
  else
    v_distance := null;
  end if;

  insert into public.attendance_records (
    meeting_id,
    student_id,
    status,
    source,
    selfie_path,
    latitude,
    longitude,
    accuracy_m,
    distance_m,
    barcode_verified,
    recorded_by,
    verification_status,
    submitted_at
  )
  values (
    p_meeting_id,
    v_actor,
    'present',
    'self_check',
    p_selfie_path,
    case when v_meeting.attendance_mode = 'self_online' then null else p_latitude end,
    case when v_meeting.attendance_mode = 'self_online' then null else p_longitude end,
    case when v_meeting.attendance_mode = 'self_online' then null else p_accuracy_m end,
    v_distance,
    v_meeting.attendance_mode <> 'self_online',
    v_actor,
    'pending',
    now()
  )
  returning * into v_record;

  return v_record;
end;
$$;

create function private.review_self_attendance_impl(
  p_attendance_id uuid,
  p_decision public.attendance_verification_status,
  p_note text
)
returns public.attendance_records
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_class_id uuid;
  v_record public.attendance_records%rowtype;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  select m.class_id into v_class_id
  from public.attendance_records ar
  join public.meetings m on m.id = ar.meeting_id
  where ar.id = p_attendance_id
    and ar.source = 'self_check';

  if not found then
    raise exception 'Self-check attendance record not found' using errcode = 'P0002';
  end if;

  if v_actor is null or not private.teacher_owns_class(v_class_id) then
    raise exception 'Only this class teacher can review attendance evidence'
      using errcode = '42501';
  end if;

  update public.attendance_records
  set verification_status = p_decision,
      status = case when p_decision = 'approved' then 'present'::public.attendance_status
                    else 'absent'::public.attendance_status end,
      reviewed_by = v_actor,
      reviewed_at = now(),
      review_note = nullif(btrim(p_note), '')
  where id = p_attendance_id
  returning * into v_record;

  return v_record;
end;
$$;

-- Public RPC wrappers remain SECURITY INVOKER. The public schema therefore
-- contains no definer-rights entry point.
create function public.complete_student_registration(
  p_full_name text,
  p_raw_barcode text,
  p_guardian_email text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.complete_student_registration_impl(
    p_full_name,
    p_raw_barcode,
    p_guardian_email
  )
$$;

create function public.create_class(
  p_name text,
  p_section text default null,
  p_timezone text default 'Asia/Manila',
  p_default_latitude double precision default null,
  p_default_longitude double precision default null,
  p_default_radius_m double precision default 100,
  p_default_max_accuracy_m double precision default 100
)
returns public.classes
language sql
security invoker
set search_path = ''
as $$
  select private.create_class_impl(
    p_name,
    p_section,
    p_timezone,
    p_default_latitude,
    p_default_longitude,
    p_default_radius_m,
    p_default_max_accuracy_m
  )
$$;

create function public.join_class(p_join_code text)
returns public.classes
language sql
security invoker
set search_path = ''
as $$
  select private.join_class_impl(p_join_code)
$$;

create function public.record_manual_attendance(
  p_meeting_id uuid,
  p_student_id uuid,
  p_status public.attendance_status,
  p_note text default null
)
returns public.attendance_records
language sql
security invoker
set search_path = ''
as $$
  select private.record_manual_attendance_impl(
    p_meeting_id,
    p_student_id,
    p_status,
    p_note
  )
$$;

create function public.submit_self_attendance(
  p_meeting_id uuid,
  p_selfie_path text,
  p_raw_barcode text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_accuracy_m double precision default null
)
returns public.attendance_records
language sql
security invoker
set search_path = ''
as $$
  select private.submit_self_attendance_impl(
    p_meeting_id,
    p_selfie_path,
    p_raw_barcode,
    p_latitude,
    p_longitude,
    p_accuracy_m
  )
$$;

create function public.review_self_attendance(
  p_attendance_id uuid,
  p_decision public.attendance_verification_status,
  p_note text default null
)
returns public.attendance_records
language sql
security invoker
set search_path = ''
as $$
  select private.review_self_attendance_impl(
    p_attendance_id,
    p_decision,
    p_note
  )
$$;

revoke all on function public.complete_student_registration(text, text, text) from public, anon, authenticated;
revoke all on function public.create_class(text, text, text, double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.join_class(text) from public, anon, authenticated;
revoke all on function public.record_manual_attendance(uuid, uuid, public.attendance_status, text) from public, anon, authenticated;
revoke all on function public.submit_self_attendance(uuid, text, text, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.review_self_attendance(uuid, public.attendance_verification_status, text) from public, anon, authenticated;

grant execute on function private.complete_student_registration_impl(text, text, text) to authenticated;
grant execute on function private.create_class_impl(text, text, text, double precision, double precision, double precision, double precision) to authenticated;
grant execute on function private.join_class_impl(text) to authenticated;
grant execute on function private.record_manual_attendance_impl(uuid, uuid, public.attendance_status, text) to authenticated;
grant execute on function private.submit_self_attendance_impl(uuid, text, text, double precision, double precision, double precision) to authenticated;
grant execute on function private.review_self_attendance_impl(uuid, public.attendance_verification_status, text) to authenticated;

grant execute on function public.complete_student_registration(text, text, text) to authenticated;
grant execute on function public.create_class(text, text, text, double precision, double precision, double precision, double precision) to authenticated;
grant execute on function public.join_class(text) to authenticated;
grant execute on function public.record_manual_attendance(uuid, uuid, public.attendance_status, text) to authenticated;
grant execute on function public.submit_self_attendance(uuid, text, text, double precision, double precision, double precision) to authenticated;
grant execute on function public.review_self_attendance(uuid, public.attendance_verification_status, text) to authenticated;

create view public.student_available_meetings
with (security_invoker = true)
as
select
  m.id,
  m.class_id,
  c.name as class_name,
  m.title,
  m.meeting_date,
  m.starts_at,
  m.ends_at,
  m.attendance_mode,
  m.attendance_enabled,
  m.attendance_opens_at,
  m.attendance_closes_at,
  m.max_accuracy_m,
  ar.status as existing_status,
  ar.submitted_at
from public.meetings m
join public.classes c on c.id = m.class_id
join public.class_enrollments ce
  on ce.class_id = m.class_id
 and ce.student_id = (select auth.uid())
 and ce.is_active
left join public.attendance_records ar
  on ar.meeting_id = m.id
 and ar.student_id = ce.student_id
where m.attendance_enabled
  and m.attendance_mode <> 'teacher_manual'
  and now() between m.attendance_opens_at and m.attendance_closes_at;

revoke all on table public.student_available_meetings from public, anon, authenticated;
grant select on table public.student_available_meetings to authenticated;

-- Selfies are private. Students can upload/read only their own meeting path;
-- the owning class teacher can read evidence after an attendance row exists.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'attendance-selfies',
  'attendance-selfies',
  false,
  5242880,
  array['image/jpeg', 'image/png']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy attendance_selfies_student_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'attendance-selfies'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png')
  and exists (
    select 1
    from public.meetings m
    join public.class_enrollments ce on ce.class_id = m.class_id
    where m.id::text = (storage.foldername(name))[2]
      and ce.student_id = (select auth.uid())
      and ce.is_active
      and m.attendance_enabled
      and m.attendance_mode <> 'teacher_manual'
      and now() between m.attendance_opens_at and m.attendance_closes_at
  )
);

create policy attendance_selfies_authorized_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'attendance-selfies'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.attendance_records ar
      join public.meetings m on m.id = ar.meeting_id
      join public.classes c on c.id = m.class_id
      where ar.selfie_path = name
        and c.teacher_id = (select auth.uid())
    )
  )
);

revoke all on table private.student_credentials from public, anon, authenticated;
grant all on table private.student_credentials to service_role;
grant usage on schema private to service_role;
