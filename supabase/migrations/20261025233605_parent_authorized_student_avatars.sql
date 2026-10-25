-- A linked child's picture is available only to the verified parent who has
-- approved that child. Auth identities themselves remain server-only.
create function private.parent_can_view_student_avatar(p_student_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.guardian_links g
    join public.guardian_link_requests r on r.student_id=g.student_id and r.parent_id=g.parent_id
      and r.status='approved' and r.parent_email=g.verified_guardian_email
    join public.profiles parent on parent.id=g.parent_id and parent.role='parent'
    join public.profiles student on student.id=g.student_id and student.role='student'
    join auth.users u on u.id=g.parent_id and u.email_confirmed_at is not null
      and lower(u.email)=g.verified_guardian_email
    where g.parent_id=(select auth.uid()) and g.student_id=p_student_id
  )
$$;
revoke all on function private.parent_can_view_student_avatar(uuid) from public,anon,authenticated;
grant execute on function private.parent_can_view_student_avatar(uuid) to authenticated;

create policy profile_avatars_approved_parent_select on storage.objects for select to authenticated
  using(bucket_id='profile-avatars' and exists(
    select 1 from public.profiles p where p.avatar_path=name
      and private.parent_can_view_student_avatar(p.id)
  ));

create function private.parent_student_avatar_impl(p_student_id uuid)
returns table(student_id uuid,avatar_path text,provider_avatar_url text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.parent_can_view_student_avatar(p_student_id) then
    raise exception 'Only a verified, approved linked parent can view this student picture' using errcode='42501';
  end if;
  return query
    select p.id,p.avatar_path,coalesce(provider.url,'')
    from public.profiles p join auth.users u on u.id=p.id
    left join lateral (
      select candidate.url from auth.identities i
      cross join lateral unnest(array[
        i.identity_data->>'avatar_url',i.identity_data->>'picture',i.identity_data#>>'{picture,data,url}',
        u.raw_user_meta_data->>'avatar_url',u.raw_user_meta_data->>'picture',u.raw_user_meta_data#>>'{picture,data,url}'
      ]) with ordinality candidate(url,priority)
      where i.user_id=p.id and i.provider in('google','facebook')
        and candidate.url~*'^https://[^[:space:]]+$' and char_length(candidate.url)<=4096
      order by case i.provider when 'google' then 0 else 1 end,i.id,candidate.priority limit 1
    ) provider on true
    where p.id=p_student_id;
end; $$;
create function public.parent_student_avatar(p_student_id uuid)
returns table(student_id uuid,avatar_path text,provider_avatar_url text)
language sql stable security invoker set search_path='' as $$
  select * from private.parent_student_avatar_impl(p_student_id)
$$;
revoke all on function private.parent_student_avatar_impl(uuid),public.parent_student_avatar(uuid) from public,anon,authenticated;
grant execute on function private.parent_student_avatar_impl(uuid),public.parent_student_avatar(uuid) to authenticated;
