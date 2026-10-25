-- Prospective, service-only alerts. No existing attendance or pending teacher
-- registrations are replayed when this migration is installed.
create table private.activity_alert_settings (
  singleton boolean primary key default true check(singleton),
  enabled_from timestamptz not null default now()
);
insert into private.activity_alert_settings(singleton) values(true);
create table private.attendance_alert_state (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check(status in('present','absent')),
  revision integer not null default 1 check(revision>0),
  changed_at timestamptz not null default now(),
  primary key(meeting_id,student_id)
);
create table private.activity_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_key text not null check(char_length(event_key)<=250),
  kind text not null check(kind in('attendance','teacher_request','teacher_decision')),
  subject_id uuid not null references public.profiles(id) on delete cascade,
  meeting_id uuid references public.meetings(id) on delete cascade,
  status text not null check(status in('present','absent','pending','approved','rejected')),
  revision integer,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  audience text not null check(audience in('student','parent','teacher','admin')),
  channel text not null check(channel in('email','push')),
  push_token_id uuid references public.device_push_tokens(id) on delete cascade,
  created_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempts integer not null default 0 check(attempts>=0),
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  provider_message_id text check(provider_message_id is null or char_length(provider_message_id)<=250),
  check((channel='email' and push_token_id is null) or(channel='push' and push_token_id is not null)),
  check((lease_token is null)=(lease_expires_at is null)),
  unique nulls not distinct(event_key,recipient_id,channel,push_token_id)
);
create index activity_alert_deliveries_due_idx on private.activity_alert_deliveries(next_attempt_at,created_at,id)
  where completed_at is null and cancelled_at is null;
create index activity_alert_deliveries_subject_idx on private.activity_alert_deliveries(subject_id,kind,meeting_id)
  where completed_at is null and cancelled_at is null;
create index activity_alert_deliveries_recipient_idx on private.activity_alert_deliveries(recipient_id);
create index activity_alert_deliveries_token_idx on private.activity_alert_deliveries(push_token_id) where push_token_id is not null;
create index meetings_activity_alert_closed_idx on public.meetings(ends_at,attendance_closes_at,id) where attendance_enabled;
alter table private.activity_alert_settings enable row level security;
alter table private.attendance_alert_state enable row level security;
alter table private.activity_alert_deliveries enable row level security;
create policy activity_alert_settings_deny_clients on private.activity_alert_settings for all to public using(false) with check(false);
create policy attendance_alert_state_deny_clients on private.attendance_alert_state for all to public using(false) with check(false);
create policy activity_alert_deliveries_deny_clients on private.activity_alert_deliveries for all to public using(false) with check(false);
revoke all on private.activity_alert_settings,private.attendance_alert_state,private.activity_alert_deliveries from public,anon,authenticated;
grant all on private.activity_alert_settings,private.attendance_alert_state,private.activity_alert_deliveries to service_role;

create function private.add_activity_alert(p_event text,p_kind text,p_subject uuid,p_meeting uuid,p_status text,p_revision integer,p_recipient uuid,p_audience text,p_channel text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_channel='email' then
    insert into private.activity_alert_deliveries(event_key,kind,subject_id,meeting_id,status,revision,recipient_id,audience,channel)
      values(p_event,p_kind,p_subject,p_meeting,p_status,p_revision,p_recipient,p_audience,'email') on conflict do nothing;
  else
    insert into private.activity_alert_deliveries(event_key,kind,subject_id,meeting_id,status,revision,recipient_id,audience,channel,push_token_id)
      select p_event,p_kind,p_subject,p_meeting,p_status,p_revision,p_recipient,p_audience,'push',t.id
      from public.device_push_tokens t where t.user_id=p_recipient and t.is_active and t.provider='fcm' and t.platform='android'
      on conflict do nothing;
  end if;
end; $$;

create function private.enqueue_attendance_alert(p_meeting uuid,p_student uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare v_state private.attendance_alert_state%rowtype; v_parent uuid; v_event text;
begin
  if p_status not in('present','absent') or not exists(
    select 1 from public.meetings m join public.classes c on c.id=m.class_id
    where m.id=p_meeting and m.attendance_enabled and c.archived_at is null
      and not exists(select 1 from private.class_archive_periods x where x.class_id=c.id
        and(x.restored_at is null or x.restored_at>x.archived_at) and m.ends_at>x.archived_at
        and(x.restored_at is null or m.starts_at<x.restored_at))) then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('attendance-alert:'||p_meeting::text||':'||p_student::text,0));
  select * into v_state from private.attendance_alert_state s where s.meeting_id=p_meeting and s.student_id=p_student for update;
  if found and v_state.status=p_status then return; end if;
  insert into private.attendance_alert_state as s(meeting_id,student_id,status)
    values(p_meeting,p_student,p_status) on conflict(meeting_id,student_id) do update
      set status=excluded.status,revision=s.revision+1,changed_at=now() returning * into v_state;
  update private.activity_alert_deliveries set cancelled_at=now()
    where kind='attendance' and meeting_id=p_meeting and subject_id=p_student and completed_at is null and cancelled_at is null;
  v_event:='attendance:'||p_meeting::text||':'||p_student::text||':'||v_state.revision::text;
  perform private.add_activity_alert(v_event,'attendance',p_student,p_meeting,p_status,v_state.revision,p_student,'student','push');
  for v_parent in select g.parent_id from public.guardian_links g
    join public.guardian_link_requests r on r.student_id=g.student_id and r.parent_id=g.parent_id and r.status='approved'
    join public.profiles p on p.id=g.parent_id and p.role='parent' and p.onboarding_completed_at is not null
    join auth.users u on u.id=p.id and u.email_confirmed_at is not null
    where g.student_id=p_student and lower(u.email)=g.verified_guardian_email and lower(u.email)=r.parent_email
  loop
    perform private.add_activity_alert(v_event,'attendance',p_student,p_meeting,p_status,v_state.revision,v_parent,'parent','push');
    perform private.add_activity_alert(v_event,'attendance',p_student,p_meeting,p_status,v_state.revision,v_parent,'parent','email');
  end loop;
end; $$;

create function private.attendance_activity_alert_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_status text;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.meetings m where m.id=old.meeting_id and m.ends_at<=now()
      and(m.attendance_mode='teacher_manual' or m.attendance_closes_at<=now())) then
      perform private.enqueue_attendance_alert(old.meeting_id,old.student_id,'absent');
    else
      delete from private.attendance_alert_state where meeting_id=old.meeting_id and student_id=old.student_id;
      update private.activity_alert_deliveries set cancelled_at=now() where kind='attendance'
        and meeting_id=old.meeting_id and subject_id=old.student_id and completed_at is null and cancelled_at is null;
    end if;
    return old;
  end if;
  if tg_op='UPDATE' and new.status is not distinct from old.status and new.verification_status is not distinct from old.verification_status then return new; end if;
  v_status:=case when new.status='present' and new.verification_status is distinct from 'rejected'::public.attendance_verification_status then 'present' else 'absent' end;
  perform private.enqueue_attendance_alert(new.meeting_id,new.student_id,v_status);
  return new;
end; $$;
create trigger attendance_activity_alert_changed after insert or update of status,verification_status or delete on public.attendance_records
  for each row execute function private.attendance_activity_alert_changed();

create function private.teacher_activity_alert_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_admin uuid; v_event text;
begin
  if new.role<>'teacher' or new.onboarding_completed_at is null then return new; end if;
  if tg_op='UPDATE' and old.role='teacher' and old.onboarding_completed_at is not null and new.teacher_approval_status is not distinct from old.teacher_approval_status then return new; end if;
  update private.activity_alert_deliveries set cancelled_at=now() where kind in('teacher_request','teacher_decision')
    and subject_id=new.id and completed_at is null and cancelled_at is null;
  v_event:='teacher:'||new.id::text||':'||gen_random_uuid()::text;
  if new.teacher_approval_status='pending' then
    for v_admin in select p.id from public.profiles p join auth.users u on u.id=p.id
      where p.role='admin' and p.onboarding_completed_at is not null and u.email_confirmed_at is not null
    loop perform private.add_activity_alert(v_event,'teacher_request',new.id,null,'pending',null,v_admin,'admin','email'); end loop;
  elsif new.teacher_approval_status in('approved','rejected') then
    perform private.add_activity_alert(v_event,'teacher_decision',new.id,null,new.teacher_approval_status::text,null,new.id,'teacher','email');
  end if;
  return new;
end; $$;
create trigger teacher_activity_alert_changed after insert or update of role,onboarding_completed_at,teacher_approval_status on public.profiles
  for each row execute function private.teacher_activity_alert_changed();

create function private.enqueue_closed_attendance_alerts()
returns integer language plpgsql security definer set search_path='' as $$
declare v_row record; v_count integer:=0; v_enabled_from timestamptz;
begin
  select enabled_from into v_enabled_from from private.activity_alert_settings where singleton;
  for v_row in select m.id,e.student_id from public.meetings m join public.classes c on c.id=m.class_id
    join public.class_enrollments e on e.class_id=m.class_id and e.is_active and e.joined_at<=m.ends_at
    where m.attendance_enabled and c.archived_at is null and m.ends_at<=now()
      and(m.attendance_mode='teacher_manual' or m.attendance_closes_at<=now())
      and greatest(m.ends_at,case when m.attendance_mode='teacher_manual' then m.ends_at else m.attendance_closes_at end)>=v_enabled_from
      and not exists(select 1 from public.attendance_records a where a.meeting_id=m.id and a.student_id=e.student_id)
      and not exists(select 1 from private.attendance_alert_state s where s.meeting_id=m.id and s.student_id=e.student_id)
      and exists(select 1 from private.class_enrollment_periods ep where ep.class_id=m.class_id and ep.student_id=e.student_id
        and ep.enrolled_at<=m.ends_at and(ep.withdrawn_at is null or ep.withdrawn_at>=m.ends_at))
      and not exists(select 1 from private.class_archive_periods x where x.class_id=c.id and(x.restored_at is null or x.restored_at>x.archived_at)
        and m.ends_at>x.archived_at and(x.restored_at is null or m.starts_at<x.restored_at))
    order by m.ends_at,m.id,e.student_id limit 500
  loop
    perform private.enqueue_attendance_alert(v_row.id,v_row.student_id,'absent'); v_count:=v_count+1;
  end loop;
  return v_count;
end; $$;

-- Revalidate immediately before delivery; a changed email is read from Auth,
-- never from an outbox snapshot. Revoked consent/device ownership cancels work.
create function private.activity_alert_is_authorized(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select recipient.onboarding_completed_at is not null and recipient.role::text=d.audience and u.email_confirmed_at is not null
    and(d.channel='email' or exists(select 1 from public.device_push_tokens t where t.id=d.push_token_id
      and t.user_id=d.recipient_id and t.is_active and t.provider='fcm' and t.platform='android'))
    and case when d.kind='attendance' then
      subject.role='student' and exists(select 1 from public.meetings m join public.classes c on c.id=m.class_id
        where m.id=d.meeting_id and m.attendance_enabled and c.archived_at is null
        and not exists(select 1 from private.class_archive_periods x where x.class_id=c.id
          and(x.restored_at is null or x.restored_at>x.archived_at) and m.ends_at>x.archived_at and(x.restored_at is null or m.starts_at<x.restored_at)))
      and exists(select 1 from private.attendance_alert_state s where s.meeting_id=d.meeting_id and s.student_id=d.subject_id and s.status=d.status and s.revision=d.revision)
      and(d.audience='student' and d.recipient_id=d.subject_id or d.audience='parent' and exists(
        select 1 from public.guardian_links g join public.guardian_link_requests r on r.parent_id=g.parent_id and r.student_id=g.student_id and r.status='approved'
        where g.parent_id=d.recipient_id and g.student_id=d.subject_id and lower(u.email)=g.verified_guardian_email and lower(u.email)=r.parent_email))
    when d.kind='teacher_request' then d.audience='admin' and subject.role='teacher' and subject.onboarding_completed_at is not null and subject.teacher_approval_status='pending'
    else d.audience='teacher' and d.recipient_id=d.subject_id and subject.role='teacher' and subject.teacher_approval_status::text=d.status end
    from private.activity_alert_deliveries d join public.profiles recipient on recipient.id=d.recipient_id
    join auth.users u on u.id=recipient.id join public.profiles subject on subject.id=d.subject_id where d.id=p_id),false)
$$;

create function private.claim_activity_alert_deliveries_impl(p_limit integer)
returns table(id uuid,lease_token uuid) language plpgsql security definer set search_path='' as $$
declare v_token uuid:=gen_random_uuid();
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'Alert batch must contain 1 to 50 deliveries' using errcode='22023'; end if;
  perform private.enqueue_closed_attendance_alerts();
  -- At most one day of retrying a transient outage; old activity is available
  -- in the portal and should never produce a delayed mailbox flood.
  with stale as(select d.id from private.activity_alert_deliveries d where d.completed_at is null and d.cancelled_at is null
    and(d.created_at<now()-interval '1 day' or not private.activity_alert_is_authorized(d.id))
    order by d.created_at,d.id limit 500 for update skip locked)
  update private.activity_alert_deliveries d set cancelled_at=now() from stale s where d.id=s.id;
  return query with ready as(select d.id from private.activity_alert_deliveries d where d.completed_at is null and d.cancelled_at is null
    and d.next_attempt_at<=now() and(d.lease_expires_at is null or d.lease_expires_at<=now()) and d.attempts<12
    and private.activity_alert_is_authorized(d.id) order by d.created_at,d.id limit p_limit for update skip locked)
  update private.activity_alert_deliveries d set lease_token=v_token,lease_expires_at=now()+interval '2 minutes',attempts=d.attempts+1
    from ready r where d.id=r.id returning d.id,d.lease_token;
end; $$;
create function public.claim_activity_alert_deliveries(p_limit integer default 25)
returns table(id uuid,lease_token uuid) language sql security invoker set search_path='' as $$
  select * from private.claim_activity_alert_deliveries_impl(p_limit)
$$;

create function private.resolve_activity_alert_delivery_impl(p_id uuid,p_lease_token uuid)
returns table(id uuid,channel text,kind text,audience text,status text,recipient_email text,push_token text,
  subject_name text,class_name text,meeting_starts_at timestamptz,decision_note text)
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from private.activity_alert_deliveries d where d.id=p_id and d.lease_token=p_lease_token
    and d.lease_expires_at>now() and d.completed_at is null and d.cancelled_at is null) then return; end if;
  if not private.activity_alert_is_authorized(p_id) then
    update private.activity_alert_deliveries d set cancelled_at=now() where d.id=p_id and d.lease_token=p_lease_token; return; end if;
  return query select d.id,d.channel,d.kind,d.audience,d.status,lower(u.email)::text,t.token,s.full_name,c.name,m.starts_at,
    case when d.kind='teacher_decision' then s.teacher_approval_note else null end
    from private.activity_alert_deliveries d join auth.users u on u.id=d.recipient_id join public.profiles s on s.id=d.subject_id
    left join public.device_push_tokens t on t.id=d.push_token_id left join public.meetings m on m.id=d.meeting_id
    left join public.classes c on c.id=m.class_id where d.id=p_id;
end; $$;
create function public.resolve_activity_alert_delivery(p_id uuid,p_lease_token uuid)
returns table(id uuid,channel text,kind text,audience text,status text,recipient_email text,push_token text,
  subject_name text,class_name text,meeting_starts_at timestamptz,decision_note text)
language sql security invoker set search_path='' as $$ select * from private.resolve_activity_alert_delivery_impl(p_id,p_lease_token) $$;

create function private.complete_activity_alert_delivery_impl(p_id uuid,p_lease_token uuid,p_succeeded boolean,p_provider_message_id text,p_disable_token boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_delivery private.activity_alert_deliveries%rowtype;
begin
  if p_succeeded is null or p_disable_token is null or char_length(coalesce(p_provider_message_id,''))>250 then
    raise exception 'Invalid delivery completion' using errcode='22023'; end if;
  select * into v_delivery from private.activity_alert_deliveries d where d.id=p_id and d.lease_token=p_lease_token
    and d.lease_expires_at>now() and d.completed_at is null and d.cancelled_at is null for update;
  if not found then return false; end if;
  if p_disable_token and not p_succeeded and v_delivery.push_token_id is not null then
    update public.device_push_tokens set is_active=false,disabled_at=now() where id=v_delivery.push_token_id and user_id=v_delivery.recipient_id;
  end if;
  update private.activity_alert_deliveries d set lease_token=null,lease_expires_at=null,
    completed_at=case when p_succeeded then now() else null end,
    cancelled_at=case when not p_succeeded and(p_disable_token or d.attempts>=12) then now() else d.cancelled_at end,
    next_attempt_at=now()+make_interval(secs=>least(3600,30*d.attempts*d.attempts)),
    provider_message_id=case when p_succeeded then p_provider_message_id else null end where d.id=p_id;
  return true;
end; $$;
create function public.complete_activity_alert_delivery(p_id uuid,p_lease_token uuid,p_succeeded boolean,p_provider_message_id text default null,p_disable_token boolean default false)
returns boolean language sql security invoker set search_path='' as $$
  select private.complete_activity_alert_delivery_impl(p_id,p_lease_token,p_succeeded,p_provider_message_id,p_disable_token)
$$;

revoke all on function private.add_activity_alert(text,text,uuid,uuid,text,integer,uuid,text,text),private.enqueue_attendance_alert(uuid,uuid,text),
  private.attendance_activity_alert_changed(),private.teacher_activity_alert_changed(),private.enqueue_closed_attendance_alerts(),private.activity_alert_is_authorized(uuid),
  private.claim_activity_alert_deliveries_impl(integer),public.claim_activity_alert_deliveries(integer),
  private.resolve_activity_alert_delivery_impl(uuid,uuid),public.resolve_activity_alert_delivery(uuid,uuid),
  private.complete_activity_alert_delivery_impl(uuid,uuid,boolean,text,boolean),public.complete_activity_alert_delivery(uuid,uuid,boolean,text,boolean)
  from public,anon,authenticated;
grant execute on function private.claim_activity_alert_deliveries_impl(integer),public.claim_activity_alert_deliveries(integer),
  private.resolve_activity_alert_delivery_impl(uuid,uuid),public.resolve_activity_alert_delivery(uuid,uuid),
  private.complete_activity_alert_delivery_impl(uuid,uuid,boolean,text,boolean),public.complete_activity_alert_delivery(uuid,uuid,boolean,text,boolean) to service_role;
