alter table private.activity_alert_deliveries add column last_failure_code text
  check(last_failure_code in('auth_failed','timeout','connect_failed','recipient_rejected','runtime_unavailable',
    'configuration_missing','completion_unavailable','authorization_unavailable','delivery_failed'));
alter table private.activity_alert_deliveries add column last_failure_at timestamptz;
create function private.record_activity_alert_failure_impl(p_id uuid,p_lease_token uuid,p_code text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if p_code not in('auth_failed','timeout','connect_failed','recipient_rejected','runtime_unavailable',
    'configuration_missing','completion_unavailable','authorization_unavailable','delivery_failed') or p_code is null then
    raise exception 'Unsupported delivery diagnostic' using errcode='22023';
  end if;
  update private.activity_alert_deliveries set last_failure_code=p_code,last_failure_at=now()
    where id=p_id and lease_token=p_lease_token and lease_expires_at>now()
      and completed_at is null and cancelled_at is null;
  return found;
end; $$;
create function public.record_activity_alert_failure(p_id uuid,p_lease_token uuid,p_code text)
returns boolean language sql security invoker set search_path='' as $$
  select private.record_activity_alert_failure_impl(p_id,p_lease_token,p_code)
$$;
revoke all on function private.record_activity_alert_failure_impl(uuid,uuid,text),public.record_activity_alert_failure(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function private.record_activity_alert_failure_impl(uuid,uuid,text),public.record_activity_alert_failure(uuid,uuid,text)
  to service_role;
