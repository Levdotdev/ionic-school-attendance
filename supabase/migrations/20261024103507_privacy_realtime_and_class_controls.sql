-- Course lifecycle, student-owned reminders, private online locations, locked
-- face enrollment, avatars and recipient-only realtime invalidation.
alter table public.classes add column archived_at timestamptz;
alter table public.class_schedules
  add column check_in_minutes_after_start smallint,
  add constraint class_schedules_check_in_end_range check (
    check_in_minutes_after_start is null or check_in_minutes_after_start between 1 and 1440
  );
comment on column public.class_schedules.check_in_minutes_after_start is
  'Null closes check-in at class end; otherwise closes this many minutes after class starts.';

alter table public.profiles add column avatar_path text
  check (avatar_path is null or (
    avatar_path like id::text || '/%'
    and avatar_path not like '%..%'
    and avatar_path not like '%\\%'
    and char_length(avatar_path) <= 1024
  ));
grant update (avatar_path) on public.profiles to authenticated;
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('profile-avatars', 'profile-avatars', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy profile_avatars_owner_select on storage.objects for select to authenticated
  using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy profile_avatars_owner_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
    and name not like '%..%' and storage.extension(name) in ('jpg','jpeg','png','webp'));
create policy profile_avatars_owner_update on storage.objects for update to authenticated
  using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text
    and name not like '%..%' and storage.extension(name) in ('jpg','jpeg','png','webp'));
create policy profile_avatars_owner_delete on storage.objects for delete to authenticated
  using (bucket_id = 'profile-avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create table public.student_schedule_notification_preferences (
  schedule_id uuid not null references public.class_schedules(id) on delete cascade,
  student_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  reminder_minutes smallint[] not null default array[120,60,30,15,5,0]::smallint[],
  updated_at timestamptz not null default now(),
  primary key (schedule_id, student_id),
  constraint student_schedule_preferences_offsets check (
    reminder_minutes <@ array[120,60,30,15,5,0]::smallint[]
    and array_position(reminder_minutes, null) is null
    and cardinality(reminder_minutes) <= 6
  )
);
create index student_schedule_preferences_student_idx
  on public.student_schedule_notification_preferences(student_id);
alter table public.student_schedule_notification_preferences enable row level security;
create policy student_schedule_preferences_select on public.student_schedule_notification_preferences
  for select to authenticated using (student_id = (select auth.uid()));
create policy student_schedule_preferences_write on public.student_schedule_notification_preferences
  for insert to authenticated with check (
    student_id = (select auth.uid()) and (select private.current_profile_role()) = 'student'
    and exists (select 1 from public.class_schedules s join public.class_enrollments e on e.class_id = s.class_id
      join public.classes c on c.id = s.class_id
      where s.id = schedule_id and e.student_id = (select auth.uid()) and e.is_active and c.archived_at is null)
  );
create policy student_schedule_preferences_update on public.student_schedule_notification_preferences
  for update to authenticated using (student_id = (select auth.uid())) with check (
    student_id = (select auth.uid()) and (select private.current_profile_role()) = 'student'
    and exists (select 1 from public.class_schedules s join public.class_enrollments e on e.class_id = s.class_id
      join public.classes c on c.id = s.class_id
      where s.id = schedule_id and e.student_id = (select auth.uid()) and e.is_active and c.archived_at is null)
  );
create policy student_schedule_preferences_delete on public.student_schedule_notification_preferences
  for delete to authenticated using (student_id = (select auth.uid()));
revoke all on public.student_schedule_notification_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.student_schedule_notification_preferences to authenticated;
grant all on public.student_schedule_notification_preferences to service_role;
create trigger student_schedule_preferences_updated before update on public.student_schedule_notification_preferences
  for each row execute function private.set_updated_at();

create function private.set_class_archived_impl(p_class_id uuid, p_archived boolean)
returns public.classes language plpgsql security definer set search_path = '' as $$
declare v_class public.classes%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first' using errcode='42501'; end if;
  select * into v_class from public.classes where id=p_class_id for update;
  if not found then raise exception 'Class not found' using errcode='P0002'; end if;
  if private.current_profile_role() is distinct from 'admin'::public.app_role and not (v_class.teacher_id=(select auth.uid()) and private.current_profile_role()='teacher'
      and exists(select 1 from public.profiles where id=(select auth.uid()) and teacher_approval_status='approved')) then
    raise exception 'Only the class teacher can archive this class' using errcode='42501';
  end if;
  update public.classes set archived_at=case when p_archived then coalesce(archived_at,now()) else null end
    where id=p_class_id returning * into v_class;
  perform private.enqueue_class_notifications();
  return v_class;
end; $$;
create function public.set_class_archived(p_class_id uuid, p_archived boolean default true)
returns public.classes language sql security invoker set search_path = '' as $$
  select private.set_class_archived_impl(p_class_id,p_archived)
$$;
revoke all on function private.set_class_archived_impl(uuid,boolean), public.set_class_archived(uuid,boolean) from public,anon,authenticated;
grant execute on function private.set_class_archived_impl(uuid,boolean), public.set_class_archived(uuid,boolean) to authenticated;

-- This unified generator filters archived classes before creating occurrences.
create function private.generate_schedule_week(p_week_start date,p_class_id uuid,p_imminent_at timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with candidates as (
    select s.*,c.teacher_id,c.name as class_name,c.default_max_accuracy_m,
      (p_week_start + case when s.day_of_week=0 then 6 else s.day_of_week-1 end)::date as occurrence_date
    from public.class_schedules s join public.classes c on c.id=s.class_id
    join public.profiles t on t.id=c.teacher_id and t.role='teacher' and t.teacher_approval_status='approved'
    where s.is_active and c.archived_at is null and (p_class_id is null or c.id=p_class_id)
  ), inserted as (
    insert into public.meetings(class_id,schedule_id,schedule_week_start,title,meeting_date,starts_at,ends_at,
      attendance_mode,attendance_enabled,attendance_opens_at,attendance_closes_at,latitude,longitude,radius_m,max_accuracy_m,created_by)
    select c.class_id,c.id,p_week_start,c.class_name,c.occurrence_date,
      (c.occurrence_date+c.starts_at) at time zone 'Asia/Manila',
      (c.occurrence_date+c.ends_at) at time zone 'Asia/Manila',c.attendance_mode,true,
      ((c.occurrence_date+c.starts_at) at time zone 'Asia/Manila')-make_interval(mins=>c.check_in_minutes_before::integer),
      case when c.check_in_minutes_after_start is null then (c.occurrence_date+c.ends_at) at time zone 'Asia/Manila'
        else ((c.occurrence_date+c.starts_at) at time zone 'Asia/Manila')+make_interval(mins=>c.check_in_minutes_after_start::integer) end,
      case when c.attendance_mode='self_online' then null else 13.387419 end,
      case when c.attendance_mode='self_online' then null else 121.162494 end,180,c.default_max_accuracy_m,c.teacher_id
    from candidates c where not exists(select 1 from private.schedule_meeting_exceptions x where x.schedule_id=c.id and x.schedule_week_start=p_week_start)
      and (p_imminent_at is null or ((c.occurrence_date+c.starts_at) at time zone 'Asia/Manila' >= p_imminent_at
        and (c.occurrence_date+c.starts_at) at time zone 'Asia/Manila' < p_imminent_at+interval '3 hours'))
    on conflict(schedule_id,schedule_week_start) where schedule_id is not null and schedule_week_start is not null do nothing returning 1
  ) select count(*)::integer into v_count from inserted;
  return v_count;
end; $$;
revoke all on function private.generate_schedule_week(date,uuid,timestamptz) from public,anon,authenticated;
create or replace function private.generate_current_week_meetings(p_class_id uuid default null)
returns integer language sql security definer set search_path = '' as $$
  select private.generate_schedule_week(date_trunc('week',timezone('Asia/Manila',now()))::date,p_class_id,null)
$$;
create or replace function private.generate_imminent_schedule_meetings(p_now timestamptz default now())
returns integer language sql security definer set search_path = '' as $$
  select private.generate_schedule_week(date_trunc('week',timezone('Asia/Manila',p_now))::date,null,p_now)
    +private.generate_schedule_week(date_trunc('week',timezone('Asia/Manila',p_now))::date+7,null,p_now)
$$;
drop trigger class_schedules_generate_current_week_meeting on public.class_schedules;
create trigger class_schedules_generate_current_week_meeting after insert or update of class_id,day_of_week,starts_at,ends_at,
  is_active,attendance_mode,check_in_minutes_before,check_in_minutes_after_start on public.class_schedules
  for each row execute function private.generate_meeting_after_schedule_change();

-- Online coordinates never appear in public attendance rows, public views,
-- Realtime payloads or teacher evidence RPCs. Only verified linked parents
-- can call the bounded read RPC below.
create table private.online_attendance_locations (
  attendance_id uuid primary key references public.attendance_records(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  accuracy_m double precision not null check(accuracy_m between 0 and 50000),
  captured_at timestamptz not null default now()
);
create index online_attendance_locations_student_idx on private.online_attendance_locations(student_id,captured_at desc);
alter table private.online_attendance_locations enable row level security;
create policy online_attendance_locations_deny_clients on private.online_attendance_locations for all to public using(false) with check(false);
revoke all on private.online_attendance_locations from public,anon,authenticated;
grant all on private.online_attendance_locations to service_role;

alter function private.submit_self_attendance_impl(uuid,text,text,double precision,double precision,double precision)
  rename to submit_self_attendance_evidence_impl;
revoke all on function private.submit_self_attendance_evidence_impl(uuid,text,text,double precision,double precision,double precision) from public,anon,authenticated;
create function private.submit_self_attendance_impl(p_meeting_id uuid,p_selfie_path text,p_raw_barcode text,
  p_latitude double precision,p_longitude double precision,p_accuracy_m double precision)
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
declare v_record public.attendance_records%rowtype; v_mode public.attendance_mode;
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'student'::public.app_role then
    raise exception 'Only a signed-in student can submit self-attendance' using errcode='42501'; end if;
  select m.attendance_mode into v_mode from public.meetings m join public.classes c on c.id=m.class_id
    where m.id=p_meeting_id and c.archived_at is null;
  if not found then raise exception 'This class is archived or the meeting is unavailable' using errcode='22023'; end if;
  if v_mode='self_online' and (p_latitude is null or p_longitude is null or p_accuracy_m is null
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 or p_accuracy_m not between 0 and 50000) then
    raise exception 'Allow location access before submitting online attendance. Only your linked parents can view it.' using errcode='22023';
  end if;
  v_record:=private.submit_self_attendance_evidence_impl(p_meeting_id,p_selfie_path,p_raw_barcode,p_latitude,p_longitude,p_accuracy_m);
  if v_mode='self_online' then
    insert into private.online_attendance_locations(attendance_id,student_id,latitude,longitude,accuracy_m)
      values(v_record.id,(select auth.uid()),p_latitude,p_longitude,p_accuracy_m);
  end if;
  return v_record;
end; $$;
revoke all on function private.submit_self_attendance_impl(uuid,text,text,double precision,double precision,double precision) from public,anon,authenticated;
grant execute on function private.submit_self_attendance_impl(uuid,text,text,double precision,double precision,double precision) to authenticated;

create function private.parent_online_attendance_locations_impl(p_student_id uuid)
returns table(attendance_id uuid,latitude double precision,longitude double precision,accuracy_m double precision,captured_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'parent'::public.app_role or not exists(
    select 1 from public.guardian_links g join auth.users u on u.id=g.parent_id
    where g.parent_id=(select auth.uid()) and g.student_id=p_student_id and u.email_confirmed_at is not null
      and lower(u.email)=g.verified_guardian_email
  ) then raise exception 'Only a verified linked parent can view online attendance locations' using errcode='42501'; end if;
  return query select l.attendance_id,l.latitude,l.longitude,l.accuracy_m,l.captured_at
    from private.online_attendance_locations l where l.student_id=p_student_id order by l.captured_at desc;
end; $$;
create function public.parent_online_attendance_locations(p_student_id uuid)
returns table(attendance_id uuid,latitude double precision,longitude double precision,accuracy_m double precision,captured_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select * from private.parent_online_attendance_locations_impl(p_student_id)
$$;
revoke all on function private.parent_online_attendance_locations_impl(uuid),public.parent_online_attendance_locations(uuid) from public,anon,authenticated;
grant execute on function private.parent_online_attendance_locations_impl(uuid),public.parent_online_attendance_locations(uuid) to authenticated;

-- Existing templates are locked. A grant is consumed only by a successful,
-- validated replacement; concurrent replacements serialize on the profile.
create table private.face_retake_grants (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid not null references public.profiles(id) on delete restrict,
  granted_at timestamptz not null default now(),
  note text check(note is null or char_length(note)<=1000)
);
create index face_retake_grants_granter_idx on private.face_retake_grants(granted_by);
alter table private.face_retake_grants enable row level security;
create policy face_retake_grants_deny_clients on private.face_retake_grants for all to public using(false) with check(false);
revoke all on private.face_retake_grants from public,anon,authenticated;
grant all on private.face_retake_grants to service_role;
alter function private.enroll_my_face_impl(double precision[],text,integer) rename to enroll_my_face_validated_impl;
revoke all on function private.enroll_my_face_validated_impl(double precision[],text,integer) from public,anon,authenticated;
create function private.enroll_my_face_impl(p_embedding double precision[],p_model_version text,p_sample_count integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'student'::public.app_role then
    raise exception 'Only a signed-in student can enroll a face template' using errcode='42501'; end if;
  perform 1 from public.profiles where id=(select auth.uid()) for update;
  if exists(select 1 from private.student_face_templates where student_id=(select auth.uid()))
     and not exists(select 1 from private.face_retake_grants where student_id=(select auth.uid())) then
    raise exception 'Your face is already enrolled. Ask an administrator to allow a retake.' using errcode='42501'; end if;
  perform private.enroll_my_face_validated_impl(p_embedding,p_model_version,p_sample_count);
  delete from private.face_retake_grants where student_id=(select auth.uid());
  update public.profiles set updated_at=now() where id=(select auth.uid());
end; $$;
revoke all on function private.enroll_my_face_impl(double precision[],text,integer) from public,anon,authenticated;
grant execute on function private.enroll_my_face_impl(double precision[],text,integer) to authenticated;
create or replace function private.delete_my_face_impl() returns void language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Face enrollment is locked. Ask an administrator to allow a retake.' using errcode='42501';
end; $$;
create function private.admin_grant_face_retake_impl(p_student_id uuid,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'admin'::public.app_role then raise exception 'Administrator access required' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='student') then
    raise exception 'Student not found' using errcode='P0002'; end if;
  perform 1 from public.profiles where id=p_student_id for update;
  insert into private.face_retake_grants(student_id,granted_by,note) values(p_student_id,(select auth.uid()),nullif(btrim(p_note),''))
    on conflict(student_id) do update set granted_by=excluded.granted_by,granted_at=now(),note=excluded.note;
  update public.profiles set updated_at=now() where id=p_student_id;
end; $$;
create function public.admin_grant_face_retake(p_student_id uuid,p_note text default null)
returns void language sql security invoker set search_path = '' as $$ select private.admin_grant_face_retake_impl(p_student_id,p_note) $$;
create function private.my_face_enrollment_access_impl()
returns table(is_enrolled boolean,can_retake boolean,granted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'student'::public.app_role then raise exception 'Student access required' using errcode='42501'; end if;
  return query select exists(select 1 from private.student_face_templates where student_id=(select auth.uid())),
    g.student_id is not null,g.granted_at from(select 1) seed left join private.face_retake_grants g on g.student_id=(select auth.uid());
end; $$;
create function public.my_face_enrollment_access()
returns table(is_enrolled boolean,can_retake boolean,granted_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.my_face_enrollment_access_impl() $$;
revoke all on function private.admin_grant_face_retake_impl(uuid,text),public.admin_grant_face_retake(uuid,text),
  private.my_face_enrollment_access_impl(),public.my_face_enrollment_access() from public,anon,authenticated;
grant execute on function private.admin_grant_face_retake_impl(uuid,text),public.admin_grant_face_retake(uuid,text),
  private.my_face_enrollment_access_impl(),public.my_face_enrollment_access() to authenticated;

create or replace view public.student_available_meetings with(security_invoker=true) as
select m.id,m.class_id,c.name as class_name,m.title,m.meeting_date,m.starts_at,m.ends_at,m.attendance_mode,
  m.attendance_enabled,m.attendance_opens_at,m.attendance_closes_at,m.max_accuracy_m,
  a.status as existing_status,a.submitted_at
from public.meetings m join public.classes c on c.id=m.class_id
join public.class_enrollments e on e.class_id=m.class_id and e.student_id=(select auth.uid()) and e.is_active
left join public.attendance_records a on a.meeting_id=m.id and a.student_id=e.student_id
where m.attendance_enabled and c.archived_at is null and a.id is null
  and m.attendance_mode in ('self_on_site','self_online') and now() between m.attendance_opens_at and m.attendance_closes_at;

-- Student reminders are resolved from each student's own preferences. A
-- missing preference retains the standard six offsets; an empty array is off.
create or replace function private.enqueue_class_notifications(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare v_changed integer;
begin
  perform private.generate_imminent_schedule_meetings(p_now);
  with recipients as (
    select m.id as meeting_id,s.id as schedule_id,c.teacher_id as user_id,'teacher'::text as audience,
      s.teacher_reminder_minutes as offsets,m.starts_at
    from public.meetings m join public.class_schedules s on s.id=m.schedule_id
    join public.classes c on c.id=m.class_id
    join public.profiles t on t.id=c.teacher_id and t.role='teacher' and t.teacher_approval_status='approved'
    where m.attendance_enabled and s.is_active and c.archived_at is null
      and m.starts_at>=p_now-interval '1 day' and m.starts_at<p_now+interval '8 days'
    union all
    select m.id,s.id,e.student_id,'student',
      coalesce(p.reminder_minutes,array[120,60,30,15,5,0]::smallint[]),m.starts_at
    from public.meetings m join public.class_schedules s on s.id=m.schedule_id
    join public.classes c on c.id=m.class_id
    join public.profiles t on t.id=c.teacher_id and t.role='teacher' and t.teacher_approval_status='approved'
    join public.class_enrollments e on e.class_id=m.class_id and e.is_active
    left join public.student_schedule_notification_preferences p on p.schedule_id=s.id and p.student_id=e.student_id
    where m.attendance_enabled and s.is_active and c.archived_at is null
      and m.starts_at>=p_now-interval '1 day' and m.starts_at<p_now+interval '8 days'
  ), desired as (
    select r.*,n.offset_minutes,r.starts_at-make_interval(mins=>n.offset_minutes::integer) as scheduled_for
    from recipients r cross join lateral(select distinct unnest(r.offsets) as offset_minutes) n
    where r.starts_at-make_interval(mins=>n.offset_minutes::integer)>=p_now-interval '5 minutes'
  )
  insert into private.class_notification_queue as q(meeting_id,schedule_id,user_id,audience,reminder_offset_minutes,scheduled_for)
  select d.meeting_id,d.schedule_id,d.user_id,d.audience,d.offset_minutes,d.scheduled_for from desired d
  on conflict(meeting_id,user_id,audience,reminder_offset_minutes) do update set schedule_id=excluded.schedule_id,
    scheduled_for=case when q.state='sent' then q.scheduled_for else excluded.scheduled_for end,
    state=case when q.state='cancelled' then 'pending' else q.state end,
    completed_at=case when q.state='cancelled' then null else q.completed_at end,updated_at=now();
  get diagnostics v_changed=row_count;
  update private.class_notification_queue q set state='cancelled',completed_at=p_now,updated_at=now()
  where q.state in('pending','processing','failed') and (
    q.scheduled_for<p_now-interval '5 minutes' or not exists(
      select 1 from public.meetings m join public.class_schedules s on s.id=m.schedule_id and s.id=q.schedule_id
      join public.classes c on c.id=m.class_id
      join public.profiles t on t.id=c.teacher_id and t.role='teacher' and t.teacher_approval_status='approved'
      where m.id=q.meeting_id and m.attendance_enabled and s.is_active and c.archived_at is null and (
        (q.audience='teacher' and q.user_id=c.teacher_id and q.reminder_offset_minutes=any(s.teacher_reminder_minutes))
        or(q.audience='student' and exists(select 1 from public.class_enrollments e
          where e.class_id=m.class_id and e.student_id=q.user_id and e.is_active)
          and q.reminder_offset_minutes=any(coalesce((select p.reminder_minutes
            from public.student_schedule_notification_preferences p where p.schedule_id=s.id and p.student_id=q.user_id),
            array[120,60,30,15,5,0]::smallint[])))
      )
    )
  );
  update private.class_notification_deliveries d set status='cancelled',claimed_by=null,claimed_at=null,
    last_error=coalesce(d.last_error,'Reminder was cancelled'),updated_at=now()
    from private.class_notification_queue q where q.id=d.queue_id and q.state='cancelled' and d.status in('pending','processing','failed');
  return v_changed;
end; $$;
create function private.reconcile_student_notification_preference()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.enqueue_class_notifications(); return coalesce(new,old); end; $$;
revoke all on function private.reconcile_student_notification_preference() from public,anon,authenticated;
create trigger student_schedule_preferences_reconcile after insert or update or delete on public.student_schedule_notification_preferences
  for each row execute function private.reconcile_student_notification_preference();

-- A counter is the only replicated payload. It tells an authorized client to
-- re-read its RLS-protected resources and works for deletions without exposing
-- old record payloads or private biometric/location values.
create table public.portal_change_events (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  revision bigint not null default 1,
  updated_at timestamptz not null default now()
);
alter table public.portal_change_events enable row level security;
create policy portal_change_events_owner_read on public.portal_change_events for select to authenticated
  using (user_id=(select auth.uid()));
revoke all on public.portal_change_events from public,anon,authenticated;
grant select on public.portal_change_events to authenticated;
grant all on public.portal_change_events to service_role;
create function private.notify_portal_user(p_user_id uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.portal_change_events as e(user_id) select p_user_id
    where p_user_id is not null and exists(select 1 from public.profiles where id=p_user_id)
  on conflict(user_id) do update set revision=e.revision+1,updated_at=now()
$$;
create function private.notify_portal_student(p_student_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform private.notify_portal_user(p_student_id);
  for v_user in select g.parent_id from public.guardian_links g join auth.users u on u.id=g.parent_id
    join public.profiles p on p.id=g.parent_id and p.role='parent'
    where g.student_id=p_student_id and u.email_confirmed_at is not null and lower(u.email)=g.verified_guardian_email
  loop perform private.notify_portal_user(v_user); end loop;
end; $$;
create function private.notify_portal_class(p_class_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform private.notify_portal_user((select teacher_id from public.classes where id=p_class_id));
  for v_user in select student_id from public.class_enrollments where class_id=p_class_id
  loop perform private.notify_portal_student(v_user); end loop;
end; $$;
create function private.portal_resource_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb; v_class uuid; v_student uuid; v_user uuid;
begin
  v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name='profiles' then
    v_student:=(v_row->>'id')::uuid;
    perform private.notify_portal_student(v_student);
    for v_user in select distinct c.teacher_id from public.classes c join public.class_enrollments e on e.class_id=c.id
      where e.student_id=v_student
    loop perform private.notify_portal_user(v_user); end loop;
    for v_class in select id from public.classes where teacher_id=v_student
    loop perform private.notify_portal_class(v_class); end loop;
    for v_user in select id from public.profiles where role='admin'
    loop perform private.notify_portal_user(v_user); end loop;
  elsif tg_table_name='student_profiles' then perform private.notify_portal_student((v_row->>'user_id')::uuid);
  elsif tg_table_name='guardian_links' then
    perform private.notify_portal_user((v_row->>'parent_id')::uuid);
    perform private.notify_portal_user((v_row->>'student_id')::uuid);
  elsif tg_table_name='attendance_records' then
    perform private.notify_portal_student((v_row->>'student_id')::uuid);
    select class_id into v_class from public.meetings where id=(v_row->>'meeting_id')::uuid;
    perform private.notify_portal_user((select teacher_id from public.classes where id=v_class));
  elsif tg_table_name in('student_tasks','student_task_categories','student_schedule_notification_preferences') then
    perform private.notify_portal_user((v_row->>'student_id')::uuid);
  elsif tg_table_name in('student_task_links','student_task_files','student_task_occurrences') then
    perform private.notify_portal_user((select student_id from public.student_tasks where id=(v_row->>'task_id')::uuid));
  elsif tg_table_name='device_push_tokens' then perform private.notify_portal_user((v_row->>'user_id')::uuid);
  else
    v_class:=case when tg_table_name='classes' then(v_row->>'id')::uuid else(v_row->>'class_id')::uuid end;
    perform private.notify_portal_class(v_class);
    if tg_table_name='class_enrollments' then perform private.notify_portal_student((v_row->>'student_id')::uuid); end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;
revoke all on function private.notify_portal_user(uuid),private.notify_portal_student(uuid),private.notify_portal_class(uuid),private.portal_resource_changed()
  from public,anon,authenticated;
do $$ declare v_table text; begin
  foreach v_table in array array['profiles','student_profiles','guardian_links','classes','class_enrollments','class_schedules','meetings',
    'attendance_records','student_tasks','student_task_categories','student_task_links','student_task_files','student_task_occurrences',
    'student_schedule_notification_preferences','device_push_tokens']
  loop
    execute format('create trigger portal_resource_changed after insert or update on public.%I for each row execute function private.portal_resource_changed()',v_table);
    execute format('create trigger portal_resource_deleted before delete on public.%I for each row execute function private.portal_resource_changed()',v_table);
  end loop;
end $$;
do $$ begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then create publication supabase_realtime; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='portal_change_events') then
    alter publication supabase_realtime add table public.portal_change_events;
  end if;
end $$;

-- Archived classes retain their enrollment/history but cannot accept joins.
create function private.prevent_archived_class_enrollment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_active and exists(select 1 from public.classes where id=new.class_id and archived_at is not null) then
    raise exception 'This class has been archived and is no longer accepting enrollment' using errcode='22023';
  end if;
  return new;
end; $$;
revoke all on function private.prevent_archived_class_enrollment() from public,anon,authenticated;
create trigger prevent_archived_class_enrollment before insert or update on public.class_enrollments
  for each row execute function private.prevent_archived_class_enrollment();

create function private.guard_online_attendance_privacy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='meetings' then
    if new.attendance_mode is distinct from old.attendance_mode and exists(
      select 1 from public.attendance_records a where a.meeting_id=old.id and a.source='self_check'
    ) then raise exception 'Attendance mode cannot change after a student submits evidence. Create a new meeting instead.' using errcode='22023'; end if;
  elsif exists(select 1 from public.meetings where id=new.meeting_id and attendance_mode='self_online') then
    new.latitude:=null; new.longitude:=null; new.accuracy_m:=null; new.distance_m:=null;
  end if;
  return new;
end; $$;
revoke all on function private.guard_online_attendance_privacy() from public,anon,authenticated;
create trigger guard_online_attendance_privacy before insert or update on public.attendance_records
  for each row execute function private.guard_online_attendance_privacy();
create trigger guard_evidence_attendance_mode before update of attendance_mode on public.meetings
  for each row execute function private.guard_online_attendance_privacy();

create function private.admin_student_face_enrollments_impl()
returns table(student_id uuid,full_name text,email text,enrolled boolean,can_retake boolean,granted_at timestamptz,enrolled_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'admin'::public.app_role then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  return query select p.id,p.full_name,p.email,t.student_id is not null,g.student_id is not null,g.granted_at,t.enrolled_at
    from public.profiles p left join private.student_face_templates t on t.student_id=p.id
    left join private.face_retake_grants g on g.student_id=p.id where p.role='student';
end; $$;
create function public.admin_student_face_enrollments()
returns table(student_id uuid,full_name text,email text,enrolled boolean,can_retake boolean,granted_at timestamptz,enrolled_at timestamptz)
language sql stable security invoker set search_path = '' as $$ select * from private.admin_student_face_enrollments_impl() $$;
revoke all on function private.admin_student_face_enrollments_impl(),public.admin_student_face_enrollments() from public,anon,authenticated;
grant execute on function private.admin_student_face_enrollments_impl(),public.admin_student_face_enrollments() to authenticated;

-- Absence is computed only after a meeting ends, never before enrollment.
-- Disabled occurrences remain visible as not-counted history. Recorded rows
-- survive class archive or enrollment removal and never duplicate an inferred
-- row. No attendance record is fabricated or written during this read.
create function private.student_attendance_history_impl(p_student_id uuid)
returns table(id uuid,attendance_id uuid,meeting_id uuid,class_id uuid,student_id uuid,
  status public.attendance_status,source public.attendance_source,verification_status public.attendance_verification_status,
  selfie_path text,latitude double precision,longitude double precision,accuracy_m double precision,distance_m double precision,
  submitted_at timestamptz,meeting_title text,meeting_starts_at timestamptz,meeting_ends_at timestamptz,class_name text,
  attendance_enabled boolean,attendance_mode public.attendance_mode,review_note text,teacher_note text,face_verified boolean,is_inferred boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_student uuid:=coalesce(p_student_id,(select auth.uid()));
begin
  if (select auth.uid()) is null or not coalesce((
    (private.current_profile_role()='student' and v_student=(select auth.uid()))
    or(private.current_profile_role()='parent' and private.parent_has_student(v_student))
  ),false) then raise exception 'Only the student or a verified linked parent can view this history' using errcode='42501'; end if;
  return query with eligible as (
    select m.id from public.meetings m join public.class_enrollments e on e.class_id=m.class_id
      join public.classes c on c.id=m.class_id
      where e.student_id=v_student and e.is_active and m.ends_at<=now() and e.joined_at<=m.ends_at
        and (not m.attendance_enabled or m.attendance_mode='teacher_manual' or m.attendance_closes_at<=now())
        and (c.archived_at is null or m.starts_at<c.archived_at)
    union select a.meeting_id from public.attendance_records a where a.student_id=v_student
  )
  select coalesce(a.id,m.id),a.id,m.id,m.class_id,v_student,coalesce(a.status,'absent'::public.attendance_status),a.source,a.verification_status,
    a.selfie_path,case when m.attendance_mode='self_online' then null else a.latitude end,
    case when m.attendance_mode='self_online' then null else a.longitude end,
    case when m.attendance_mode='self_online' then null else a.accuracy_m end,
    case when m.attendance_mode='self_online' then null else a.distance_m end,
    coalesce(a.submitted_at,m.ends_at),m.title,m.starts_at,m.ends_at,c.name,m.attendance_enabled,m.attendance_mode,
    a.review_note,a.teacher_note,coalesce(a.face_verified,false),a.id is null
  from eligible x join public.meetings m on m.id=x.id join public.classes c on c.id=m.class_id
  left join public.attendance_records a on a.meeting_id=m.id and a.student_id=v_student
  order by m.starts_at desc,m.id desc;
end; $$;
create function public.student_attendance_history(p_student_id uuid default null)
returns table(id uuid,attendance_id uuid,meeting_id uuid,class_id uuid,student_id uuid,
  status public.attendance_status,source public.attendance_source,verification_status public.attendance_verification_status,
  selfie_path text,latitude double precision,longitude double precision,accuracy_m double precision,distance_m double precision,
  submitted_at timestamptz,meeting_title text,meeting_starts_at timestamptz,meeting_ends_at timestamptz,class_name text,
  attendance_enabled boolean,attendance_mode public.attendance_mode,review_note text,teacher_note text,face_verified boolean,is_inferred boolean)
language sql stable security invoker set search_path = '' as $$ select * from private.student_attendance_history_impl(p_student_id) $$;
revoke all on function private.student_attendance_history_impl(uuid),public.student_attendance_history(uuid) from public,anon,authenticated;
grant execute on function private.student_attendance_history_impl(uuid),public.student_attendance_history(uuid) to authenticated;

create function private.visible_schedule_meeting_exceptions_impl(p_start date,p_end date)
returns table(schedule_id uuid,schedule_week_start date)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in first' using errcode='42501'; end if;
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>370 then
    raise exception 'Choose a calendar range of no more than one year' using errcode='22023'; end if;
  return query select x.schedule_id,x.schedule_week_start from private.schedule_meeting_exceptions x
    join public.class_schedules s on s.id=x.schedule_id
    where x.schedule_week_start>=p_start-6 and x.schedule_week_start<p_end and private.can_access_class(s.class_id);
end; $$;
create function public.visible_schedule_meeting_exceptions(p_start date,p_end date)
returns table(schedule_id uuid,schedule_week_start date)
language sql stable security invoker set search_path = '' as $$ select * from private.visible_schedule_meeting_exceptions_impl(p_start,p_end) $$;
revoke all on function private.visible_schedule_meeting_exceptions_impl(date,date),public.visible_schedule_meeting_exceptions(date,date) from public,anon,authenticated;
grant execute on function private.visible_schedule_meeting_exceptions_impl(date,date),public.visible_schedule_meeting_exceptions(date,date) to authenticated;

-- Teachers can provide a manual fallback for students who cannot complete a
-- self-check. A submitted self-check remains immutable except through the
-- dedicated evidence-review RPC, including when two writes race.
create or replace function private.record_manual_attendance_impl(
  p_meeting_id uuid,p_student_id uuid,p_status public.attendance_status,p_note text
)
returns public.attendance_records language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_meeting public.meetings%rowtype; v_record public.attendance_records%rowtype;
begin
  select m.* into v_meeting from public.meetings m where m.id=p_meeting_id for share;
  if not found then raise exception 'Meeting not found' using errcode='P0002'; end if;
  if v_actor is null or not private.teacher_owns_class(v_meeting.class_id) then
    raise exception 'Only this class teacher can record attendance' using errcode='42501'; end if;
  if not v_meeting.attendance_enabled then
    raise exception 'Attendance is disabled for this meeting' using errcode='22023'; end if;
  perform 1 from public.classes where id=v_meeting.class_id and archived_at is null for share;
  if not found then raise exception 'Restore the archived class before recording attendance' using errcode='22023'; end if;
  if not exists(select 1 from public.class_enrollments e join public.profiles p on p.id=e.student_id and p.role='student'
    where e.class_id=v_meeting.class_id and e.student_id=p_student_id and e.is_active) then
    raise exception 'The student is not actively enrolled in this class' using errcode='42501'; end if;
  if exists(select 1 from public.attendance_records a where a.meeting_id=p_meeting_id and a.student_id=p_student_id and a.source='self_check') then
    raise exception 'A self-check record cannot be replaced by manual attendance. Use Void or Restore.' using errcode='22023'; end if;
  insert into public.attendance_records(meeting_id,student_id,status,source,recorded_by,teacher_note,verification_status,reviewed_by,reviewed_at,review_note)
    values(p_meeting_id,p_student_id,p_status,'teacher',v_actor,nullif(btrim(p_note),''),null,null,null,null)
    on conflict(meeting_id,student_id) do update set status=excluded.status,recorded_by=excluded.recorded_by,
      teacher_note=excluded.teacher_note,submitted_at=now(),updated_at=now()
      where public.attendance_records.source='teacher'
    returning * into v_record;
  if v_record.id is null then
    raise exception 'A self-check record cannot be replaced by manual attendance. Use Void or Restore.' using errcode='22023'; end if;
  return v_record;
end; $$;
revoke all on function private.record_manual_attendance_impl(uuid,uuid,public.attendance_status,text) from public,anon,authenticated;
grant execute on function private.record_manual_attendance_impl(uuid,uuid,public.attendance_status,text) to authenticated;
