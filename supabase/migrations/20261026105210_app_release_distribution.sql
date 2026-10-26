-- Published app metadata is separate from private upload reservations/object
-- keys. Binary access is granted only by the authenticated download endpoint.
create table public.app_releases (
  id uuid primary key,
  platform text not null check(platform in('android','ios')),
  version text not null check(char_length(version) between 1 and 40),
  minimum_os text not null default '' check(char_length(minimum_os)<=80),
  notes text not null default '' check(char_length(notes)<=2000),
  delivery text not null check(delivery in('android_apk','ios_archive','ios_store')),
  external_url text check(external_url is null or char_length(external_url)<=2048),
  file_name text check(file_name is null or char_length(file_name)<=120),
  file_size bigint check(file_size is null or file_size between 1 and 209715200),
  sha256 text check(sha256 is null or sha256~'^[a-f0-9]{64}$'),
  published_at timestamptz not null default now(),
  is_active boolean not null default true,
  check((platform='android' and delivery='android_apk' and external_url is null)
    or(platform='ios' and delivery='ios_archive' and external_url is null)
    or(platform='ios' and delivery='ios_store' and external_url is not null)),
  check((delivery='ios_store' and file_name is null and file_size is null and sha256 is null)
    or(delivery<>'ios_store' and file_name is not null and file_size is not null and sha256 is not null))
);
create unique index app_releases_active_platform_idx on public.app_releases(platform) where is_active;
alter table public.app_releases enable row level security;
create policy app_releases_completed_accounts on public.app_releases for select to authenticated
  using((is_active or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin' and p.onboarding_completed_at is not null))
    and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.onboarding_completed_at is not null
      and p.role in('admin','teacher','student','parent')));
revoke all on public.app_releases from public,anon,authenticated;
grant select on public.app_releases to authenticated;
grant all on public.app_releases to service_role;
create function private.app_release_changed()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_user uuid;
begin
  for v_user in select id from public.profiles where onboarding_completed_at is not null loop
    perform private.notify_portal_user(v_user);
  end loop;
  return new;
end; $$;
revoke all on function private.app_release_changed() from public,anon,authenticated;
create trigger app_release_changed after insert or update of is_active on public.app_releases
  for each row execute function private.app_release_changed();

create table private.app_release_uploads (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.profiles(id) on delete set null,
  platform text not null check(platform in('android','ios')),
  version text not null check(char_length(version) between 1 and 40),
  minimum_os text not null default '' check(char_length(minimum_os)<=80),
  notes text not null default '' check(char_length(notes)<=2000),
  file_name text not null check(char_length(file_name)<=120),
  file_size bigint not null check(file_size between 1 and 209715200),
  content_type text not null check(content_type in('application/vnd.android.package-archive','application/octet-stream')),
  sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
  staging_key text not null unique,
  object_key text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '30 minutes',
  published_at timestamptz,
  cancelled_at timestamptz
);
create index app_release_uploads_actor_idx on private.app_release_uploads(uploaded_by,created_at desc);
alter table private.app_release_uploads enable row level security;
create policy app_release_uploads_deny_clients on private.app_release_uploads for all to public using(false) with check(false);
revoke all on private.app_release_uploads from public,anon,authenticated;
grant all on private.app_release_uploads to service_role;

create function private.reserve_app_release_upload_impl(p_actor uuid,p_platform text,p_version text,p_minimum_os text,p_notes text,p_file_name text,p_file_size bigint,p_content_type text,p_sha256 text)
returns setof private.app_release_uploads language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid(); v_suffix text;
begin
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.role='admin'
    and p.onboarding_completed_at is not null and u.email_confirmed_at is not null) then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_platform not in('android','ios') or btrim(p_version)='' or char_length(p_version)>40
    or char_length(p_minimum_os)>80 or char_length(p_notes)>2000 or p_file_size not between 1 and 209715200
    or p_sha256!~'^[a-f0-9]{64}$' or p_file_name!~'^[A-Za-z0-9][A-Za-z0-9._ -]{0,110}\.(apk|ipa)$' then
    raise exception 'Invalid app upload' using errcode='22023'; end if;
  v_suffix:=case when p_platform='android' then '.apk' else '.ipa' end;
  if right(lower(p_file_name),4)<>v_suffix or p_content_type<>(case when p_platform='android' then 'application/vnd.android.package-archive' else 'application/octet-stream' end) then
    raise exception 'Choose the correct app package for this platform' using errcode='22023'; end if;
  if(select count(*) from private.app_release_uploads where uploaded_by=p_actor and created_at>now()-interval '1 hour')>=10 then
    raise exception 'Please wait before starting more app uploads' using errcode='42901'; end if;
  return query insert into private.app_release_uploads(id,uploaded_by,platform,version,minimum_os,notes,file_name,file_size,content_type,sha256,staging_key,object_key)
    values(v_id,p_actor,p_platform,btrim(p_version),btrim(p_minimum_os),p_notes,p_file_name,p_file_size,p_content_type,p_sha256,
      'staging/'||v_id::text||'/app'||v_suffix,'releases/'||v_id::text||'/app'||v_suffix) returning *;
end; $$;
create function public.reserve_app_release_upload(p_actor uuid,p_platform text,p_version text,p_minimum_os text,p_notes text,p_file_name text,p_file_size bigint,p_content_type text,p_sha256 text)
returns setof private.app_release_uploads language sql security invoker set search_path='' as $$
  select * from private.reserve_app_release_upload_impl(p_actor,p_platform,p_version,p_minimum_os,p_notes,p_file_name,p_file_size,p_content_type,p_sha256)
$$;

create function private.app_release_upload_for_publish_impl(p_actor uuid,p_id uuid)
returns setof private.app_release_uploads language sql stable security definer set search_path='' as $$
  select r.* from private.app_release_uploads r join public.profiles p on p.id=p_actor and p.role='admin' and p.onboarding_completed_at is not null
  join auth.users u on u.id=p.id and u.email_confirmed_at is not null
  where r.id=p_id and r.uploaded_by=p_actor and r.expires_at>now() and r.cancelled_at is null and r.published_at is null
$$;
create function public.app_release_upload_for_publish(p_actor uuid,p_id uuid)
returns setof private.app_release_uploads language sql stable security invoker set search_path='' as $$ select * from private.app_release_upload_for_publish_impl(p_actor,p_id) $$;

create function private.publish_app_release_impl(p_actor uuid,p_id uuid,p_external_url text,p_version text,p_minimum_os text,p_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_upload private.app_release_uploads%rowtype; v_id uuid:=p_id; v_platform text;
begin
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.role='admin'
    and p.onboarding_completed_at is not null and u.email_confirmed_at is not null) then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_external_url is not null then
    if p_external_url!~'^https://(apps\.apple\.com/[^[:space:]]+|testflight\.apple\.com/join/[A-Za-z0-9]+)$'
      or char_length(p_external_url)>2048 or btrim(p_version)='' or char_length(p_version)>40 or char_length(p_minimum_os)>80 or char_length(p_notes)>2000 then
      raise exception 'Use an Apple App Store or TestFlight invitation link' using errcode='22023'; end if;
    v_platform:='ios'; v_id:=gen_random_uuid();
  else
    select * into v_upload from private.app_release_uploads where id=p_id and uploaded_by=p_actor
      and expires_at>now() and cancelled_at is null and published_at is null for update;
    if not found then raise exception 'This upload expired or was already published' using errcode='22023'; end if;
    v_platform:=v_upload.platform;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-release:'||v_platform,0));
  update public.app_releases set is_active=false where platform=v_platform and is_active;
  if p_external_url is not null then
    insert into public.app_releases(id,platform,version,minimum_os,notes,delivery,external_url)
      values(v_id,'ios',btrim(p_version),btrim(p_minimum_os),p_notes,'ios_store',p_external_url);
  else
    insert into public.app_releases(id,platform,version,minimum_os,notes,delivery,file_name,file_size,sha256)
      values(v_id,v_upload.platform,v_upload.version,v_upload.minimum_os,v_upload.notes,
        case when v_upload.platform='android' then 'android_apk' else 'ios_archive' end,v_upload.file_name,v_upload.file_size,v_upload.sha256);
    update private.app_release_uploads set published_at=now() where id=v_id;
  end if;
  return v_id;
end; $$;
create function public.publish_app_release(p_actor uuid,p_id uuid default null,p_external_url text default null,p_version text default '',p_minimum_os text default '',p_notes text default '')
returns uuid language sql security invoker set search_path='' as $$ select private.publish_app_release_impl(p_actor,p_id,p_external_url,p_version,p_minimum_os,p_notes) $$;

create function private.app_release_object_impl(p_actor uuid,p_id uuid)
returns table(object_key text,file_name text) language sql stable security definer set search_path='' as $$
  select u.object_key,r.file_name from public.app_releases r join private.app_release_uploads u on u.id=r.id
  join public.profiles p on p.id=p_actor and p.onboarding_completed_at is not null join auth.users a on a.id=p.id and a.email_confirmed_at is not null
  where r.id=p_id and(r.is_active or p.role='admin') and r.delivery<>'ios_store'
$$;
create function public.app_release_object(p_actor uuid,p_id uuid)
returns table(object_key text,file_name text) language sql stable security invoker set search_path='' as $$ select * from private.app_release_object_impl(p_actor,p_id) $$;

create function private.unpublish_app_release_impl(p_actor uuid,p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.role='admin'
    and p.onboarding_completed_at is not null and u.email_confirmed_at is not null) then raise exception 'Administrator access required' using errcode='42501'; end if;
  update public.app_releases set is_active=false where id=p_id;
end; $$;
create function public.unpublish_app_release(p_actor uuid,p_id uuid)
returns void language sql security invoker set search_path='' as $$ select private.unpublish_app_release_impl(p_actor,p_id) $$;

revoke all on function private.reserve_app_release_upload_impl(uuid,text,text,text,text,text,bigint,text,text),public.reserve_app_release_upload(uuid,text,text,text,text,text,bigint,text,text),
  private.app_release_upload_for_publish_impl(uuid,uuid),public.app_release_upload_for_publish(uuid,uuid),
  private.publish_app_release_impl(uuid,uuid,text,text,text,text),public.publish_app_release(uuid,uuid,text,text,text,text),
  private.app_release_object_impl(uuid,uuid),public.app_release_object(uuid,uuid),private.unpublish_app_release_impl(uuid,uuid),public.unpublish_app_release(uuid,uuid)
  from public,anon,authenticated;
grant execute on function private.reserve_app_release_upload_impl(uuid,text,text,text,text,text,bigint,text,text),public.reserve_app_release_upload(uuid,text,text,text,text,text,bigint,text,text),
  private.app_release_upload_for_publish_impl(uuid,uuid),public.app_release_upload_for_publish(uuid,uuid),
  private.publish_app_release_impl(uuid,uuid,text,text,text,text),public.publish_app_release(uuid,uuid,text,text,text,text),
  private.app_release_object_impl(uuid,uuid),public.app_release_object(uuid,uuid),private.unpublish_app_release_impl(uuid,uuid),public.unpublish_app_release(uuid,uuid)
  to service_role;
