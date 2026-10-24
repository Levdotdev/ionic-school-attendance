-- The output parameter push_token_id clashes with an unqualified ON CONFLICT
-- column. Naming the existing unique constraint removes the ambiguity while
-- retaining the service-role-only grants and all delivery/cancellation checks.
create or replace function private.claim_due_class_notification_deliveries_impl(
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
  on conflict on constraint class_notification_deliveries_queue_id_push_token_id_key do update
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
