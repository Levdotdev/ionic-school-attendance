-- Expose only whether a password exists, never the password hash. The protected
-- Auth metadata flag lets every device render the same authoritative methods.
create function private.stamp_email_password_capability()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.raw_app_meta_data:=jsonb_set(coalesce(new.raw_app_meta_data,'{}'::jsonb),
    '{has_email_password}',to_jsonb(coalesce(new.encrypted_password,'')<>''),true);
  return new;
end; $$;
revoke all on function private.stamp_email_password_capability() from public,anon,authenticated;
create trigger auth_users_stamp_email_password_capability before insert or update on auth.users
  for each row execute function private.stamp_email_password_capability();
update auth.users set raw_app_meta_data=jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),
  '{has_email_password}',to_jsonb(coalesce(encrypted_password,'')<>''),true);

create function private.notify_password_capability_changed()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.encrypted_password is distinct from new.encrypted_password then
    perform private.notify_portal_user(new.id);
  end if;
  return new;
end; $$;
revoke all on function private.notify_password_capability_changed() from public,anon,authenticated;
create trigger auth_users_password_capability_changed after update of encrypted_password on auth.users
  for each row execute function private.notify_password_capability_changed();

create function private.my_account_security_impl()
returns table(has_password boolean) language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in before opening Security' using errcode='42501'; end if;
  return query select coalesce(u.encrypted_password,'')<>'' from auth.users u where u.id=(select auth.uid());
end; $$;
create function public.my_account_security()
returns table(has_password boolean) language sql security invoker set search_path='' as $$
  select * from private.my_account_security_impl()
$$;
revoke all on function private.my_account_security_impl(),public.my_account_security() from public,anon,authenticated;
grant execute on function private.my_account_security_impl(),public.my_account_security() to authenticated;
