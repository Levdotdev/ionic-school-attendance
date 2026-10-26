-- A deleted open-meeting record removes its status state. A later mark must
-- create a new event even when the restarted state revision is again one.
create or replace function private.enqueue_attendance_alert(p_meeting uuid,p_student uuid,p_status text)
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
  v_event:='attendance:'||p_meeting::text||':'||p_student::text||':'||v_state.revision::text||':'||gen_random_uuid()::text;
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
