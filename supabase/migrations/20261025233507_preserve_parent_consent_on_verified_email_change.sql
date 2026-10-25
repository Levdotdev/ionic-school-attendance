-- Consent belongs to the verified parent's account ID. A confirmed email
-- change on that same account updates contact snapshots without revoking it.
create or replace function private.link_parent_by_verified_email(p_parent_id uuid,p_verified_email text)
returns void language plpgsql security definer set search_path='' as $$
declare v_email text:=nullif(lower(btrim(p_verified_email)),''); v_request public.guardian_link_requests%rowtype;
begin
  if v_email is null or not exists(
    select 1 from auth.users u join public.profiles p on p.id=u.id
    where u.id=p_parent_id and p.role='parent' and u.email_confirmed_at is not null
      and lower(u.email)=v_email
  ) then return; end if;

  for v_request in select * from public.guardian_link_requests
    where parent_id=p_parent_id and parent_email<>v_email order by student_id for update
  loop
    update public.guardian_link_requests set parent_email=v_email where id=v_request.id;
    update public.guardian_links set verified_guardian_email=v_email
      where parent_id=p_parent_id and student_id=v_request.student_id;
    -- Keep the student's saved contact in step, but never turn a declined
    -- request back into a new request through the registration trigger.
    if v_request.status in('approved','pending') then
      update public.student_profiles set guardian_email=v_email
        where user_id=v_request.student_id and guardian_email=v_request.parent_email;
    end if;
  end loop;
end; $$;
revoke all on function private.link_parent_by_verified_email(uuid,text) from public,anon,authenticated;

-- The old implementation used the same rejection note for both pending and
-- approved requests. Reopen only those automatic rejections for confirmation;
-- never invent an approval or override a parent's intentional rejection.
do $$
declare v_request record;
begin
  for v_request in select r.id,r.student_id,r.parent_email,lower(u.email) as current_email
    from public.guardian_link_requests r join auth.users u on u.id=r.parent_id
    join public.profiles p on p.id=u.id
    where p.role='parent' and u.email_confirmed_at is not null and r.status='rejected'
      and lower(r.review_note)='email changed. request a new link with the current email.'
    order by r.student_id
  loop
    update public.guardian_link_requests set parent_email=v_request.current_email,
      status='pending',responded_at=null,review_note=null where id=v_request.id;
    update public.student_profiles set guardian_email=v_request.current_email
      where user_id=v_request.student_id and guardian_email=v_request.parent_email;
  end loop;
end; $$;

do $$
declare v_parent record;
begin
  for v_parent in select u.id,u.email from auth.users u join public.profiles p on p.id=u.id
    where p.role='parent' and u.email_confirmed_at is not null
  loop
    perform private.link_parent_by_verified_email(v_parent.id,v_parent.email);
  end loop;
end; $$;
