-- A weekly schedule owns every occurrence generated from it. Additional
-- meetings have no schedule_id and are intentionally outside this cascade.
alter table public.meetings drop constraint meetings_schedule_id_fkey;
alter table public.meetings add constraint meetings_schedule_id_fkey
  foreign key(schedule_id) references public.class_schedules(id) on delete cascade;

create function private.guard_weekly_schedule_deletion()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_archived_at timestamptz;
begin
  -- RLS already restricts direct client deletes to the approved class owner.
  -- The class may itself be disappearing during its authorized FK cascade.
  if (select auth.uid()) is not null then
    select c.archived_at into v_archived_at from public.classes c
      where c.id=old.class_id for share;
    if found and v_archived_at is not null then
      raise exception 'Restore the archived class before deleting its weekly schedule' using errcode='22023';
    end if;
  end if;
  return old;
end; $$;
revoke all on function private.guard_weekly_schedule_deletion() from public,anon,authenticated;
create trigger class_schedules_guard_deletion before delete on public.class_schedules
  for each row execute function private.guard_weekly_schedule_deletion();

-- A class/profile cascade removes its enrollment periods itself. Updating a
-- period after that parent row disappears would fail the period's foreign key.
create or replace function private.track_class_enrollment_period()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.classes c where c.id=old.class_id)
      and exists(select 1 from public.profiles p where p.id=old.student_id) then
      update private.class_enrollment_periods set withdrawn_at=greatest(now(),enrolled_at)
        where class_id=old.class_id and student_id=old.student_id and withdrawn_at is null;
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and old.is_active and (not new.is_active or new.class_id<>old.class_id or new.student_id<>old.student_id) then
    update private.class_enrollment_periods set withdrawn_at=greatest(now(),enrolled_at)
      where class_id=old.class_id and student_id=old.student_id and withdrawn_at is null;
  end if;
  if new.is_active and (tg_op='INSERT' or not old.is_active or new.class_id<>old.class_id or new.student_id<>old.student_id) then
    if tg_op='UPDATE' then new.joined_at:=now(); end if;
    insert into private.class_enrollment_periods(class_id,student_id,enrolled_at)
      values(new.class_id,new.student_id,new.joined_at) on conflict(class_id,student_id) where withdrawn_at is null do nothing;
  end if;
  return new;
end; $$;

-- File bytes must be deleted through Storage API, never through storage.objects
-- SQL. The outbox survives the attendance row, meeting, class and user so a
-- temporary Storage failure does not leave permanently unreachable photos.
create table private.attendance_photo_deletions (
  id uuid primary key default gen_random_uuid(),
  object_path text not null unique,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0 check(attempts>=0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  check((lease_token is null)=(lease_expires_at is null))
);
create index attendance_photo_deletions_due_idx
  on private.attendance_photo_deletions(next_attempt_at,queued_at,id);
create index attendance_records_selfie_path_idx on public.attendance_records(selfie_path) where selfie_path is not null;
alter table private.attendance_photo_deletions enable row level security;
create policy attendance_photo_deletions_deny_clients on private.attendance_photo_deletions
  for all to public using(false) with check(false);
revoke all on private.attendance_photo_deletions from public,anon,authenticated;
grant all on private.attendance_photo_deletions to service_role;

create function private.safe_attendance_photo_path(p_path text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(char_length(p_path)<=1024 and position('..' in p_path)=0 and p_path~*
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[a-z0-9][a-z0-9._-]{0,254}$',false)
$$;
revoke all on function private.safe_attendance_photo_path(text) from public,anon,authenticated;

create function private.queue_deleted_attendance_photo()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if private.safe_attendance_photo_path(old.selfie_path) then
    insert into private.attendance_photo_deletions(object_path) values(old.selfie_path)
      on conflict(object_path) do nothing;
  end if;
  return old;
end; $$;
revoke all on function private.queue_deleted_attendance_photo() from public,anon,authenticated;
create trigger attendance_records_queue_deleted_photo after delete on public.attendance_records
  for each row execute function private.queue_deleted_attendance_photo();

-- Repair occurrences detached by the former ON DELETE SET NULL behavior.
-- A retained recurrence-week identity distinguishes these from independently
-- created additional meetings, whose schedule_week_start is NULL.
delete from public.meetings where schedule_id is null and schedule_week_start is not null;

create function private.claim_attendance_photo_deletions_impl(p_limit integer)
returns table(id uuid,object_path text,lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare v_token uuid:=gen_random_uuid();
begin
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Photo cleanup batch must contain 1 to 100 objects' using errcode='22023'; end if;
  -- Do not remove a path that still backs a surviving attendance row. Drop
  -- invalid/stale requests in bounded batches without ever returning them.
  with discarded as (
    select q.id from private.attendance_photo_deletions q
    where (q.lease_expires_at is null or q.lease_expires_at<=now())
      and (not private.safe_attendance_photo_path(q.object_path)
        or exists(select 1 from public.attendance_records a where a.selfie_path=q.object_path))
    order by q.queued_at,q.id limit p_limit for update skip locked
  ) delete from private.attendance_photo_deletions q using discarded d where q.id=d.id;
  return query with candidates as (
    select q.id from private.attendance_photo_deletions q
    where q.next_attempt_at<=now() and (q.lease_expires_at is null or q.lease_expires_at<=now())
      and private.safe_attendance_photo_path(q.object_path)
      and not exists(select 1 from public.attendance_records a where a.selfie_path=q.object_path)
    order by q.queued_at,q.id limit p_limit for update skip locked
  ) update private.attendance_photo_deletions q set lease_token=v_token,
      lease_expires_at=now()+interval '5 minutes',attempts=q.attempts+1
    from candidates c where q.id=c.id returning q.id,q.object_path,q.lease_token;
end; $$;
create function public.claim_attendance_photo_deletions(p_limit integer default 100)
returns table(id uuid,object_path text,lease_token uuid)
language sql security invoker set search_path='' as $$
  select * from private.claim_attendance_photo_deletions_impl(p_limit)
$$;

create function private.complete_attendance_photo_deletions_impl(p_ids uuid[],p_lease_token uuid,p_deleted boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  if p_ids is null or cardinality(p_ids) not between 1 and 100 or p_lease_token is null or p_deleted is null then
    raise exception 'Complete a bounded cleanup batch with its lease token' using errcode='22023'; end if;
  if p_deleted then
    delete from private.attendance_photo_deletions q where q.id=any(p_ids) and q.lease_token=p_lease_token;
  else
    update private.attendance_photo_deletions q set lease_token=null,lease_expires_at=null,
      next_attempt_at=now()+make_interval(secs=>least(3600,greatest(30,30*q.attempts)))
      where q.id=any(p_ids) and q.lease_token=p_lease_token;
  end if;
  get diagnostics v_count=row_count;
  return v_count;
end; $$;
create function public.complete_attendance_photo_deletions(p_ids uuid[],p_lease_token uuid,p_deleted boolean)
returns integer language sql security invoker set search_path='' as $$
  select private.complete_attendance_photo_deletions_impl(p_ids,p_lease_token,p_deleted)
$$;
revoke all on function private.claim_attendance_photo_deletions_impl(integer),public.claim_attendance_photo_deletions(integer),
  private.complete_attendance_photo_deletions_impl(uuid[],uuid,boolean),public.complete_attendance_photo_deletions(uuid[],uuid,boolean)
  from public,anon,authenticated;
grant execute on function private.claim_attendance_photo_deletions_impl(integer),public.claim_attendance_photo_deletions(integer),
  private.complete_attendance_photo_deletions_impl(uuid[],uuid,boolean),public.complete_attendance_photo_deletions(uuid[],uuid,boolean)
  to service_role;

comment on table private.attendance_photo_deletions is
  'Service-only Storage API deletion outbox for attendance-selfies; contains no location or face template data.';
