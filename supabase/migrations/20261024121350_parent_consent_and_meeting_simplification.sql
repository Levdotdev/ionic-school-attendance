-- Matching an email is not parental consent. Existing links become pending
-- requests; attendance history, evidence and class enrollments are retained.
create table public.guardian_link_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  parent_id uuid not null references public.profiles(id) on delete cascade,
  parent_email text not null check(parent_email=lower(btrim(parent_email)) and char_length(parent_email)<=320),
  status text not null default 'pending' check(status in('pending','approved','rejected')),
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  review_note text check(review_note is null or char_length(review_note)<=500),
  unique(student_id,parent_id),check(student_id<>parent_id)
);
create index guardian_link_requests_parent_idx on public.guardian_link_requests(parent_id,status,requested_at desc);
alter table public.guardian_link_requests enable row level security;
create policy guardian_link_requests_participants on public.guardian_link_requests for select to authenticated
  using(student_id=(select auth.uid()) or parent_id=(select auth.uid()));
revoke all on public.guardian_link_requests from public,anon,authenticated;
grant select on public.guardian_link_requests to authenticated;
grant all on public.guardian_link_requests to service_role;
insert into public.guardian_link_requests(student_id,parent_id,parent_email)
  select g.student_id,g.parent_id,g.verified_guardian_email from public.guardian_links g
  join public.profiles p on p.id=g.parent_id and p.role='parent'
  on conflict(student_id,parent_id) do nothing;
delete from public.guardian_links;
comment on table public.guardian_links is 'Approved links only, created by the verified parent making an explicit consent decision.';

create or replace function private.link_parent_by_verified_email(p_parent_id uuid,p_verified_email text)
returns void language plpgsql security definer set search_path='' as $$
begin
  -- Email changes revoke old access; they cannot silently transfer consent.
  delete from public.guardian_links where parent_id=p_parent_id and verified_guardian_email<>lower(btrim(p_verified_email));
  update public.guardian_link_requests set status='rejected',responded_at=now(),review_note='Email changed. Request a new link with the current email.'
    where parent_id=p_parent_id and parent_email<>lower(btrim(p_verified_email)) and status<>'rejected';
end; $$;
create or replace function private.link_guardians_for_student(p_student_id uuid,p_guardian_email text)
returns void language plpgsql security definer set search_path='' as $$
declare v_email text:=nullif(lower(btrim(p_guardian_email)),''); v_parent uuid; v_existing public.guardian_link_requests%rowtype;
begin
  if v_email is null then return; end if;
  select p.id into v_parent from public.profiles p join auth.users u on u.id=p.id
    where p.role='parent' and p.onboarding_completed_at is not null and lower(u.email)=v_email and u.email_confirmed_at is not null;
  if v_parent is null then
    raise exception 'This email is not a registered, verified parent. Invite the parent to register first.' using errcode='22023'; end if;
  if not exists(select 1 from public.profiles where id=p_student_id and role='student') then
    raise exception 'Student profile not found' using errcode='22023'; end if;
  perform 1 from public.profiles where id=p_student_id for update;
  select * into v_existing from public.guardian_link_requests where student_id=p_student_id and parent_id=v_parent;
  if found and v_existing.parent_email=v_email then
    -- Repeating registration or clicking Request twice is idempotent.
    if v_existing.status in('pending','approved') then return; end if;
    if v_existing.responded_at>now()-interval '1 day' then
      raise exception 'This parent declined the request. Wait 24 hours before requesting again.' using errcode='42901'; end if;
  end if;
  if v_existing.id is null and(select count(*) from public.guardian_link_requests
    where student_id=p_student_id and requested_at>now()-interval '1 day')>=5 then
    raise exception 'Please wait before sending more parent link requests' using errcode='42901'; end if;
  insert into public.guardian_link_requests as r(student_id,parent_id,parent_email) values(p_student_id,v_parent,v_email)
    on conflict(student_id,parent_id) do update set parent_email=excluded.parent_email,
      status=case when r.status='approved' and r.parent_email=excluded.parent_email then r.status else 'pending' end,
      requested_at=case when r.status='approved' and r.parent_email=excluded.parent_email then r.requested_at else now() end,
      responded_at=case when r.status='approved' and r.parent_email=excluded.parent_email then r.responded_at else null end,
      review_note=case when r.status='approved' and r.parent_email=excluded.parent_email then r.review_note else null end;
end; $$;
revoke all on function private.link_parent_by_verified_email(uuid,text),private.link_guardians_for_student(uuid,text) from public,anon,authenticated;

create function private.request_student_parent_link_impl(p_parent_email text)
returns public.guardian_link_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_email text:=lower(btrim(p_parent_email)); v_result public.guardian_link_requests%rowtype;
begin
  if v_actor is null or private.current_profile_role() is distinct from 'student'::public.app_role then
    raise exception 'Only a student can request a parent link' using errcode='42501'; end if;
  if v_email is null or char_length(v_email)>320 or position('@' in v_email)<=1 then
    raise exception 'Enter a registered parent email' using errcode='22023'; end if;
  if not exists(select 1 from public.student_profiles where user_id=v_actor and registration_completed_at is not null) then
    raise exception 'Complete student ID registration first' using errcode='42501'; end if;
  perform 1 from public.profiles where id=v_actor for update;
  if (select count(*) from public.guardian_link_requests where student_id=v_actor and requested_at>now()-interval '1 day')>=5
    and not exists(select 1 from public.guardian_link_requests where student_id=v_actor and parent_email=v_email) then
    raise exception 'Please wait before sending more parent link requests' using errcode='42901'; end if;
  perform private.link_guardians_for_student(v_actor,v_email);
  update public.student_profiles set guardian_email=v_email where user_id=v_actor;
  select * into v_result from public.guardian_link_requests where student_id=v_actor and parent_email=v_email;
  return v_result;
end; $$;
create function public.request_student_parent_link(p_parent_email text)
returns public.guardian_link_requests language sql security invoker set search_path='' as $$
  select private.request_student_parent_link_impl(p_parent_email)
$$;
create function private.my_parent_link_requests_impl()
returns table(id uuid,student_id uuid,parent_id uuid,parent_email text,status text,requested_at timestamptz,
  responded_at timestamptz,review_note text,student_name text,student_email text,parent_name text)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or private.current_profile_role() is distinct from 'parent'::public.app_role then
    raise exception 'Parent access required' using errcode='42501'; end if;
  return query select r.id,r.student_id,r.parent_id,r.parent_email,r.status,r.requested_at,r.responded_at,r.review_note,
    s.full_name,s.email,p.full_name from public.guardian_link_requests r
    join public.profiles s on s.id=r.student_id join public.profiles p on p.id=r.parent_id join auth.users u on u.id=r.parent_id
    where r.parent_id=(select auth.uid()) and lower(u.email)=r.parent_email and u.email_confirmed_at is not null order by r.requested_at desc;
end; $$;
create function public.my_parent_link_requests()
returns table(id uuid,student_id uuid,parent_id uuid,parent_email text,status text,requested_at timestamptz,
  responded_at timestamptz,review_note text,student_name text,student_email text,parent_name text)
language sql stable security invoker set search_path='' as $$ select * from private.my_parent_link_requests_impl() $$;
create function private.respond_to_parent_link_request_impl(p_request_id uuid,p_approve boolean,p_note text)
returns public.guardian_link_requests language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_request public.guardian_link_requests%rowtype;
begin
  if v_actor is null or private.current_profile_role() is distinct from 'parent'::public.app_role then
    raise exception 'Only the requested parent can verify this student' using errcode='42501'; end if;
  if p_approve is null or char_length(coalesce(p_note,''))>500 then raise exception 'Invalid parent decision' using errcode='22023'; end if;
  select * into v_request from public.guardian_link_requests where id=p_request_id and parent_id=v_actor for update;
  if not found or not exists(select 1 from auth.users where id=v_actor and email_confirmed_at is not null and lower(email)=v_request.parent_email) then
    raise exception 'Only the requested, email-verified parent can decide this request' using errcode='42501'; end if;
  if not exists(select 1 from public.profiles where id=v_request.student_id and role='student') then
    raise exception 'Student profile not found' using errcode='22023'; end if;
  update public.guardian_link_requests set status=case when p_approve then 'approved' else 'rejected' end,
    responded_at=now(),review_note=nullif(btrim(p_note),'') where id=p_request_id returning * into v_request;
  if p_approve then
    insert into public.guardian_links(parent_id,student_id,verified_guardian_email) values(v_actor,v_request.student_id,v_request.parent_email)
      on conflict(parent_id,student_id) do update set verified_guardian_email=excluded.verified_guardian_email;
  else delete from public.guardian_links where parent_id=v_actor and student_id=v_request.student_id; end if;
  return v_request;
end; $$;
create function public.respond_to_parent_link_request(p_request_id uuid,p_approve boolean,p_note text default null)
returns public.guardian_link_requests language sql security invoker set search_path='' as $$
  select private.respond_to_parent_link_request_impl(p_request_id,p_approve,p_note)
$$;
create function private.student_guardian_summary_impl(p_student_id uuid)
returns table(request_id uuid,parent_id uuid,parent_name text,parent_email text,status text,requested_at timestamptz,responded_at timestamptz,review_note text)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null or not coalesce(p_student_id=(select auth.uid()) or private.current_profile_role()='admin'
    or private.teacher_has_student(p_student_id),false) then
    raise exception 'Only the student, their teacher or an administrator can view parent links' using errcode='42501'; end if;
  return query select r.id,r.parent_id,p.full_name,r.parent_email,r.status,r.requested_at,r.responded_at,r.review_note
    from public.guardian_link_requests r join public.profiles p on p.id=r.parent_id where r.student_id=p_student_id order by r.requested_at desc;
end; $$;
create function public.student_guardian_summary(p_student_id uuid)
returns table(request_id uuid,parent_id uuid,parent_name text,parent_email text,status text,requested_at timestamptz,responded_at timestamptz,review_note text)
language sql stable security invoker set search_path='' as $$ select * from private.student_guardian_summary_impl(p_student_id) $$;
revoke all on function private.request_student_parent_link_impl(text),public.request_student_parent_link(text),private.my_parent_link_requests_impl(),public.my_parent_link_requests(),
  private.respond_to_parent_link_request_impl(uuid,boolean,text),public.respond_to_parent_link_request(uuid,boolean,text),
  private.student_guardian_summary_impl(uuid),public.student_guardian_summary(uuid) from public,anon,authenticated;
grant execute on function private.request_student_parent_link_impl(text),public.request_student_parent_link(text),private.my_parent_link_requests_impl(),public.my_parent_link_requests(),
  private.respond_to_parent_link_request_impl(uuid,boolean,text),public.respond_to_parent_link_request(uuid,boolean,text),
  private.student_guardian_summary_impl(uuid),public.student_guardian_summary(uuid) to authenticated;

create function private.student_has_approved_parent(p_student_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.guardian_links g join public.profiles p on p.id=g.parent_id and p.role='parent'
    join auth.users u on u.id=g.parent_id join public.guardian_link_requests r on r.parent_id=g.parent_id and r.student_id=g.student_id and r.status='approved'
    where g.student_id=p_student_id and u.email_confirmed_at is not null and lower(u.email)=g.verified_guardian_email and r.parent_email=g.verified_guardian_email)
$$;
revoke all on function private.student_has_approved_parent(uuid) from public,anon,authenticated;
create function private.require_parent_for_new_enrollment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.is_active and (tg_op='INSERT' or not old.is_active or new.class_id<>old.class_id or new.student_id<>old.student_id)
    and not private.student_has_approved_parent(new.student_id) then
    raise exception 'A registered parent must approve your link before you can join a class' using errcode='42501'; end if;
  return new;
end; $$;
revoke all on function private.require_parent_for_new_enrollment() from public,anon,authenticated;
create trigger require_parent_for_new_enrollment before insert or update on public.class_enrollments for each row execute function private.require_parent_for_new_enrollment();
create or replace function private.join_class_impl(p_join_code text)
returns public.classes language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_class public.classes%rowtype;
begin
  if v_actor is null or private.current_profile_role() is distinct from 'student'::public.app_role then
    raise exception 'Only a student can join a class' using errcode='42501'; end if;
  if not exists(select 1 from public.student_profiles where user_id=v_actor and registration_completed_at is not null) then
    raise exception 'Complete student registration before joining a class' using errcode='42501'; end if;
  select * into v_class from public.classes where join_code=upper(btrim(p_join_code)) for share;
  if not found then raise exception 'Class code not found' using errcode='P0002'; end if;
  if v_class.archived_at is not null then raise exception 'This class has been archived' using errcode='22023'; end if;
  if not private.student_has_approved_parent(v_actor) then
    raise exception 'A registered parent must approve your link before you can join a class' using errcode='42501'; end if;
  insert into public.class_enrollments(class_id,student_id,is_active) values(v_class.id,v_actor,true)
    on conflict(class_id,student_id) do update set is_active=true;
  return v_class;
end; $$;
create function private.guardian_request_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_student uuid:=coalesce(new.student_id,old.student_id); v_user uuid;
begin
  perform private.notify_portal_student(v_student); perform private.notify_portal_user(coalesce(new.parent_id,old.parent_id));
  for v_user in select distinct c.teacher_id from public.classes c join public.class_enrollments e on e.class_id=c.id where e.student_id=v_student and e.is_active
    union select id from public.profiles where role='admin'
  loop perform private.notify_portal_user(v_user); end loop;
  return coalesce(new,old);
end; $$;
revoke all on function private.guardian_request_changed() from public,anon,authenticated;
create trigger guardian_request_changed after insert or update or delete on public.guardian_link_requests for each row execute function private.guardian_request_changed();

-- Server-only reservations authorize parent onboarding, not arbitrary roles.
-- The browser never receives service credentials or an account directory.
create table private.parent_invitations (
  id uuid primary key default gen_random_uuid(), email text not null unique,
  invited_by uuid references public.profiles(id) on delete set null,
  student_id uuid references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),sent_at timestamptz,
  status text not null default 'reserved' check(status in('reserved','sent','failed')),
  check(email=lower(btrim(email)) and char_length(email) between 3 and 320)
);
create index parent_invitations_actor_idx on private.parent_invitations(invited_by,requested_at desc);
create index parent_invitations_student_idx on private.parent_invitations(student_id) where student_id is not null;
alter table private.parent_invitations enable row level security;
create policy parent_invitations_deny_clients on private.parent_invitations for all to public using(false) with check(false);
revoke all on private.parent_invitations from public,anon,authenticated;
grant all on private.parent_invitations to service_role;
create function private.reserve_parent_invitation_impl(p_actor uuid,p_email text)
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
  -- Auth can resend an invitation to an unconfirmed account. Only do so for
  -- a trusted parent invitation, never an arbitrary existing signup/account.
  if exists(select 1 from auth.users where lower(email)=v_email) and not exists(
    select 1 from auth.users u join public.profiles p on p.id=u.id
    where lower(u.email)=v_email and u.email_confirmed_at is null and p.role='parent'
      and p.onboarding_completed_at is null and v_existing.id is not null
  ) then return query select null::uuid,false; return; end if;
  if v_existing.id is not null and v_existing.requested_at>now()-interval '1 hour' then
    return query select v_existing.id,false; return; end if;
  insert into private.parent_invitations as i(email,invited_by,student_id)
    values(v_email,p_actor,case when v_profile.role='student' then p_actor else null end)
    on conflict(email) do update set id=gen_random_uuid(),invited_by=excluded.invited_by,requested_at=now(),status='reserved',sent_at=null,
      student_id=coalesce(i.student_id,excluded.student_id) where i.requested_at<=now()-interval '1 hour'
    returning i.id into invitation_id;
  should_send:=invitation_id is not null; return next;
end; $$;
create function public.reserve_parent_invitation(p_actor uuid,p_email text)
returns table(invitation_id uuid,should_send boolean) language sql security invoker set search_path='' as $$
  select * from private.reserve_parent_invitation_impl(p_actor,p_email)
$$;
create function private.finish_parent_invitation_impl(p_invitation_id uuid,p_sent boolean)
returns void language sql security definer set search_path='' as $$
  update private.parent_invitations set status=case when p_sent then 'sent' else 'failed' end,
    sent_at=case when p_sent then now() else null end where id=p_invitation_id and status='reserved'
$$;
create function public.finish_parent_invitation(p_invitation_id uuid,p_sent boolean)
returns void language sql security invoker set search_path='' as $$ select private.finish_parent_invitation_impl(p_invitation_id,p_sent) $$;
revoke all on function private.reserve_parent_invitation_impl(uuid,text),public.reserve_parent_invitation(uuid,text),
  private.finish_parent_invitation_impl(uuid,boolean),public.finish_parent_invitation(uuid,boolean) from public,anon,authenticated;
grant execute on function private.reserve_parent_invitation_impl(uuid,text),public.reserve_parent_invitation(uuid,text),
  private.finish_parent_invitation_impl(uuid,boolean),public.finish_parent_invitation(uuid,boolean) to service_role;
create function private.my_parent_invitation_impl()
returns boolean language sql stable security definer set search_path='' as $$
  select(select auth.uid()) is not null and exists(select 1 from private.parent_invitations i
    join auth.users u on lower(u.email)=i.email where u.id=(select auth.uid()))
$$;
create function public.my_parent_invitation()
returns boolean language sql stable security invoker set search_path='' as $$ select private.my_parent_invitation_impl() $$;
revoke all on function private.my_parent_invitation_impl(),public.my_parent_invitation() from public,anon,authenticated;
grant execute on function private.my_parent_invitation_impl(),public.my_parent_invitation() to authenticated;
create or replace function private.handle_auth_user_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_email text:=lower(btrim(new.email)); v_invited boolean;
begin
  v_invited:=exists(select 1 from private.parent_invitations where email=v_email);
  insert into public.profiles(id,role,full_name,email,onboarding_completed_at)
    values(new.id,case when v_invited then 'parent'::public.app_role else 'student'::public.app_role end,
      coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'),''),nullif(btrim(new.raw_user_meta_data->>'name'),''),
      nullif(split_part(v_email,'@',1),''),'User'),v_email,null)
    on conflict(id) do update set email=excluded.email;
  if new.email_confirmed_at is not null then perform private.link_parent_by_verified_email(new.id,v_email); end if;
  return new;
end; $$;
create or replace function private.complete_account_setup_impl(p_full_name text,p_role text)
returns public.profiles language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_name text:=btrim(p_full_name); v_role text:=lower(btrim(p_role));
  v_profile public.profiles%rowtype; v_invited boolean; v_inviter uuid;
begin
  if v_actor is null then raise exception 'Sign in before completing account setup' using errcode='42501'; end if;
  if v_name is null or char_length(v_name) not between 2 and 120 then
    raise exception 'Full name must contain between 2 and 120 characters' using errcode='22023'; end if;
  if v_role is null or v_role not in('student','teacher','parent') then
    raise exception 'Choose student, teacher, or parent' using errcode='22023'; end if;
  if not exists(select 1 from auth.users where id=v_actor and email_confirmed_at is not null) then
    raise exception 'Confirm your email before completing account setup' using errcode='42501'; end if;
  select * into v_profile from public.profiles where id=v_actor for update;
  v_invited:=private.my_parent_invitation_impl();
  if v_profile.id is null or v_profile.onboarding_completed_at is not null or(v_profile.role<>'student' and not(v_invited and v_profile.role='parent')) then
    raise exception 'Account setup is already complete. Contact the administrator to change roles.' using errcode='42501'; end if;
  if v_invited and v_role<>'parent' then
    raise exception 'This invitation is for a parent account. Complete parent setup.' using errcode='42501'; end if;
  if v_role<>'student' and(exists(select 1 from public.student_profiles where user_id=v_actor)
    or exists(select 1 from public.class_enrollments where student_id=v_actor)
    or exists(select 1 from public.attendance_records where student_id=v_actor)
    or exists(select 1 from public.student_tasks where student_id=v_actor)
    or exists(select 1 from public.student_task_categories where student_id=v_actor)) then
    raise exception 'This account already has student records. Contact the administrator to change roles.' using errcode='42501'; end if;
  update public.profiles set full_name=v_name,role=v_role::public.app_role,
    teacher_approval_status=case when v_role='teacher' then 'pending'::public.teacher_approval_status else null end,
    teacher_approval_note=null,teacher_approved_by=null,teacher_approved_at=null,onboarding_completed_at=now()
    where id=v_actor returning * into v_profile;
  -- A student-originated invitation becomes a request only after the parent
  -- finishes verified registration. The parent must still explicitly accept.
  if v_role='parent' and v_invited then
    select i.student_id into v_inviter from private.parent_invitations i join auth.users u on lower(u.email)=i.email
      join public.profiles s on s.id=i.student_id and s.role='student'
      join public.student_profiles sp on sp.user_id=s.id and sp.registration_completed_at is not null
      where u.id=v_actor;
    if v_inviter is not null then
      insert into public.guardian_link_requests(student_id,parent_id,parent_email) values(v_inviter,v_actor,v_profile.email)
        on conflict(student_id,parent_id) do nothing;
    end if;
  end if;
  return v_profile;
end; $$;

-- Meetings use course + date/time. Replace their explicit dependents without
-- CASCADE, preserving all other columns, attendance and stored evidence.
drop view public.student_available_meetings;
drop function public.student_attendance_history(uuid);
drop function private.student_attendance_history_impl(uuid);
alter table public.meetings drop column title;
create or replace function private.generate_schedule_week(p_week_start date,p_class_id uuid,p_imminent_at timestamptz)
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
  with candidates as (
    select s.*,c.teacher_id,c.default_max_accuracy_m,
      (p_week_start+case when s.day_of_week=0 then 6 else s.day_of_week-1 end)::date as occurrence_date
    from public.class_schedules s join public.classes c on c.id=s.class_id
    join public.profiles t on t.id=c.teacher_id and t.role='teacher' and t.teacher_approval_status='approved'
    where s.is_active and c.archived_at is null and(p_class_id is null or c.id=p_class_id)
  ), inserted as (
    insert into public.meetings(class_id,schedule_id,schedule_week_start,meeting_date,starts_at,ends_at,
      attendance_mode,attendance_enabled,attendance_opens_at,attendance_closes_at,latitude,longitude,radius_m,max_accuracy_m,created_by)
    select c.class_id,c.id,p_week_start,c.occurrence_date,(c.occurrence_date+c.starts_at) at time zone 'Asia/Manila',
      (c.occurrence_date+c.ends_at) at time zone 'Asia/Manila',c.attendance_mode,true,
      (c.occurrence_date+c.starts_at) at time zone 'Asia/Manila',
      case when c.check_in_minutes_after_start is null then(c.occurrence_date+c.ends_at) at time zone 'Asia/Manila'
        else((c.occurrence_date+c.starts_at) at time zone 'Asia/Manila')+make_interval(mins=>c.check_in_minutes_after_start::integer) end,
      case when c.attendance_mode='self_online' then null else 13.387419 end,
      case when c.attendance_mode='self_online' then null else 121.162494 end,180,c.default_max_accuracy_m,c.teacher_id
    from candidates c where not exists(select 1 from private.schedule_meeting_exceptions x where x.schedule_id=c.id and x.schedule_week_start=p_week_start)
      and(p_imminent_at is null or((c.occurrence_date+c.starts_at) at time zone 'Asia/Manila'>=p_imminent_at
        and(c.occurrence_date+c.starts_at) at time zone 'Asia/Manila'<p_imminent_at+interval '3 hours'))
    on conflict(schedule_id,schedule_week_start) where schedule_id is not null and schedule_week_start is not null do nothing returning 1
  ) select count(*)::integer into v_count from inserted;
  return v_count;
end; $$;
alter table public.class_schedules drop constraint class_schedules_check_in_minutes_range;
update public.class_schedules set check_in_minutes_before=0;
alter table public.class_schedules alter column check_in_minutes_before set default 0;
alter table public.class_schedules add constraint class_schedules_check_in_starts_at_class check(check_in_minutes_before=0);
comment on column public.class_schedules.check_in_minutes_before is 'Compatibility field fixed at zero. Check-in begins at class start.';
create function private.enforce_check_in_class_start()
returns trigger language plpgsql security invoker set search_path='' as $$
begin new.attendance_opens_at:=new.starts_at; return new; end; $$;
revoke all on function private.enforce_check_in_class_start() from public,anon,authenticated;
create trigger meetings_check_in_class_start before insert or update of starts_at,attendance_opens_at on public.meetings
  for each row execute function private.enforce_check_in_class_start();
update public.meetings set attendance_opens_at=starts_at,
  attendance_closes_at=greatest(attendance_closes_at,starts_at+interval '1 minute') where ends_at>=now();
create view public.student_available_meetings with(security_invoker=true) as
select m.id,m.class_id,c.name as class_name,m.meeting_date,m.starts_at,m.ends_at,m.attendance_mode,
  m.attendance_enabled,m.attendance_opens_at,m.attendance_closes_at,m.max_accuracy_m,a.status as existing_status,a.submitted_at
from public.meetings m join public.classes c on c.id=m.class_id and c.archived_at is null
join public.class_enrollments e on e.class_id=m.class_id and e.student_id=(select auth.uid()) and e.is_active
left join public.attendance_records a on a.meeting_id=m.id and a.student_id=e.student_id
where m.attendance_enabled and m.attendance_mode in('self_on_site','self_online')
  and now() between m.starts_at and m.attendance_closes_at and a.id is null;
revoke all on public.student_available_meetings from public,anon,authenticated;
grant select on public.student_available_meetings to authenticated;
create function private.student_attendance_history_impl(p_student_id uuid)
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
    union select a.meeting_id from public.attendance_records a where a.student_id=v_student
  )
  select coalesce(a.id,m.id),a.id,m.id,m.class_id,v_student,coalesce(a.status,'absent'::public.attendance_status),a.source,a.verification_status,
    a.selfie_path,case when m.attendance_mode='self_online' then null else a.latitude end,
    case when m.attendance_mode='self_online' then null else a.longitude end,
    case when m.attendance_mode='self_online' then null else a.accuracy_m end,
    case when m.attendance_mode='self_online' then null else a.distance_m end,
    a.submitted_at,m.starts_at,m.ends_at,c.name,m.attendance_enabled,m.attendance_mode,
    a.review_note,a.teacher_note,coalesce(a.face_verified,false),a.id is null,
    case when a.status='present' and a.source='teacher' then 'teacher_confirmed_on_campus'
      when a.status='present' and a.source='self_check' and m.attendance_mode='self_online' then 'parent_private'
      when a.status='present' and a.source='self_check' and a.distance_m<=m.radius_m then 'gps_on_campus' else 'not_recorded' end
  from eligible x join public.meetings m on m.id=x.id join public.classes c on c.id=m.class_id
  left join public.attendance_records a on a.meeting_id=m.id and a.student_id=v_student order by m.starts_at desc,m.id desc;
end; $$;
create function public.student_attendance_history(p_student_id uuid default null)
returns table(id uuid,attendance_id uuid,meeting_id uuid,class_id uuid,student_id uuid,
  status public.attendance_status,source public.attendance_source,verification_status public.attendance_verification_status,
  selfie_path text,latitude double precision,longitude double precision,accuracy_m double precision,distance_m double precision,
  submitted_at timestamptz,meeting_starts_at timestamptz,meeting_ends_at timestamptz,class_name text,
  attendance_enabled boolean,attendance_mode public.attendance_mode,review_note text,teacher_note text,face_verified boolean,is_inferred boolean,location_status text)
language sql stable security invoker set search_path='' as $$ select * from private.student_attendance_history_impl(p_student_id) $$;
revoke all on function private.student_attendance_history_impl(uuid),public.student_attendance_history(uuid) from public,anon,authenticated;
grant execute on function private.student_attendance_history_impl(uuid),public.student_attendance_history(uuid) to authenticated;
