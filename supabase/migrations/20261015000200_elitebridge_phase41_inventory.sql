-- Phase 4.1: redacted, owner-scoped inventory for authenticated backend callers.
-- Requires Phase 4 registry migration. Unapplied until reviewed and staged.
begin;
create or replace function public.elitetrade_bridge_inventory(
 p_actor_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_is_admin boolean;
  v_items jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'trusted backend required' using errcode='42501';
  end if;
  select role='admin' into v_is_admin
    from public.elitetrade_profiles
    where id=p_actor_id and disabled=false;
  if not found then
    raise exception 'account unavailable' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc),'[]'::jsonb)
    into v_items from (
      select d.id as device_id,d.owner_id,d.account_id,d.display_name,
        d.fingerprint,d.state,d.last_sequence,d.created_at,d.approved_at,
        d.revoked_at
      from elitetrade_private.bridge_devices d
      where v_is_admin or d.owner_id=p_actor_id
      order by d.created_at desc
      limit 100
    ) r;
  return v_items;
end;$$;
revoke all on function public.elitetrade_bridge_inventory(uuid) from public,anon,authenticated;
grant execute on function public.elitetrade_bridge_inventory(uuid) to service_role;
commit;
