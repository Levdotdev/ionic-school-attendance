-- Canonical structured names. Legacy names are only a best-effort split;
-- every existing account is asked to confirm its surname in Profile.
alter table public.profiles
  add column first_name text not null default '',
  add column last_name text not null default '',
  add column name_review_required boolean not null default true;

update public.profiles p set full_name=n.value,
  first_name=case when n.value like '% %' then regexp_replace(n.value,' [^ ]+$','') else n.value end,
  last_name=case when n.value like '% %' then regexp_replace(n.value,'^.* ','') else '' end,
  name_review_required=true
from(select id,upper(btrim(regexp_replace(full_name,'[[:space:]]+',' ','g'))) as value from public.profiles) n where n.id=p.id;
alter table public.profiles add constraint profiles_structured_name_lengths
  check(char_length(first_name)<=120 and char_length(last_name)<=120);
alter table public.profiles add constraint profiles_confirmed_names_required
  check(name_review_required or (char_length(first_name)>0 and char_length(last_name)>0));
create index profiles_role_surname_idx on public.profiles(role,last_name,first_name,id);
comment on column public.profiles.name_review_required is
  'Legacy/provider display names are a best-effort split. Explicit structured-name setup or editing confirms the surname.';

create function private.confirm_structured_profile_names()
returns trigger language plpgsql security invoker set search_path='' as $$
begin new.name_review_required:=false; return new; end; $$;
create function private.normalize_profile_names()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_name text:=upper(btrim(regexp_replace(new.full_name,'[[:space:]]+',' ','g')));
begin
  if (tg_op='INSERT' and new.first_name='' and new.last_name='')
    or (tg_op='UPDATE' and new.full_name is distinct from old.full_name
      and new.first_name is not distinct from old.first_name and new.last_name is not distinct from old.last_name) then
    new.first_name:=case when v_name like '% %' then regexp_replace(v_name,' [^ ]+$','') else v_name end;
    new.last_name:=case when v_name like '% %' then regexp_replace(v_name,'^.* ','') else '' end;
    new.name_review_required:=true;
  end if;
  new.first_name:=upper(btrim(regexp_replace(new.first_name,'[[:space:]]+',' ','g')));
  new.last_name:=upper(btrim(regexp_replace(new.last_name,'[[:space:]]+',' ','g')));
  new.full_name:=concat_ws(' ',nullif(new.first_name,''),nullif(new.last_name,''));
  return new;
end; $$;
revoke all on function private.confirm_structured_profile_names(),private.normalize_profile_names() from public,anon,authenticated;
create trigger profiles_a_confirm_structured_names before update of first_name,last_name on public.profiles
  for each row execute function private.confirm_structured_profile_names();
create trigger profiles_b_normalize_names before insert or update on public.profiles
  for each row execute function private.normalize_profile_names();
grant update(first_name,last_name) on public.profiles to authenticated;

create function private.validate_structured_names(p_first_name text,p_last_name text)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare v_first text:=btrim(p_first_name); v_last text:=btrim(p_last_name);
begin
  if v_first is null or v_last is null or char_length(v_first) not between 1 and 80
    or char_length(v_last) not between 1 and 80 or char_length(v_first||' '||v_last)>120
    or v_first~'[[:cntrl:]]' or v_last~'[[:cntrl:]]' then
    raise exception 'Enter first name and last name, up to 120 characters combined' using errcode='22023';
  end if;
end; $$;
revoke all on function private.validate_structured_names(text,text) from public,anon,authenticated;
create function private.complete_account_setup_impl(p_first_name text,p_last_name text,p_role text)
returns public.profiles language plpgsql security definer set search_path='' as $$
declare v_result public.profiles%rowtype;
begin
  perform private.validate_structured_names(p_first_name,p_last_name);
  -- The existing role/invitation/email-confirmation checks remain authoritative.
  perform private.complete_account_setup_impl(btrim(p_first_name)||' '||btrim(p_last_name),p_role);
  update public.profiles set first_name=p_first_name,last_name=p_last_name
    where id=(select auth.uid()) returning * into v_result;
  return v_result;
end; $$;
create function public.complete_account_setup(p_first_name text,p_last_name text,p_role text)
returns public.profiles language sql security invoker set search_path='' as $$
  select private.complete_account_setup_impl(p_first_name,p_last_name,p_role)
$$;
create function private.complete_student_registration_impl(p_first_name text,p_last_name text,p_raw_barcode text,p_guardian_email text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.validate_structured_names(p_first_name,p_last_name);
  -- Never transform the barcode: its exact payload is a hashed credential.
  perform private.complete_student_registration_impl(btrim(p_first_name)||' '||btrim(p_last_name),p_raw_barcode,p_guardian_email);
  update public.profiles set first_name=p_first_name,last_name=p_last_name where id=(select auth.uid());
end; $$;
create function public.complete_student_registration(p_first_name text,p_last_name text,p_raw_barcode text,p_guardian_email text)
returns void language sql security invoker set search_path='' as $$
  select private.complete_student_registration_impl(p_first_name,p_last_name,p_raw_barcode,p_guardian_email)
$$;
revoke all on function private.complete_account_setup_impl(text,text,text),public.complete_account_setup(text,text,text),
  private.complete_student_registration_impl(text,text,text,text),public.complete_student_registration(text,text,text,text) from public,anon,authenticated;
grant execute on function private.complete_account_setup_impl(text,text,text),public.complete_account_setup(text,text,text),
  private.complete_student_registration_impl(text,text,text,text),public.complete_student_registration(text,text,text,text) to authenticated;

-- Uppercase human-authored text on the server as well as in the form. These
-- allowlisted fields exclude passwords, email addresses, URLs, file paths,
-- object keys, IDs, color codes, status values, timezone and device tokens.
-- URLs/email embedded in free-form descriptions and notes retain exact case.
create function private.uppercase_human_text(p_value text)
returns text language plpgsql immutable strict security invoker set search_path='' as $$
declare v_rest text:=p_value; v_result text:=''; v_match text[]; v_position integer;
begin
  loop
    v_match:=regexp_match(v_rest,'(https?://[^[:space:]]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})','i');
    if v_match is null then return v_result||upper(v_rest); end if;
    v_position:=strpos(v_rest,v_match[1]);
    v_result:=v_result||upper(substr(v_rest,1,v_position-1))||v_match[1];
    v_rest:=substr(v_rest,v_position+char_length(v_match[1]));
  end loop;
end; $$;
revoke all on function private.uppercase_human_text(text) from public,anon,authenticated;
grant execute on function private.uppercase_human_text(text) to authenticated,service_role;
create function private.normalize_application_text()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  case tg_table_name
    when 'profiles' then new.teacher_approval_note:=private.uppercase_human_text(new.teacher_approval_note);
    when 'classes' then new.name:=private.uppercase_human_text(new.name); new.section:=private.uppercase_human_text(new.section);
    when 'class_schedules' then new.room:=private.uppercase_human_text(new.room);
    when 'attendance_records' then
      new.teacher_note:=private.uppercase_human_text(new.teacher_note); new.review_note:=private.uppercase_human_text(new.review_note);
    when 'student_tasks' then new.title:=private.uppercase_human_text(new.title); new.description:=private.uppercase_human_text(new.description);
    when 'student_task_categories' then new.name:=private.uppercase_human_text(new.name);
    when 'student_task_links' then new.title:=private.uppercase_human_text(new.title);
    when 'guardian_link_requests' then new.review_note:=private.uppercase_human_text(new.review_note);
    when 'face_retake_grants' then new.note:=private.uppercase_human_text(new.note);
    else raise exception 'Unexpected text-normalization table';
  end case;
  return new;
end; $$;
revoke all on function private.normalize_application_text() from public,anon,authenticated;
do $$ declare v_table text; begin
  foreach v_table in array array['profiles','classes','class_schedules','attendance_records','student_tasks',
    'student_task_categories','student_task_links','guardian_link_requests'] loop
    execute format('create trigger normalize_application_text before insert or update on public.%I for each row execute function private.normalize_application_text()',v_table);
  end loop;
end $$;
create trigger normalize_application_text before insert or update on private.face_retake_grants
  for each row execute function private.normalize_application_text();
update public.profiles set teacher_approval_note=private.uppercase_human_text(teacher_approval_note) where teacher_approval_note is not null;
update public.classes set name=private.uppercase_human_text(name),section=private.uppercase_human_text(section);
update public.class_schedules set room=private.uppercase_human_text(room) where room is not null;
update public.attendance_records set teacher_note=private.uppercase_human_text(teacher_note),review_note=private.uppercase_human_text(review_note)
  where teacher_note is not null or review_note is not null;
update public.student_tasks set title=private.uppercase_human_text(title),description=private.uppercase_human_text(description);
update public.student_task_categories set name=private.uppercase_human_text(name);
update public.student_task_links set title=private.uppercase_human_text(title);
update public.guardian_link_requests set review_note=private.uppercase_human_text(review_note) where review_note is not null;
update private.face_retake_grants set note=private.uppercase_human_text(note) where note is not null;

-- Trusted identity changes invalidate only that account's existing realtime
-- counter. No identity/provider/email payload is published to any client.
create function private.auth_identity_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then perform private.notify_portal_user(old.user_id); return old; end if;
  perform private.notify_portal_user(new.user_id);
  if tg_op='UPDATE' and old.user_id is distinct from new.user_id then perform private.notify_portal_user(old.user_id); end if;
  return new;
end; $$;
revoke all on function private.auth_identity_changed() from public,anon,authenticated;
create trigger attendance_auth_identity_changed after insert or update or delete on auth.identities
  for each row execute function private.auth_identity_changed();
-- auth.users_sync_profile already updates profiles for confirmed email changes;
-- its existing profile trigger emits the same owner-only realtime invalidation.

create function private.admin_student_parent_statuses_impl()
returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb;
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'admin'::public.app_role then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('student_id',s.id,'has_approved_parent',s.approved_parent_count>0,
    'approved_parent_count',s.approved_parent_count) order by s.last_name,s.first_name,s.id),'[]'::jsonb) into v_result from(
    select p.id,p.last_name,p.first_name,count(g.parent_id)::integer as approved_parent_count
    from public.profiles p left join (
      select gl.student_id,gl.parent_id from public.guardian_links gl
      join public.guardian_link_requests r on r.student_id=gl.student_id and r.parent_id=gl.parent_id and r.status='approved' and r.parent_email=gl.verified_guardian_email
      join public.profiles parent on parent.id=gl.parent_id and parent.role='parent' and parent.onboarding_completed_at is not null
      join auth.users u on u.id=gl.parent_id and u.email_confirmed_at is not null and lower(u.email)=gl.verified_guardian_email
    ) g on g.student_id=p.id where p.role='student' group by p.id
  ) s;
  return v_result;
end; $$;
create function public.admin_student_parent_statuses()
returns jsonb
language sql stable security invoker set search_path='' as $$ select private.admin_student_parent_statuses_impl() $$;
revoke all on function private.admin_student_parent_statuses_impl(),public.admin_student_parent_statuses() from public,anon,authenticated;
grant execute on function private.admin_student_parent_statuses_impl(),public.admin_student_parent_statuses() to authenticated;

-- Enrollment intervals retain future leave/rejoin gaps for cumulative reports.
-- Legacy ACTIVE enrollment has a known joined_at. Legacy INACTIVE rows have no
-- reliable withdrawal timeline, so only their recorded attendance is counted.
create table private.class_enrollment_periods (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  student_id uuid not null references public.profiles(id) on delete cascade,
  enrolled_at timestamptz not null,
  withdrawn_at timestamptz,
  check(withdrawn_at is null or withdrawn_at>=enrolled_at)
);
create unique index class_enrollment_periods_open_idx on private.class_enrollment_periods(class_id,student_id) where withdrawn_at is null;
create index class_enrollment_periods_student_idx on private.class_enrollment_periods(student_id,class_id,enrolled_at);
create index class_enrollment_periods_class_idx on private.class_enrollment_periods(class_id,student_id,enrolled_at,withdrawn_at);
alter table private.class_enrollment_periods enable row level security;
create policy class_enrollment_periods_deny_clients on private.class_enrollment_periods for all to public using(false) with check(false);
revoke all on private.class_enrollment_periods from public,anon,authenticated;
grant all on private.class_enrollment_periods to service_role;
insert into private.class_enrollment_periods(class_id,student_id,enrolled_at)
  select class_id,student_id,joined_at from public.class_enrollments where is_active;
create function private.track_class_enrollment_period()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    update private.class_enrollment_periods set withdrawn_at=greatest(now(),enrolled_at)
      where class_id=old.class_id and student_id=old.student_id and withdrawn_at is null;
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
revoke all on function private.track_class_enrollment_period() from public,anon,authenticated;
-- Run after the parent/archive guards; any rejection still rolls back all work.
create trigger zz_track_class_enrollment_period before insert or update or delete on public.class_enrollments
  for each row execute function private.track_class_enrollment_period();

-- Restoring a class must not turn its archived occurrences into absences.
-- Keep every known archive window independently of the current archive flag.
create table private.class_archive_periods (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete cascade,
  archived_at timestamptz not null,
  restored_at timestamptz,
  check(restored_at is null or restored_at>=archived_at)
);
create unique index class_archive_periods_open_idx on private.class_archive_periods(class_id) where restored_at is null;
create index class_archive_periods_class_idx on private.class_archive_periods(class_id,archived_at,restored_at);
alter table private.class_archive_periods enable row level security;
create policy class_archive_periods_deny_clients on private.class_archive_periods for all to public using(false) with check(false);
revoke all on private.class_archive_periods from public,anon,authenticated;
grant all on private.class_archive_periods to service_role;
insert into private.class_archive_periods(class_id,archived_at)
  select id,archived_at from public.classes where archived_at is not null;
create function private.track_class_archive_period()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.archived_at is not distinct from old.archived_at then return new; end if;
  if new.archived_at is not null then
    insert into private.class_archive_periods(class_id,archived_at) values(new.id,new.archived_at)
      on conflict(class_id) where restored_at is null do update set archived_at=excluded.archived_at;
  else
    update private.class_archive_periods set restored_at=greatest(now(),archived_at)
      where class_id=new.id and restored_at is null;
  end if;
  return new;
end; $$;
revoke all on function private.track_class_archive_period() from public,anon,authenticated;
create trigger class_archive_period_changed after insert or update of archived_at on public.classes
  for each row execute function private.track_class_archive_period();

create function private.teacher_class_attendance_report_impl(p_class_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_class public.classes%rowtype; v_result jsonb;
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'teacher'::public.app_role
    or not exists(select 1 from public.profiles where id=(select auth.uid()) and teacher_approval_status='approved') then
    raise exception 'Approved teacher access required' using errcode='42501'; end if;
  select * into v_class from public.classes where id=p_class_id and teacher_id=(select auth.uid());
  if not found then raise exception 'Only this class teacher can export attendance' using errcode='42501'; end if;
  with counted_meetings as (
    select m.id,m.starts_at,m.ends_at,
      (m.ends_at<=now() and (m.attendance_mode='teacher_manual' or m.attendance_closes_at<=now())) as is_closed
    from public.meetings m where m.class_id=p_class_id and m.attendance_enabled and m.starts_at<=now()
      and (v_class.archived_at is null or m.starts_at<v_class.archived_at)
      and not exists(select 1 from private.class_archive_periods a where a.class_id=m.class_id
        and (a.restored_at is null or a.restored_at>a.archived_at)
        and m.ends_at>a.archived_at and (a.restored_at is null or m.starts_at<a.restored_at))
  ), roster as (
    select e.student_id from public.class_enrollments e where e.class_id=p_class_id
    union select p.student_id from private.class_enrollment_periods p where p.class_id=p_class_id
    union select a.student_id from public.attendance_records a join public.meetings m on m.id=a.meeting_id where m.class_id=p_class_id
  ), opportunities as (
    select s.student_id,m.id,
      case when a.status='present' and a.verification_status is distinct from 'rejected'::public.attendance_verification_status then 'present' else 'absent' end as attendance
    from roster s cross join counted_meetings m
    left join public.attendance_records a on a.meeting_id=m.id and a.student_id=s.student_id
    where a.id is not null or (m.is_closed and exists(
      select 1 from private.class_enrollment_periods p where p.class_id=p_class_id and p.student_id=s.student_id
        and p.enrolled_at<=m.ends_at and (p.withdrawn_at is null or m.ends_at<=p.withdrawn_at)
    ))
  ), totals_by_student as (
    select r.student_id,p.first_name,p.last_name,p.full_name,coalesce(e.is_active,false) as is_active,
      count(o.id) filter(where o.attendance='present')::integer as present_count,
      count(o.id) filter(where o.attendance='absent')::integer as absent_count,count(o.id)::integer as total_count
    from roster r join public.profiles p on p.id=r.student_id and p.role='student'
    left join public.class_enrollments e on e.class_id=p_class_id and e.student_id=r.student_id
    left join opportunities o on o.student_id=r.student_id
    group by r.student_id,p.first_name,p.last_name,p.full_name,e.is_active
  )
  select jsonb_build_object(
    'class_id',v_class.id,'class_name',v_class.name,
    'teacher_name',(select full_name from public.profiles where id=(select auth.uid())),
    'as_of',now(),'meeting_count',(select count(*) from counted_meetings m where m.is_closed or exists(select 1 from opportunities o where o.id=m.id)),
    'students',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('attendance_rate',round(100.0*s.present_count/nullif(s.total_count,0),2)) order by s.last_name,s.first_name,s.student_id) from totals_by_student s),'[]'::jsonb),
    'totals',jsonb_build_object('student_count',count(*),'present_count',coalesce(sum(s.present_count),0),
      'absent_count',coalesce(sum(s.absent_count),0),'total_count',coalesce(sum(s.total_count),0),
      'attendance_rate',round(100.0*sum(s.present_count)/nullif(sum(s.total_count),0),2)),
    'accounting_note','NOT-COUNTED, ARCHIVED AND FUTURE MEETINGS ARE EXCLUDED. MISSING CHECK-INS COUNT AS ABSENT ONLY AFTER CLASS AND CHECK-IN CLOSE. KNOWN ENROLLMENT PERIODS ARE RESPECTED; LEGACY WITHDRAWN STUDENTS RETAIN RECORDED ATTENDANCE ONLY.'
  ) into v_result from totals_by_student s;
  return v_result;
end; $$;
create function public.teacher_class_attendance_report(p_class_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$ select private.teacher_class_attendance_report_impl(p_class_id) $$;
revoke all on function private.teacher_class_attendance_report_impl(uuid),public.teacher_class_attendance_report(uuid) from public,anon,authenticated;
grant execute on function private.teacher_class_attendance_report_impl(uuid),public.teacher_class_attendance_report(uuid) to authenticated;

-- Use the same archive-window accounting in student/parent history. Actual
-- evidence is retained and viewable but marked not counted during archives.
create or replace function private.student_attendance_history_impl(p_student_id uuid)
returns table(id uuid,attendance_id uuid,meeting_id uuid,class_id uuid,student_id uuid,
  status public.attendance_status,source public.attendance_source,verification_status public.attendance_verification_status,
  selfie_path text,latitude double precision,longitude double precision,accuracy_m double precision,distance_m double precision,
  submitted_at timestamptz,meeting_starts_at timestamptz,meeting_ends_at timestamptz,class_name text,
  attendance_enabled boolean,attendance_mode public.attendance_mode,review_note text,teacher_note text,face_verified boolean,is_inferred boolean,location_status text)
language plpgsql stable security definer set search_path='' as $$
declare v_student uuid:=coalesce(p_student_id,(select auth.uid()));
begin
  if(select auth.uid()) is null or not coalesce((private.current_profile_role()='student' and v_student=(select auth.uid()))
    or(private.current_profile_role()='parent' and private.parent_has_student(v_student)),false) then
    raise exception 'Only the student or a verified linked parent can view this history' using errcode='42501'; end if;
  return query with eligible as (
    select m.id from public.meetings m join public.class_enrollments e on e.class_id=m.class_id join public.classes c on c.id=m.class_id
      where e.student_id=v_student and e.is_active and m.ends_at<=now() and e.joined_at<=m.ends_at
        and(not m.attendance_enabled or m.attendance_mode='teacher_manual' or m.attendance_closes_at<=now())
        and(c.archived_at is null or m.starts_at<c.archived_at)
        and not exists(select 1 from private.class_archive_periods a where a.class_id=m.class_id
          and (a.restored_at is null or a.restored_at>a.archived_at)
          and m.ends_at>a.archived_at and (a.restored_at is null or m.starts_at<a.restored_at))
    union select a.meeting_id from public.attendance_records a where a.student_id=v_student
  )
  select coalesce(a.id,m.id),a.id,m.id,m.class_id,v_student,coalesce(a.status,'absent'::public.attendance_status),a.source,a.verification_status,
    a.selfie_path,case when m.attendance_mode='self_online' then null else a.latitude end,
    case when m.attendance_mode='self_online' then null else a.longitude end,
    case when m.attendance_mode='self_online' then null else a.accuracy_m end,
    case when m.attendance_mode='self_online' then null else a.distance_m end,
    a.submitted_at,m.starts_at,m.ends_at,c.name,
    m.attendance_enabled and not exists(select 1 from private.class_archive_periods x where x.class_id=m.class_id
      and (x.restored_at is null or x.restored_at>x.archived_at)
      and m.ends_at>x.archived_at and (x.restored_at is null or m.starts_at<x.restored_at)),m.attendance_mode,
    a.review_note,a.teacher_note,coalesce(a.face_verified,false),a.id is null,
    case when a.status='present' and a.source='teacher' then 'teacher_confirmed_on_campus'
      when a.status='present' and a.source='self_check' and m.attendance_mode='self_online' then 'parent_private'
      when a.status='present' and a.source='self_check' and a.distance_m<=m.radius_m then 'gps_on_campus' else 'not_recorded' end
  from eligible x join public.meetings m on m.id=x.id join public.classes c on c.id=m.class_id
  left join public.attendance_records a on a.meeting_id=m.id and a.student_id=v_student order by m.starts_at desc,m.id desc;
end; $$;

-- Match the requested 30-minute Auth email lifetime without extending a lost
-- invitation's resend wait. Hourly actor quotas remain unchanged.
create or replace function private.reserve_parent_invitation_impl(p_actor uuid,p_email text)
returns table(invitation_id uuid,should_send boolean) language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles%rowtype; v_email text:=lower(btrim(p_email)); v_existing private.parent_invitations%rowtype; v_limit integer;
begin
  select * into v_profile from public.profiles where id=p_actor for update;
  if not found or v_profile.onboarding_completed_at is null or v_profile.role not in('student','teacher','admin')
    or(v_profile.role='teacher' and v_profile.teacher_approval_status is distinct from 'approved'::public.teacher_approval_status)
    or not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null) then
    raise exception 'Only verified students, approved teachers and administrators can invite parents' using errcode='42501'; end if;
  if v_email is null or v_email!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(v_email)>320 then
    raise exception 'Enter a valid parent email' using errcode='22023'; end if;
  v_limit:=case v_profile.role when 'admin' then 50 when 'teacher' then 20 else 5 end;
  if(select count(*) from private.parent_invitations where invited_by=p_actor and requested_at>now()-interval '1 hour')>=v_limit then
    raise exception 'Please wait before sending more parent invitations' using errcode='42901'; end if;
  select * into v_existing from private.parent_invitations where email=v_email for update;
  if exists(select 1 from auth.users where lower(email)=v_email) and not exists(
    select 1 from auth.users u join public.profiles p on p.id=u.id
    where lower(u.email)=v_email and u.email_confirmed_at is null and p.role='parent'
      and p.onboarding_completed_at is null and v_existing.id is not null
  ) then return query select null::uuid,false; return; end if;
  if v_existing.id is not null and v_existing.requested_at>now()-interval '30 minutes' then
    return query select v_existing.id,false; return; end if;
  insert into private.parent_invitations as i(email,invited_by,student_id)
    values(v_email,p_actor,case when v_profile.role='student' then p_actor else null end)
    on conflict(email) do update set id=gen_random_uuid(),invited_by=excluded.invited_by,requested_at=now(),status='reserved',sent_at=null,
      student_id=coalesce(i.student_id,excluded.student_id) where i.requested_at<=now()-interval '30 minutes'
    returning i.id into invitation_id;
  should_send:=invitation_id is not null; return next;
end; $$;
revoke all on function private.reserve_parent_invitation_impl(uuid,text) from public,anon,authenticated;
grant execute on function private.reserve_parent_invitation_impl(uuid,text) to service_role;
