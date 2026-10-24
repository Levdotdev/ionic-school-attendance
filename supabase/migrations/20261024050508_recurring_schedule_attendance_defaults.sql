-- A weekly schedule owns the defaults for each newly generated occurrence.
-- Existing meeting overrides, cancellations and deletion exceptions survive.
alter table public.class_schedules
  add column attendance_mode public.attendance_mode not null default 'teacher_manual',
  add column check_in_minutes_before smallint not null default 15,
  add constraint class_schedules_supported_attendance_mode
    check (attendance_mode in ('teacher_manual', 'self_on_site', 'self_online')),
  add constraint class_schedules_check_in_minutes_range
    check (check_in_minutes_before between 0 and 120);

comment on column public.class_schedules.attendance_mode is
  'Default attendance mode for new weekly occurrences; an existing occurrence remains independently editable.';
comment on column public.class_schedules.check_in_minutes_before is
  'How many minutes before class a newly generated meeting opens for check-in (0–120).';

-- This private generator already runs with elevated permissions for Cron.
-- Its existing teacher approval filter and private-only execute grants remain.
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
    'week', pg_catalog.timezone('Asia/Manila', pg_catalog.now())
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
      cs.attendance_mode,
      cs.check_in_minutes_before,
      c.default_max_accuracy_m,
      (v_week_start + case when cs.day_of_week = 0 then 6 else cs.day_of_week - 1 end)::date as meeting_date
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
      class_id, schedule_id, schedule_week_start, title, meeting_date,
      starts_at, ends_at, attendance_mode, attendance_enabled,
      attendance_opens_at, attendance_closes_at,
      latitude, longitude, radius_m, max_accuracy_m, created_by
    )
    select
      candidate.class_id,
      candidate.schedule_id,
      v_week_start,
      candidate.class_name,
      candidate.meeting_date,
      (candidate.meeting_date + candidate.local_starts_at) at time zone 'Asia/Manila',
      (candidate.meeting_date + candidate.local_ends_at) at time zone 'Asia/Manila',
      candidate.attendance_mode,
      true,
      ((candidate.meeting_date + candidate.local_starts_at) at time zone 'Asia/Manila')
        - pg_catalog.make_interval(mins => candidate.check_in_minutes_before::integer),
      (candidate.meeting_date + candidate.local_ends_at) at time zone 'Asia/Manila',
      case when candidate.attendance_mode = 'self_online' then null else 13.387419 end,
      case when candidate.attendance_mode = 'self_online' then null else 121.162494 end,
      180,
      candidate.default_max_accuracy_m,
      candidate.teacher_id
    from candidates candidate
    where not exists (
      select 1 from private.schedule_meeting_exceptions exception_row
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

drop trigger if exists class_schedules_generate_current_week_meeting
on public.class_schedules;
create trigger class_schedules_generate_current_week_meeting
after insert or update of class_id, day_of_week, starts_at, ends_at,
  is_active, attendance_mode, check_in_minutes_before
on public.class_schedules
for each row execute function private.generate_meeting_after_schedule_change();

-- Table-level grants and teacher ownership RLS already cover the new fields.
-- No new public RPC or elevated execution surface is added by this migration.

-- The reminder worker can generate an early Monday occurrence on Sunday.
-- It must use the same saved defaults as the current-week generator.
create or replace function private.generate_imminent_schedule_meetings(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_week_start date := date_trunc(
    'week',
    pg_catalog.timezone('Asia/Manila', p_now)
  )::date;
  v_inserted integer := 0;
begin
  with candidates as (
    select
      schedule_row.id as schedule_id,
      schedule_row.class_id,
      class_row.teacher_id,
      class_row.name as class_name,
      week_row.week_start,
      (
        week_row.week_start
        + case
            when schedule_row.day_of_week = 0 then 6
            else schedule_row.day_of_week - 1
          end
      )::date as meeting_date,
      schedule_row.starts_at as local_starts_at,
      schedule_row.ends_at as local_ends_at,
      schedule_row.attendance_mode,
      schedule_row.check_in_minutes_before,
      class_row.default_max_accuracy_m
    from public.class_schedules schedule_row
    join public.classes class_row
      on class_row.id = schedule_row.class_id
    join public.profiles teacher_profile
      on teacher_profile.id = class_row.teacher_id
     and teacher_profile.role = 'teacher'::public.app_role
     and teacher_profile.teacher_approval_status = 'approved'::public.teacher_approval_status
    cross join lateral (
      values (v_week_start), (v_week_start + 7)
    ) as week_row(week_start)
    where schedule_row.is_active
  ), imminent as (
    select candidate.*
    from candidates candidate
    where (
        (candidate.meeting_date + candidate.local_starts_at)
          at time zone 'Asia/Manila'
      ) >= p_now
      and (
        (candidate.meeting_date + candidate.local_starts_at)
          at time zone 'Asia/Manila'
      ) < p_now + interval '3 hours'
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
      candidate.week_start,
      candidate.class_name,
      candidate.meeting_date,
      (candidate.meeting_date + candidate.local_starts_at)
        at time zone 'Asia/Manila',
      (candidate.meeting_date + candidate.local_ends_at)
        at time zone 'Asia/Manila',
      candidate.attendance_mode,
      true,
      (
        (candidate.meeting_date + candidate.local_starts_at)
          at time zone 'Asia/Manila'
      ) - pg_catalog.make_interval(mins => candidate.check_in_minutes_before::integer),
      (candidate.meeting_date + candidate.local_ends_at)
        at time zone 'Asia/Manila',
      case when candidate.attendance_mode = 'self_online' then null else 13.387419 end,
      case when candidate.attendance_mode = 'self_online' then null else 121.162494 end,
      180,
      candidate.default_max_accuracy_m,
      candidate.teacher_id
    from imminent candidate
    where not exists (
      select 1
      from private.schedule_meeting_exceptions exception_row
      where exception_row.schedule_id = candidate.schedule_id
        and exception_row.schedule_week_start = candidate.week_start
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
