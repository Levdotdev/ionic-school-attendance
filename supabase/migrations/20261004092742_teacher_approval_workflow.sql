-- Teacher self-registration, admin review, parent selfie access, and broader
-- linear-barcode support. The preceding migration commits the new app_role
-- enum value before this migration references it.

create type public.teacher_approval_status as enum (
  'pending',
  'approved',
  'rejected'
);

revoke all on type public.teacher_approval_status from public, anon, authenticated;
grant usage on type public.teacher_approval_status to authenticated, service_role;

alter table public.profiles
  add column teacher_approval_status public.teacher_approval_status,
  add column teacher_approval_note text
    check (
      teacher_approval_note is null
      or char_length(teacher_approval_note) <= 1000
    ),
  add column teacher_approved_by uuid
    references public.profiles (id) on delete set null,
  add column teacher_approved_at timestamptz;

-- Accounts that were trusted teachers before approval existed must not lose
-- access when this migration is deployed. A null approver identifies this
-- one-time legacy backfill; all later reviews record the acting admin.
update public.profiles
set teacher_approval_status = 'approved',
    teacher_approved_at = now()
where role = 'teacher';

alter table public.profiles
  add constraint profiles_teacher_approval_consistency check (
    (
      role = 'teacher'
      and teacher_approval_status is not null
      and (
        (
          teacher_approval_status = 'pending'
          and teacher_approval_note is null
          and teacher_approved_by is null
          and teacher_approved_at is null
        )
        or
        (
          teacher_approval_status in ('approved', 'rejected')
          and teacher_approved_at is not null
        )
      )
    )
    or
    (
      role <> 'teacher'
      and teacher_approval_status is null
      and teacher_approval_note is null
      and teacher_approved_by is null
      and teacher_approved_at is null
    )
  );

create index profiles_teacher_approval_queue_idx
on public.profiles (teacher_approval_status, created_at)
where role = 'teacher';

comment on column public.profiles.role is
  'Authorization role. Self-signup may request student, parent, or teacher. Teacher privileges require admin approval; admin is provisioned only through a trusted service-role workflow.';
comment on column public.profiles.teacher_approval_status is
  'Teacher-only review state. Pending and rejected teachers have no teacher privileges.';
comment on column public.profiles.teacher_approved_by is
  'Admin who made the latest teacher review decision; null only for the legacy approved-teacher backfill.';
comment on column public.profiles.teacher_approved_at is
  'Time of the latest teacher review decision, including rejection.';

-- Approval fields are authorization data and cannot be changed through a
-- client profile update. Definer RPCs and trusted platform roles may change
-- them after performing their own authorization checks.
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
     )
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

-- User metadata is allowed to request teacher onboarding, but it is never
-- trusted to grant teacher privileges or the admin role. Existing profiles do
-- not change role when a user later edits their metadata.
create or replace function private.handle_auth_user_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_full_name text;
  v_signup_role public.app_role;
  v_teacher_status public.teacher_approval_status;
begin
  v_email := lower(btrim(new.email));
  v_full_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'User'
  );

  v_signup_role := case
    when new.raw_user_meta_data ->> 'role' = 'parent' then 'parent'::public.app_role
    when new.raw_user_meta_data ->> 'role' = 'teacher' then 'teacher'::public.app_role
    else 'student'::public.app_role
  end;

  v_teacher_status := case
    when v_signup_role = 'teacher' then 'pending'::public.teacher_approval_status
    else null
  end;

  insert into public.profiles (
    id,
    role,
    full_name,
    email,
    teacher_approval_status
  )
  values (
    new.id,
    v_signup_role,
    v_full_name,
    v_email,
    v_teacher_status
  )
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

-- Every teacher authorization path verifies both the role and current
-- approval state. Rejecting a previously approved teacher therefore revokes
-- access immediately without changing or deleting historical class data.
create or replace function private.teacher_owns_class(p_class_id uuid)
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
      join public.profiles p
        on p.id = c.teacher_id
       and p.role = 'teacher'
       and p.teacher_approval_status = 'approved'
      where c.id = p_class_id
        and c.teacher_id = (select auth.uid())
    )
$$;

create or replace function private.teacher_has_student(p_student_id uuid)
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
      join public.profiles teacher
        on teacher.id = c.teacher_id
       and teacher.role = 'teacher'
       and teacher.teacher_approval_status = 'approved'
      where ce.student_id = p_student_id
        and ce.is_active
        and c.teacher_id = (select auth.uid())
    )
$$;

-- Guardian links are created only after email verification. Re-check the
-- current Auth record as well so an old link cannot survive an unconfirmed
-- email change and continue granting access.
create or replace function private.parent_has_student(p_student_id uuid)
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
      join public.profiles parent_profile
        on parent_profile.id = gl.parent_id
       and parent_profile.role = 'parent'
      join auth.users parent_auth on parent_auth.id = gl.parent_id
      where gl.parent_id = (select auth.uid())
        and gl.student_id = p_student_id
        and parent_auth.email_confirmed_at is not null
        and lower(parent_auth.email) = gl.verified_guardian_email
    )
$$;

create or replace function private.can_access_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.classes c
        join public.profiles teacher
          on teacher.id = c.teacher_id
         and teacher.role = 'teacher'
         and teacher.teacher_approval_status = 'approved'
        where c.id = p_class_id
          and c.teacher_id = (select auth.uid())
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

create or replace function private.can_view_profile(p_profile_id uuid)
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
            (
              c.teacher_id = (select auth.uid())
              and ce.student_id = p_profile_id
              and exists (
                select 1
                from public.profiles teacher
                where teacher.id = (select auth.uid())
                  and teacher.role = 'teacher'
                  and teacher.teacher_approval_status = 'approved'
              )
            )
            or (
              ce.student_id = (select auth.uid())
              and c.teacher_id = p_profile_id
            )
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

create or replace function private.can_access_attendance(
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
        join public.profiles teacher
          on teacher.id = c.teacher_id
         and teacher.role = 'teacher'
         and teacher.teacher_approval_status = 'approved'
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

-- The public table remains read-only except for the existing own-name update.
-- This additional SELECT policy exposes the review queue to admins while all
-- authorization-field writes remain confined to the review RPC.
create policy profiles_select_admin
on public.profiles
for select
to authenticated
using ((select private.current_profile_role()) = 'admin');

create or replace function private.create_class_impl(
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
  if v_actor is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = v_actor
         and p.role = 'teacher'
         and p.teacher_approval_status = 'approved'
     ) then
    raise exception 'Only an approved teacher can create a class'
      using errcode = '42501';
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

-- Long linear barcodes commonly contain spaces and punctuation. Normalize
-- only surrounding spaces, allow 4-256 non-control characters, and hash the
-- exact normalized payload in both registration and attendance verification.
create or replace function private.complete_student_registration_impl(
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

  if v_barcode is null
     or char_length(v_barcode) not between 4 and 256
     or v_barcode ~ '[[:cntrl:]]' then
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

create or replace function private.submit_self_attendance_impl(
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
  v_barcode text := btrim(p_raw_barcode);
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
    if v_barcode is null
       or char_length(v_barcode) not between 4 and 256
       or v_barcode ~ '[[:cntrl:]]'
       or not exists (
         select 1 from private.student_credentials sc
         where sc.student_id = v_actor
           and sc.barcode_hash = encode(extensions.digest(v_barcode, 'sha256'), 'hex')
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

-- The implementation is kept in the unexposed private schema because it must
-- bypass profile RLS to update another user. It binds the actor to auth.uid()
-- and verifies the actor's current database role before making any change.
create function private.review_teacher_registration_impl(
  p_teacher_id uuid,
  p_decision text,
  p_note text
)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_decision text := lower(btrim(p_decision));
  v_note text := nullif(btrim(p_note), '');
  v_profile public.profiles%rowtype;
begin
  if v_actor is null
     or not exists (
       select 1
       from public.profiles admin_profile
       where admin_profile.id = v_actor
         and admin_profile.role = 'admin'
     ) then
    raise exception 'Only an admin can review teacher registrations'
      using errcode = '42501';
  end if;

  if v_decision is null or v_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected' using errcode = '22023';
  end if;

  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Review note must be 1000 characters or fewer'
      using errcode = '22023';
  end if;

  update public.profiles
  set teacher_approval_status = v_decision::public.teacher_approval_status,
      teacher_approval_note = v_note,
      teacher_approved_by = v_actor,
      teacher_approved_at = now()
  where id = p_teacher_id
    and role = 'teacher'
  returning * into v_profile;

  if not found then
    raise exception 'Teacher registration not found' using errcode = 'P0002';
  end if;

  return v_profile;
end;
$$;

create function public.review_teacher_registration(
  p_teacher_id uuid,
  p_decision text,
  p_note text default null
)
returns public.profiles
language sql
security invoker
set search_path = ''
as $$
  select private.review_teacher_registration_impl(
    p_teacher_id,
    p_decision,
    p_note
  )
$$;

revoke all on function private.review_teacher_registration_impl(uuid, text, text)
from public, anon, authenticated;
grant execute on function private.review_teacher_registration_impl(uuid, text, text)
to authenticated;

revoke all on function public.review_teacher_registration(uuid, text, text)
from public, anon, authenticated;
grant execute on function public.review_teacher_registration(uuid, text, text)
to authenticated;

-- Preserve owner access, require an approved class teacher, and allow only a
-- verified linked parent to read the exact selfie recorded for their child.
drop policy attendance_selfies_authorized_select on storage.objects;

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
      where ar.selfie_path = name
        and (
          (select private.teacher_owns_class(m.class_id))
          or (select private.parent_has_student(ar.student_id))
        )
    )
  )
);
