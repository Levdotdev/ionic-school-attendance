-- No non-Android releases/uploads existed when this migration was prepared.
-- Refuse unexpected data rather than deleting a package or changing its type.
do $$
begin
  if exists(select 1 from public.app_releases where platform<>'android' or delivery<>'android_apk' or external_url is not null)
    or exists(select 1 from private.app_release_uploads where platform<>'android') then
    raise exception 'Non-Android app records require review before removing platform support' using errcode='22023';
  end if;
end; $$;

-- Remove the former store-link publication API entirely. Binary publication
-- now accepts only the verified upload reservation selected by the server.
drop function public.publish_app_release(uuid,uuid,text,text,text,text);
drop function private.publish_app_release_impl(uuid,uuid,text,text,text,text);

alter table public.app_releases
  drop constraint app_releases_check,
  drop constraint app_releases_check1,
  drop constraint app_releases_platform_check,
  drop constraint app_releases_delivery_check,
  drop column external_url,
  alter column file_name set not null,
  alter column file_size set not null,
  alter column sha256 set not null,
  add constraint app_releases_platform_check check(platform='android'),
  add constraint app_releases_delivery_check check(delivery='android_apk');
alter table private.app_release_uploads
  drop constraint app_release_uploads_platform_check,
  drop constraint app_release_uploads_content_type_check,
  add constraint app_release_uploads_platform_check check(platform='android'),
  add constraint app_release_uploads_content_type_check check(content_type='application/vnd.android.package-archive');

create or replace function private.reserve_app_release_upload_impl(p_actor uuid,p_platform text,p_version text,p_minimum_os text,p_notes text,p_file_name text,p_file_size bigint,p_content_type text,p_sha256 text)
returns setof private.app_release_uploads language plpgsql security definer set search_path='' as $$
declare v_id uuid:=gen_random_uuid();
begin
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.role='admin'
    and p.onboarding_completed_at is not null and u.email_confirmed_at is not null) then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  if p_platform is distinct from 'android' or btrim(p_version)='' or char_length(p_version)>40
    or char_length(p_minimum_os)>80 or char_length(p_notes)>2000 or p_file_size not between 1 and 209715200
    or p_sha256!~'^[a-f0-9]{64}$' or p_file_name!~'^[A-Za-z0-9][A-Za-z0-9._ -]{0,110}\.apk$'
    or p_content_type is distinct from 'application/vnd.android.package-archive' then
    raise exception 'Choose a valid Android APK package' using errcode='22023'; end if;
  if(select count(*) from private.app_release_uploads where uploaded_by=p_actor and created_at>now()-interval '1 hour')>=10 then
    raise exception 'Please wait before starting more app uploads' using errcode='42901'; end if;
  return query insert into private.app_release_uploads(id,uploaded_by,platform,version,minimum_os,notes,file_name,file_size,content_type,sha256,staging_key,object_key)
    values(v_id,p_actor,'android',btrim(p_version),btrim(p_minimum_os),p_notes,p_file_name,p_file_size,p_content_type,p_sha256,
      'staging/'||v_id::text||'/app.apk','releases/'||v_id::text||'/app.apk') returning *;
end; $$;

create function private.publish_app_release_impl(p_actor uuid,p_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_upload private.app_release_uploads%rowtype;
begin
  if not exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=p_actor and p.role='admin'
    and p.onboarding_completed_at is not null and u.email_confirmed_at is not null) then
    raise exception 'Administrator access required' using errcode='42501'; end if;
  select * into v_upload from private.app_release_uploads where id=p_id and uploaded_by=p_actor and platform='android'
    and expires_at>now() and cancelled_at is null and published_at is null for update;
  if not found then raise exception 'This upload expired or was already published' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app-release:android',0));
  update public.app_releases set is_active=false where platform='android' and is_active;
  insert into public.app_releases(id,platform,version,minimum_os,notes,delivery,file_name,file_size,sha256)
    values(p_id,'android',v_upload.version,v_upload.minimum_os,v_upload.notes,'android_apk',v_upload.file_name,v_upload.file_size,v_upload.sha256);
  update private.app_release_uploads set published_at=now() where id=p_id;
  return p_id;
end; $$;
create function public.publish_app_release(p_actor uuid,p_id uuid)
returns uuid language sql security invoker set search_path='' as $$ select private.publish_app_release_impl(p_actor,p_id) $$;

create or replace function private.app_release_object_impl(p_actor uuid,p_id uuid)
returns table(object_key text,file_name text) language sql stable security definer set search_path='' as $$
  select u.object_key,r.file_name from public.app_releases r join private.app_release_uploads u on u.id=r.id
  join public.profiles p on p.id=p_actor and p.onboarding_completed_at is not null
  join auth.users a on a.id=p.id and a.email_confirmed_at is not null
  where r.id=p_id and(r.is_active or p.role='admin') and r.platform='android' and r.delivery='android_apk'
$$;
revoke all on function private.publish_app_release_impl(uuid,uuid),public.publish_app_release(uuid,uuid) from public,anon,authenticated;
grant execute on function private.publish_app_release_impl(uuid,uuid),public.publish_app_release(uuid,uuid) to service_role;
