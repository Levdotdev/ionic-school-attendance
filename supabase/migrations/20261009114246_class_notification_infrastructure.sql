-- Durable class-reminder infrastructure.
--
-- Weekly schedules own the reminder defaults so a teacher configures them
-- once. Device tokens remain user-scoped through RLS, while queue and delivery
-- rows live in the unexposed private schema and are only reached by narrowly
-- granted RPCs.

alter table public.class_schedules
  add column teacher_reminder_minutes smallint[] not null
    default array[5, 0]::smallint[],
  add column student_reminder_minutes smallint[] not null
    default array[120, 60, 30, 15, 5, 0]::smallint[],
  add constraint class_schedules_teacher_reminders_supported check (
    cardinality(teacher_reminder_minutes) <= 2
    and teacher_reminder_minutes <@ array[0, 5]::smallint[]
    and cardinality(pg_catalog.array_positions(teacher_reminder_minutes, 0::smallint)) <= 1
    and cardinality(pg_catalog.array_positions(teacher_reminder_minutes, 5::smallint)) <= 1
  ),
  add constraint class_schedules_student_reminders_supported check (
    cardinality(student_reminder_minutes) <= 6
    and student_reminder_minutes <@ array[0, 5, 15, 30, 60, 120]::smallint[]
    and cardinality(pg_catalog.array_positions(student_reminder_minutes, 0::smallint)) <= 1
    and cardinality(pg_catalog.array_positions(student_reminder_minutes, 5::smallint)) <= 1
    and cardinality(pg_catalog.array_positions(student_reminder_minutes, 15::smallint)) <= 1
    and cardinality(pg_catalog.array_positions(student_reminder_minutes, 30::smallint)) <= 1
    and cardinality(pg_catalog.array_positions(student_reminder_minutes, 60::smallint)) <= 1
    and cardinality(pg_catalog.array_positions(student_reminder_minutes, 120::smallint)) <= 1
  );

comment on column public.class_schedules.teacher_reminder_minutes is
  'One-time weekly-schedule configuration. Supported offsets are 5 minutes and class time (0).';
comment on column public.class_schedules.student_reminder_minutes is
  'One-time weekly-schedule configuration. Supported offsets are 2h, 1h, 30m, 15m, 5m, and class time (0).';

create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null
    references public.profiles (id) on delete cascade,
  installation_id uuid not null,
  provider text not null
    check (provider in ('fcm', 'apns')),
  platform text not null
    check (platform in ('android', 'ios')),
  token text not null
    check (
      char_length(token) between 16 and 4096
      and token = btrim(token)
      and token !~ '[[:space:]]'
    ),
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint device_push_tokens_provider_platform check (
    (provider = 'fcm' and platform = 'android')
    or (provider = 'apns' and platform = 'ios')
  ),
  constraint device_push_tokens_disabled_consistency check (
    (is_active and disabled_at is null)
    or (not is_active and disabled_at is not null)
  ),
  unique (provider, token),
  unique (user_id, provider, installation_id)
);

comment on table public.device_push_tokens is
  'Native push tokens. Clients register through register_device_push_token; a user may only list or remove their own devices.';

create index device_push_tokens_active_user_idx
on public.device_push_tokens (user_id, provider, id)
where is_active;

-- enqueue_class_notifications filters this rolling window every minute. The
-- existing class/date index cannot serve a global starts_at range scan.
create index meetings_notification_starts_idx
on public.meetings (starts_at, id)
where schedule_id is not null and attendance_enabled;

create trigger device_push_tokens_set_updated_at
before update on public.device_push_tokens
for each row execute function private.set_updated_at();

alter table public.device_push_tokens enable row level security;

create policy device_push_tokens_select_own
on public.device_push_tokens
for select
to authenticated
using (user_id = (select auth.uid()));

create policy device_push_tokens_delete_own
on public.device_push_tokens
for delete
to authenticated
using (user_id = (select auth.uid()));

-- Registration uses a definer function so a device token that was previously
-- attached to another signed-in account can be atomically reclaimed. The
-- actor is always auth.uid(); callers cannot choose a user_id.
create function private.register_device_push_token_impl(
  p_installation_id uuid,
  p_token text,
  p_platform text,
  p_provider text
)
returns public.device_push_tokens
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_token text := btrim(p_token);
  v_platform text := lower(btrim(p_platform));
  v_provider text := lower(btrim(p_provider));
  v_existing_token_id uuid;
  v_existing_user_id uuid;
  v_result public.device_push_tokens%rowtype;
begin
  if v_actor is null
     or not exists (
       select 1 from public.profiles profile_row where profile_row.id = v_actor
     ) then
    raise exception 'Sign in before registering notifications'
      using errcode = '42501';
  end if;

  if p_installation_id is null then
    raise exception 'A device installation ID is required'
      using errcode = '22023';
  end if;

  if char_length(v_token) not between 16 and 4096
     or v_token ~ '[[:space:]]' then
    raise exception 'The push token is invalid'
      using errcode = '22023';
  end if;

  if not (
    (v_provider = 'fcm' and v_platform = 'android')
    or (v_provider = 'apns' and v_platform = 'ios')
  ) then
    raise exception 'The push provider does not match this device platform'
      using errcode = '22023';
  end if;

  -- Serialize both the installation and token identities. If an OS token is
  -- reused after an account switch, deleting its old row gives the new owner a
  -- fresh ID and ON DELETE SET NULL invalidates every old-account delivery.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'push-install:' || v_actor::text || ':' || v_provider || ':' || p_installation_id::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('push-token:' || v_provider || ':' || v_token, 0)
  );

  select token_row.id, token_row.user_id
  into v_existing_token_id, v_existing_user_id
  from public.device_push_tokens token_row
  where token_row.provider = v_provider
    and token_row.token = v_token
  for update;

  if v_existing_token_id is not null
     and v_existing_user_id <> v_actor then
    delete from public.device_push_tokens token_row
    where token_row.id = v_existing_token_id;
  end if;

  -- A refreshed OS token replaces the prior token for this installation.
  delete from public.device_push_tokens token_row
  where token_row.user_id = v_actor
    and token_row.provider = v_provider
    and token_row.installation_id = p_installation_id
    and token_row.token <> v_token;

  insert into public.device_push_tokens as stored_token (
    user_id,
    installation_id,
    provider,
    platform,
    token,
    is_active,
    last_seen_at,
    disabled_at
  )
  values (
    v_actor,
    p_installation_id,
    v_provider,
    v_platform,
    v_token,
    true,
    now(),
    null
  )
  on conflict (provider, token) do update
  set user_id = excluded.user_id,
      installation_id = excluded.installation_id,
      platform = excluded.platform,
      is_active = true,
      last_seen_at = now(),
      disabled_at = null
  where stored_token.user_id = excluded.user_id
  returning * into v_result;

  if v_result.id is null then
    raise exception 'The push token changed owners while it was being registered. Retry registration.'
      using errcode = '40001';
  end if;

  return v_result;
end;
$$;

create function public.register_device_push_token(
  p_installation_id uuid,
  p_token text,
  p_platform text,
  p_provider text
)
returns public.device_push_tokens
language sql
security invoker
set search_path = ''
as $$
  select private.register_device_push_token_impl(
    p_installation_id,
    p_token,
    p_platform,
    p_provider
  )
$$;

create function private.unregister_device_push_token_impl(
  p_installation_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_deleted integer := 0;
begin
  if v_actor is null then
    raise exception 'Sign in before changing notification settings'
      using errcode = '42501';
  end if;

  delete from public.device_push_tokens token_row
  where token_row.user_id = v_actor
    and token_row.installation_id = p_installation_id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create function public.unregister_device_push_token(
  p_installation_id uuid
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.unregister_device_push_token_impl(p_installation_id)
$$;

-- One queue row represents a logical reminder. Delivery rows expand that
-- reminder to every active device and provide per-device idempotency.
create table private.class_notification_queue (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null
    references public.meetings (id) on delete cascade,
  schedule_id uuid not null
    references public.class_schedules (id) on delete cascade,
  user_id uuid not null
    references public.profiles (id) on delete cascade,
  audience text not null
    check (audience in ('teacher', 'student')),
  reminder_offset_minutes smallint not null
    check (reminder_offset_minutes in (0, 5, 15, 30, 60, 120)),
  scheduled_for timestamptz not null,
  state text not null default 'pending'
    check (state in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_id, user_id, audience, reminder_offset_minutes)
);

create table private.class_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  queue_id uuid not null
    references private.class_notification_queue (id) on delete cascade,
  push_token_id uuid
    references public.device_push_tokens (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts smallint not null default 0
    check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  claimed_by uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  provider_message_id text
    check (provider_message_id is null or char_length(provider_message_id) <= 1000),
  last_error text
    check (last_error is null or char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_notification_deliveries_sent_consistency check (
    (status = 'sent' and sent_at is not null)
    or (status <> 'sent' and sent_at is null)
  ),
  unique (queue_id, push_token_id)
);

comment on table private.class_notification_queue is
  'Logical weekly-class reminders, deduplicated by meeting, recipient, audience, and offset.';
comment on table private.class_notification_deliveries is
  'Per-device push attempts. The queue/token unique key prevents duplicate delivery creation.';

create index class_notification_queue_due_idx
on private.class_notification_queue (scheduled_for, id)
where state in ('pending', 'processing');
create index class_notification_queue_schedule_idx
on private.class_notification_queue (schedule_id);
create index class_notification_queue_user_idx
on private.class_notification_queue (user_id, scheduled_for desc);
create index class_notification_deliveries_retry_idx
on private.class_notification_deliveries (next_attempt_at, id)
where status in ('pending', 'processing');
create index class_notification_deliveries_push_token_idx
on private.class_notification_deliveries (push_token_id)
where push_token_id is not null;

create trigger class_notification_queue_set_updated_at
before update on private.class_notification_queue
for each row execute function private.set_updated_at();

create trigger class_notification_deliveries_set_updated_at
before update on private.class_notification_deliveries
for each row execute function private.set_updated_at();

alter table private.class_notification_queue enable row level security;
alter table private.class_notification_deliveries enable row level security;

create policy class_notification_queue_deny_clients
on private.class_notification_queue
for all
to anon, authenticated
using (false)
with check (false);

create policy class_notification_deliveries_deny_clients
on private.class_notification_deliveries
for all
to anon, authenticated
using (false)
with check (false);

-- The existing midnight job creates the current Manila week. This narrow
-- rolling generator closes the Sunday-to-Monday boundary gap without
-- pre-creating a whole future week: an occurrence is persisted only when it
-- enters a three-hour horizon, just ahead of the longest two-hour reminder.
create function private.generate_imminent_schedule_meetings(
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
      schedule_row.ends_at as local_ends_at
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

-- Materialize the next eight days of logical reminders from persisted
-- meetings. The unique key makes this safe to call every minute. Current
-- eligibility is reconciled on every call, so disabling a meeting, schedule,
-- enrollment, or reminder offset cancels an unsent queue row.
create function private.enqueue_class_notifications(
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer := 0;
begin
  perform private.generate_imminent_schedule_meetings(p_now);

  with desired as (
    select
      meeting_row.id as meeting_id,
      schedule_row.id as schedule_id,
      class_row.teacher_id as user_id,
      'teacher'::text as audience,
      reminder.offset_minutes,
      meeting_row.starts_at
        - pg_catalog.make_interval(mins => reminder.offset_minutes::integer)
        as scheduled_for
    from public.meetings meeting_row
    join public.class_schedules schedule_row
      on schedule_row.id = meeting_row.schedule_id
    join public.classes class_row
      on class_row.id = meeting_row.class_id
    join public.profiles teacher_profile
      on teacher_profile.id = class_row.teacher_id
     and teacher_profile.role = 'teacher'::public.app_role
     and teacher_profile.teacher_approval_status = 'approved'::public.teacher_approval_status
    cross join lateral (
      select distinct configured.offset_minutes
      from pg_catalog.unnest(schedule_row.teacher_reminder_minutes)
        as configured(offset_minutes)
    ) as reminder
    where meeting_row.attendance_enabled
      and schedule_row.is_active
      and meeting_row.starts_at >= p_now - interval '1 day'
      and meeting_row.starts_at < p_now + interval '8 days'
      and meeting_row.starts_at
        - pg_catalog.make_interval(mins => reminder.offset_minutes::integer)
        >= p_now - interval '5 minutes'

    union all

    select
      meeting_row.id,
      schedule_row.id,
      enrollment.student_id,
      'student'::text,
      reminder.offset_minutes,
      meeting_row.starts_at
        - pg_catalog.make_interval(mins => reminder.offset_minutes::integer)
    from public.meetings meeting_row
    join public.class_schedules schedule_row
      on schedule_row.id = meeting_row.schedule_id
    join public.classes class_row
      on class_row.id = meeting_row.class_id
    join public.profiles teacher_profile
      on teacher_profile.id = class_row.teacher_id
     and teacher_profile.role = 'teacher'::public.app_role
     and teacher_profile.teacher_approval_status = 'approved'::public.teacher_approval_status
    join public.class_enrollments enrollment
      on enrollment.class_id = meeting_row.class_id
     and enrollment.is_active
    cross join lateral (
      select distinct configured.offset_minutes
      from pg_catalog.unnest(schedule_row.student_reminder_minutes)
        as configured(offset_minutes)
    ) as reminder
    where meeting_row.attendance_enabled
      and schedule_row.is_active
      and meeting_row.starts_at >= p_now - interval '1 day'
      and meeting_row.starts_at < p_now + interval '8 days'
      and meeting_row.starts_at
        - pg_catalog.make_interval(mins => reminder.offset_minutes::integer)
        >= p_now - interval '5 minutes'
  )
  insert into private.class_notification_queue as queue_row (
    meeting_id,
    schedule_id,
    user_id,
    audience,
    reminder_offset_minutes,
    scheduled_for
  )
  select
    desired.meeting_id,
    desired.schedule_id,
    desired.user_id,
    desired.audience,
    desired.offset_minutes,
    desired.scheduled_for
  from desired
  on conflict (meeting_id, user_id, audience, reminder_offset_minutes)
  do update
  set schedule_id = excluded.schedule_id,
      scheduled_for = case
        when queue_row.state = 'sent' then queue_row.scheduled_for
        else excluded.scheduled_for
      end,
      state = case
        when queue_row.state = 'cancelled' then 'pending'
        else queue_row.state
      end,
      completed_at = case
        when queue_row.state = 'cancelled' then null
        else queue_row.completed_at
      end,
      updated_at = now();

  get diagnostics v_changed = row_count;

  update private.class_notification_queue queue_row
  set state = 'cancelled',
      completed_at = p_now,
      updated_at = now()
  where queue_row.state in ('pending', 'processing', 'failed')
    and (
      queue_row.scheduled_for < p_now - interval '5 minutes'
      or not exists (
        select 1
        from public.meetings meeting_row
        join public.class_schedules schedule_row
          on schedule_row.id = meeting_row.schedule_id
         and schedule_row.id = queue_row.schedule_id
        join public.classes class_row
          on class_row.id = meeting_row.class_id
        join public.profiles teacher_profile
          on teacher_profile.id = class_row.teacher_id
         and teacher_profile.role = 'teacher'::public.app_role
         and teacher_profile.teacher_approval_status = 'approved'::public.teacher_approval_status
        where meeting_row.id = queue_row.meeting_id
          and meeting_row.attendance_enabled
          and schedule_row.is_active
          and (
            (
              queue_row.audience = 'teacher'
              and queue_row.user_id = class_row.teacher_id
              and queue_row.reminder_offset_minutes
                = any(schedule_row.teacher_reminder_minutes)
            )
            or (
              queue_row.audience = 'student'
              and queue_row.reminder_offset_minutes
                = any(schedule_row.student_reminder_minutes)
              and exists (
                select 1
                from public.class_enrollments enrollment
                where enrollment.class_id = meeting_row.class_id
                  and enrollment.student_id = queue_row.user_id
                  and enrollment.is_active
              )
            )
          )
      )
    );

  update private.class_notification_deliveries delivery
  set status = 'cancelled',
      claimed_by = null,
      claimed_at = null,
      last_error = coalesce(delivery.last_error, 'Reminder was cancelled'),
      updated_at = now()
  from private.class_notification_queue queue_row
  where queue_row.id = delivery.queue_id
    and queue_row.state = 'cancelled'
    and delivery.status in ('pending', 'processing', 'failed');

  return v_changed;
end;
$$;

-- Claim work with SKIP LOCKED so overlapping cron invocations cannot process
-- the same device delivery. A five-minute lease recovers interrupted workers.
create function private.claim_due_class_notification_deliveries_impl(
  p_worker_id uuid,
  p_limit integer default 50
)
returns table (
  delivery_id uuid,
  push_token_id uuid,
  token text,
  provider text,
  platform text,
  meeting_id uuid,
  class_id uuid,
  user_id uuid,
  audience text,
  reminder_offset_minutes smallint,
  starts_at timestamptz,
  class_name text,
  class_section text,
  class_timezone text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
  v_claimed_ids uuid[];
begin
  if p_worker_id is null then
    raise exception 'A worker ID is required' using errcode = '22023';
  end if;

  perform private.enqueue_class_notifications(v_now);

  update private.class_notification_deliveries delivery
  set status = 'pending',
      claimed_by = null,
      claimed_at = null,
      next_attempt_at = v_now,
      last_error = coalesce(delivery.last_error, 'Previous worker lease expired'),
      updated_at = now()
  from private.class_notification_queue queue_row
  where queue_row.id = delivery.queue_id
    and queue_row.state <> 'cancelled'
    and delivery.status = 'processing'
    and delivery.claimed_at < v_now - interval '5 minutes';

  -- A deleted, disabled, or differently owned token must never keep a queue
  -- in processing state or be eligible after an account switch.
  update private.class_notification_deliveries delivery
  set status = 'cancelled',
      claimed_by = null,
      claimed_at = null,
      last_error = coalesce(delivery.last_error, 'Push token is no longer active for this recipient'),
      updated_at = now()
  from private.class_notification_queue queue_row
  where queue_row.id = delivery.queue_id
    and delivery.status in ('pending', 'processing', 'failed')
    and not exists (
      select 1
      from public.device_push_tokens token_row
      where token_row.id = delivery.push_token_id
        and token_row.user_id = queue_row.user_id
        and token_row.is_active
        and token_row.provider = 'fcm'
    );

  insert into private.class_notification_deliveries as delivery (
    queue_id,
    push_token_id,
    next_attempt_at
  )
  select
    queue_row.id,
    token_row.id,
    v_now
  from private.class_notification_queue queue_row
  join public.device_push_tokens token_row
    on token_row.user_id = queue_row.user_id
   and token_row.is_active
   and token_row.provider = 'fcm'
  where queue_row.state in ('pending', 'processing')
    and queue_row.scheduled_for <= v_now
    and queue_row.scheduled_for >= v_now - interval '5 minutes'
  on conflict (queue_id, push_token_id) do update
  set status = 'pending',
      attempts = 0,
      next_attempt_at = excluded.next_attempt_at,
      claimed_by = null,
      claimed_at = null,
      sent_at = null,
      provider_message_id = null,
      last_error = null,
      updated_at = now()
  where delivery.status = 'cancelled';

  with candidates as (
    select delivery.id
    from private.class_notification_deliveries delivery
    join private.class_notification_queue queue_row
      on queue_row.id = delivery.queue_id
    join public.device_push_tokens token_row
      on token_row.id = delivery.push_token_id
     and token_row.user_id = queue_row.user_id
     and token_row.is_active
     and token_row.provider = 'fcm'
    where delivery.status = 'pending'
      and delivery.attempts < 5
      and delivery.next_attempt_at <= v_now
      and delivery.push_token_id is not null
      and queue_row.state in ('pending', 'processing')
      and queue_row.scheduled_for <= v_now
      and queue_row.scheduled_for >= v_now - interval '5 minutes'
    order by queue_row.scheduled_for, delivery.created_at, delivery.id
    for update of delivery skip locked
    limit least(greatest(coalesce(p_limit, 50), 1), 250)
  ), claimed as (
    update private.class_notification_deliveries delivery
    set status = 'processing',
        attempts = delivery.attempts + 1,
        claimed_by = p_worker_id,
        claimed_at = v_now,
        updated_at = now()
    from candidates
    where delivery.id = candidates.id
    returning delivery.id
  )
  select pg_catalog.array_agg(claimed.id)
  into v_claimed_ids
  from claimed;

  if coalesce(cardinality(v_claimed_ids), 0) = 0 then
    return;
  end if;

  update private.class_notification_queue queue_row
  set state = 'processing',
      completed_at = null,
      updated_at = now()
  where exists (
    select 1
    from private.class_notification_deliveries delivery
    where delivery.queue_id = queue_row.id
      and delivery.id = any(v_claimed_ids)
  );

  return query
  select
    delivery.id,
    token_row.id,
    token_row.token,
    token_row.provider,
    token_row.platform,
    queue_row.meeting_id,
    meeting_row.class_id,
    queue_row.user_id,
    queue_row.audience,
    queue_row.reminder_offset_minutes,
    meeting_row.starts_at,
    class_row.name,
    class_row.section,
    class_row.timezone
  from private.class_notification_deliveries delivery
  join private.class_notification_queue queue_row
    on queue_row.id = delivery.queue_id
  join public.device_push_tokens token_row
    on token_row.id = delivery.push_token_id
   and token_row.user_id = queue_row.user_id
   and token_row.is_active
   and token_row.provider = 'fcm'
  join public.meetings meeting_row
    on meeting_row.id = queue_row.meeting_id
  join public.classes class_row
    on class_row.id = meeting_row.class_id
  where delivery.id = any(v_claimed_ids)
  order by queue_row.scheduled_for, delivery.created_at, delivery.id;
end;
$$;

create function public.claim_due_class_notification_deliveries(
  p_worker_id uuid,
  p_limit integer default 50
)
returns table (
  delivery_id uuid,
  push_token_id uuid,
  token text,
  provider text,
  platform text,
  meeting_id uuid,
  class_id uuid,
  user_id uuid,
  audience text,
  reminder_offset_minutes smallint,
  starts_at timestamptz,
  class_name text,
  class_section text,
  class_timezone text
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.claim_due_class_notification_deliveries_impl(
    p_worker_id,
    p_limit
  )
$$;

create function private.mark_class_notification_delivery_impl(
  p_delivery_id uuid,
  p_worker_id uuid,
  p_succeeded boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_disable_token boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queue_id uuid;
  v_push_token_id uuid;
  v_rows integer := 0;
  v_queue_state text;
begin
  update private.class_notification_deliveries delivery
  set status = case
        when p_succeeded then 'sent'
        when delivery.attempts >= 5 then 'failed'
        else 'pending'
      end,
      next_attempt_at = case
        when p_succeeded or delivery.attempts >= 5 then delivery.next_attempt_at
        else now() + pg_catalog.make_interval(
          mins => least(
            30,
            pg_catalog.power(2, greatest(delivery.attempts - 1, 0))::integer
          )
        )
      end,
      claimed_by = null,
      claimed_at = null,
      sent_at = case when p_succeeded then now() else null end,
      provider_message_id = case
        when p_succeeded then left(nullif(btrim(p_provider_message_id), ''), 1000)
        else null
      end,
      last_error = case
        when p_succeeded then null
        else left(coalesce(nullif(btrim(p_error), ''), 'Push delivery failed'), 2000)
      end,
      updated_at = now()
  where delivery.id = p_delivery_id
    and delivery.status = 'processing'
    and delivery.claimed_by = p_worker_id
  returning delivery.queue_id, delivery.push_token_id
  into v_queue_id, v_push_token_id;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return false;
  end if;

  if p_disable_token and v_push_token_id is not null then
    update public.device_push_tokens token_row
    set is_active = false,
        disabled_at = now(),
        updated_at = now()
    where token_row.id = v_push_token_id;

    update private.class_notification_deliveries delivery
    set status = 'cancelled',
        claimed_by = null,
        claimed_at = null,
        last_error = coalesce(delivery.last_error, 'Push token is no longer registered'),
        updated_at = now()
    where delivery.push_token_id = v_push_token_id
      and delivery.status in ('pending', 'processing');
  end if;

  select case
    when exists (
      select 1
      from private.class_notification_deliveries delivery
      where delivery.queue_id = v_queue_id
        and delivery.status in ('pending', 'processing')
    ) then 'processing'
    when exists (
      select 1
      from private.class_notification_deliveries delivery
      where delivery.queue_id = v_queue_id
        and delivery.status = 'sent'
    ) then 'sent'
    when exists (
      select 1
      from private.class_notification_deliveries delivery
      where delivery.queue_id = v_queue_id
        and delivery.status = 'failed'
    ) then 'failed'
    else 'pending'
  end
  into v_queue_state;

  update private.class_notification_queue queue_row
  set state = case
        when queue_row.state = 'cancelled' then 'cancelled'
        else v_queue_state
      end,
      completed_at = case
        when queue_row.state = 'cancelled'
          or v_queue_state in ('sent', 'failed') then now()
        else null
      end,
      updated_at = now()
  where queue_row.id = v_queue_id;

  return true;
end;
$$;

create function public.mark_class_notification_delivery(
  p_delivery_id uuid,
  p_worker_id uuid,
  p_succeeded boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_disable_token boolean default false
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  select private.mark_class_notification_delivery_impl(
    p_delivery_id,
    p_worker_id,
    p_succeeded,
    p_provider_message_id,
    p_error,
    p_disable_token
  )
$$;

-- Explicit Data API privileges. RLS remains the row-level authorization
-- layer, and anonymous clients receive no notification access.
revoke all on table public.device_push_tokens from public, anon, authenticated;
grant select, delete on table public.device_push_tokens to authenticated;
grant all on table public.device_push_tokens to service_role;

revoke all on table private.class_notification_queue
from public, anon, authenticated;
revoke all on table private.class_notification_deliveries
from public, anon, authenticated;
grant all on table private.class_notification_queue to service_role;
grant all on table private.class_notification_deliveries to service_role;

revoke all on function private.register_device_push_token_impl(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function private.register_device_push_token_impl(uuid, text, text, text)
to authenticated;
revoke all on function public.register_device_push_token(uuid, text, text, text)
from public, anon, authenticated;
grant execute on function public.register_device_push_token(uuid, text, text, text)
to authenticated;

revoke all on function private.unregister_device_push_token_impl(uuid)
from public, anon, authenticated;
grant execute on function private.unregister_device_push_token_impl(uuid)
to authenticated;
revoke all on function public.unregister_device_push_token(uuid)
from public, anon, authenticated;
grant execute on function public.unregister_device_push_token(uuid)
to authenticated;

revoke all on function private.generate_imminent_schedule_meetings(timestamptz)
from public, anon, authenticated;
grant execute on function private.generate_imminent_schedule_meetings(timestamptz)
to service_role;

revoke all on function private.enqueue_class_notifications(timestamptz)
from public, anon, authenticated;
grant execute on function private.enqueue_class_notifications(timestamptz)
to service_role;

revoke all on function private.claim_due_class_notification_deliveries_impl(uuid, integer)
from public, anon, authenticated;
grant execute on function private.claim_due_class_notification_deliveries_impl(uuid, integer)
to service_role;
revoke all on function public.claim_due_class_notification_deliveries(uuid, integer)
from public, anon, authenticated;
grant execute on function public.claim_due_class_notification_deliveries(uuid, integer)
to service_role;

revoke all on function private.mark_class_notification_delivery_impl(uuid, uuid, boolean, text, text, boolean)
from public, anon, authenticated;
grant execute on function private.mark_class_notification_delivery_impl(uuid, uuid, boolean, text, text, boolean)
to service_role;
revoke all on function public.mark_class_notification_delivery(uuid, uuid, boolean, text, text, boolean)
from public, anon, authenticated;
grant execute on function public.mark_class_notification_delivery(uuid, uuid, boolean, text, text, boolean)
to service_role;
