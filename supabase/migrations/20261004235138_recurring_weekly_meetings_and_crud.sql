-- School-wide defaults. These are enforced on the server so clients do not
-- need to collect coordinates while creating or editing a class.
alter table public.classes
  alter column default_latitude set default 13.387419,
  alter column default_longitude set default 121.162494,
  alter column default_radius_m set default 180;

update public.classes
set default_latitude = 13.387419,
    default_longitude = 121.162494,
    default_radius_m = 180
where default_latitude is distinct from 13.387419
   or default_longitude is distinct from 121.162494
   or default_radius_m is distinct from 180;

alter table public.classes
  alter column default_latitude set not null,
  alter column default_longitude set not null;

alter table public.meetings
  alter column latitude set default 13.387419,
  alter column longitude set default 121.162494,
  alter column radius_m set default 180;

-- Normalize existing rows before relying on the trigger for future writes.
-- Location is irrelevant online, while every other current mode uses the
-- school defaults (physical self-check modes require non-null coordinates).
update public.meetings
set latitude = case
      when attendance_mode = 'self_online' then null
      else 13.387419
    end,
    longitude = case
      when attendance_mode = 'self_online' then null
      else 121.162494
    end,
    radius_m = 180
where latitude is distinct from case
        when attendance_mode = 'self_online' then null
        else 13.387419
      end
   or longitude is distinct from case
        when attendance_mode = 'self_online' then null
        else 121.162494
      end
   or radius_m is distinct from 180;

-- Meeting coordinates are derived from the attendance mode, never trusted
-- from a browser form. Physical self-checks always use the school geofence;
-- online self-checks never retain a location. Teacher-manual meetings keep
-- the school defaults so changing their mode later starts from a safe value.
create or replace function private.enforce_meeting_location()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.attendance_mode = 'self_online' then
    new.latitude := null;
    new.longitude := null;
    new.radius_m := 180;
  else
    new.latitude := 13.387419;
    new.longitude := 121.162494;
    new.radius_m := 180;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_meeting_location()
from public, anon, authenticated;

drop trigger if exists meetings_enforce_school_location on public.meetings;
create trigger meetings_enforce_school_location
before insert or update of attendance_mode, latitude, longitude, radius_m
on public.meetings
for each row execute function private.enforce_meeting_location();

create or replace function private.enforce_school_location()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.default_latitude := 13.387419;
  new.default_longitude := 121.162494;
  new.default_radius_m := 180;
  return new;
end;
$$;

revoke all on function private.enforce_school_location() from public, anon, authenticated;

drop trigger if exists classes_enforce_school_location on public.classes;
create trigger classes_enforce_school_location
before insert or update of default_latitude, default_longitude, default_radius_m
on public.classes
for each row execute function private.enforce_school_location();

-- Keep the existing RPC signature for deployed clients, but ignore any old
-- location arguments and always persist the school's fixed defaults.
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
    13.387419,
    121.162494,
    180,
    coalesce(p_default_max_accuracy_m, 100)
  )
  returning * into v_class;

  return v_class;
end;
$$;

create or replace function public.create_class(
  p_name text,
  p_section text default null,
  p_timezone text default 'Asia/Manila',
  p_default_latitude double precision default 13.387419,
  p_default_longitude double precision default 121.162494,
  p_default_radius_m double precision default 180,
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

-- Authenticated clients can edit ordinary class details, but the school's
-- location is controlled by the database and cannot be changed by a teacher.
revoke update (default_latitude, default_longitude, default_radius_m)
on table public.classes from authenticated;

-- schedule_week_start is the stable recurrence identity. A teacher may edit
-- the generated meeting date/time without causing cron to create a duplicate.
alter table public.meetings
  add column schedule_week_start date;

update public.meetings
set schedule_week_start = date_trunc('week', meeting_date::timestamp)::date
where schedule_id is not null
  and schedule_week_start is null;

create unique index meetings_one_per_schedule_week_idx
on public.meetings (schedule_id, schedule_week_start)
where schedule_id is not null and schedule_week_start is not null;

comment on column public.meetings.schedule_week_start is
  'Monday in Asia/Manila identifying the weekly schedule occurrence; retained when a meeting is edited.';

-- A hard-deleted generated meeting must stay deleted. This private tombstone
-- prevents the recovery job from recreating that schedule occurrence.
create table private.schedule_meeting_exceptions (
  schedule_id uuid not null
    references public.class_schedules (id) on delete cascade,
  schedule_week_start date not null,
  meeting_date date not null,
  deleted_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz not null default now(),
  primary key (schedule_id, schedule_week_start)
);

alter table private.schedule_meeting_exceptions enable row level security;

create policy schedule_meeting_exceptions_deny_clients
on private.schedule_meeting_exceptions
for all
to anon, authenticated
using (false)
with check (false);

revoke all on table private.schedule_meeting_exceptions from public, anon, authenticated;
grant all on table private.schedule_meeting_exceptions to service_role;

create or replace function private.remember_deleted_schedule_meeting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.schedule_id is not null
     and old.schedule_week_start is not null
     -- During a class cascade, the sibling schedule may already have been
     -- deleted. Avoid inserting a tombstone with a dangling foreign key. If
     -- the schedule still exists, its later cascade safely removes the row.
     and exists (
       select 1
       from public.class_schedules schedule_row
       where schedule_row.id = old.schedule_id
     ) then
    insert into private.schedule_meeting_exceptions (
      schedule_id,
      schedule_week_start,
      meeting_date,
      deleted_by
    )
    values (
      old.schedule_id,
      old.schedule_week_start,
      old.meeting_date,
      (select auth.uid())
    )
    on conflict (schedule_id, schedule_week_start) do nothing;
  end if;

  return old;
end;
$$;

revoke all on function private.remember_deleted_schedule_meeting()
from public, anon, authenticated;

drop trigger if exists meetings_remember_deleted_schedule_occurrence on public.meetings;
create trigger meetings_remember_deleted_schedule_occurrence
before delete on public.meetings
for each row execute function private.remember_deleted_schedule_meeting();

-- Generate one persisted meeting for every active weekly schedule. The week
-- and all wall-clock times are calculated explicitly in Asia/Manila. ON
-- CONFLICT DO NOTHING is intentional: teacher edits, attendance mode changes,
-- and disabling one meeting are never overwritten by a later recovery run.
create or replace function private.generate_current_week_meetings(
  p_class_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date := date_trunc(
    'week',
    pg_catalog.timezone('Asia/Manila', pg_catalog.now())
  )::date;
  v_inserted integer := 0;
begin
  with candidates as (
    select
      cs.id as schedule_id,
      cs.class_id,
      c.teacher_id,
      c.name as class_name,
      cs.starts_at as local_starts_at,
      cs.ends_at as local_ends_at,
      (
        v_week_start
        + case when cs.day_of_week = 0 then 6 else cs.day_of_week - 1 end
      )::date as meeting_date
    from public.class_schedules cs
    join public.classes c on c.id = cs.class_id
    join public.profiles teacher
      on teacher.id = c.teacher_id
     and teacher.role = 'teacher'
     and teacher.teacher_approval_status = 'approved'
    where cs.is_active
      and (p_class_id is null or cs.class_id = p_class_id)
  ), inserted as (
    insert into public.meetings (
      class_id,
      schedule_id,
      schedule_week_start,
      title,
      meeting_date,
      starts_at,
      ends_at,
      attendance_mode,
      attendance_enabled,
      attendance_opens_at,
      attendance_closes_at,
      latitude,
      longitude,
      radius_m,
      max_accuracy_m,
      created_by
    )
    select
      candidate.class_id,
      candidate.schedule_id,
      v_week_start,
      candidate.class_name,
      candidate.meeting_date,
      (candidate.meeting_date + candidate.local_starts_at)
        at time zone 'Asia/Manila',
      (candidate.meeting_date + candidate.local_ends_at)
        at time zone 'Asia/Manila',
      'teacher_manual'::public.attendance_mode,
      true,
      (
        (candidate.meeting_date + candidate.local_starts_at)
          at time zone 'Asia/Manila'
      ) - interval '15 minutes',
      (candidate.meeting_date + candidate.local_ends_at)
        at time zone 'Asia/Manila',
      13.387419,
      121.162494,
      180,
      100,
      candidate.teacher_id
    from candidates candidate
    where not exists (
      select 1
      from private.schedule_meeting_exceptions exception_row
      where exception_row.schedule_id = candidate.schedule_id
        and exception_row.schedule_week_start = v_week_start
    )
    on conflict (schedule_id, schedule_week_start)
      where schedule_id is not null and schedule_week_start is not null
      do nothing
    returning 1
  )
  select count(*)::integer into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function private.generate_current_week_meetings(uuid)
from public, anon, authenticated;

-- Creating or reactivating a schedule produces this week's persisted meeting
-- immediately. Day/time edits intentionally apply to the next ungenerated
-- week; the already-persisted current occurrence is edited independently.
-- Moving a schedule between classes is rejected to avoid leaving its current
-- occurrence attached to a different class. The cron job remains recovery if
-- a trigger run or deployment was missed.
create or replace function private.generate_meeting_after_schedule_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.class_id is distinct from old.class_id then
    raise exception 'A schedule cannot be moved to another class; create a new schedule instead'
      using errcode = '22023';
  end if;

  if new.is_active then
    perform private.generate_current_week_meetings(new.class_id);
  end if;
  return new;
end;
$$;

revoke all on function private.generate_meeting_after_schedule_change()
from public, anon, authenticated;

drop trigger if exists class_schedules_generate_current_week_meeting
on public.class_schedules;
create trigger class_schedules_generate_current_week_meeting
after insert or update of class_id, day_of_week, starts_at, ends_at, is_active
on public.class_schedules
for each row execute function private.generate_meeting_after_schedule_change();

-- Authenticated recovery/read endpoint for the teacher dashboard. It returns
-- only meetings in the current Asia/Manila Monday-Sunday week and only for
-- classes owned by the approved teacher making the request.
create or replace function private.ensure_current_week_meetings_impl(
  p_class_id uuid default null
)
returns setof public.meetings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owned_class_id uuid;
  v_week_start date := date_trunc(
    'week',
    pg_catalog.timezone('Asia/Manila', pg_catalog.now())
  )::date;
begin
  if v_actor is null
     or not exists (
       select 1
       from public.profiles p
       where p.id = v_actor
         and p.role = 'teacher'
         and p.teacher_approval_status = 'approved'
     ) then
    raise exception 'Only an approved teacher can load weekly meetings'
      using errcode = '42501';
  end if;

  if p_class_id is not null
     and not exists (
       select 1
       from public.classes c
       where c.id = p_class_id
         and c.teacher_id = v_actor
     ) then
    raise exception 'Class not found or not owned by this teacher'
      using errcode = '42501';
  end if;

  if p_class_id is not null then
    perform private.generate_current_week_meetings(p_class_id);
  else
    -- Never invoke the unscoped generator from a client-authenticated path.
    -- NULL means all classes owned by this approved teacher, not all classes.
    for v_owned_class_id in
      select c.id
      from public.classes c
      where c.teacher_id = v_actor
    loop
      perform private.generate_current_week_meetings(v_owned_class_id);
    end loop;
  end if;

  return query
  select meeting.*
  from public.meetings meeting
  join public.classes class_row on class_row.id = meeting.class_id
  where class_row.teacher_id = v_actor
    and (p_class_id is null or meeting.class_id = p_class_id)
    and meeting.meeting_date >= v_week_start
    and meeting.meeting_date < v_week_start + 7
  order by meeting.starts_at, meeting.created_at;
end;
$$;

create or replace function public.ensure_current_week_meetings(
  p_class_id uuid default null
)
returns setof public.meetings
language sql
security invoker
set search_path = ''
as $$
  select * from private.ensure_current_week_meetings_impl(p_class_id)
$$;

revoke all on function private.ensure_current_week_meetings_impl(uuid)
from public, anon, authenticated;
grant execute on function private.ensure_current_week_meetings_impl(uuid)
to authenticated;

revoke all on function public.ensure_current_week_meetings(uuid)
from public, anon, authenticated;
grant execute on function public.ensure_current_week_meetings(uuid)
to authenticated;

-- Backfill this week before scheduling recovery. Supabase Cron uses pg_cron;
-- its default timezone is UTC, so 16:05 UTC is 00:05 in Asia/Manila.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select private.generate_current_week_meetings();

do $cron_setup$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'attendance-generate-current-week-meetings';

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'attendance-generate-current-week-meetings',
    '5 16 * * *',
    $job$select private.generate_current_week_meetings();$job$
  );
end;
$cron_setup$;

comment on table private.schedule_meeting_exceptions is
  'Private tombstones for intentionally deleted generated meetings; deleted with their schedule.';

comment on function public.ensure_current_week_meetings(uuid) is
  'Idempotently creates and returns the approved teacher current-week meetings in Asia/Manila.';

-- Deletion behavior intentionally follows the established foreign keys:
-- * deleting a schedule preserves its generated meetings (schedule_id SET NULL)
-- * deleting a meeting also deletes its attendance records (CASCADE)
-- * deleting a class deletes its schedules, meetings, enrollments, and records
-- Authorization for all three direct UPDATE/DELETE paths remains enforced by
-- the existing approved-teacher ownership RLS policies.
