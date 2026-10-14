-- Preserve the verified linked-host MetaApi account format while retaining all
-- original owner, MFA, DEMO worker health, order reconciliation and lease checks.
-- Already applied in the existing EliteTrade Supabase project as migration
-- accept_verified_metaapi_existing_account_bindings.
CREATE OR REPLACE FUNCTION elitetrade_private.engine_control(p_bot_id uuid, p_running boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  b public.elitetrade_bots;
  a public.elitetrade_accounts;
begin
  if auth.uid() is null then raise exception 'sign in required'; end if;
  if exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified')
    and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
    raise exception 'complete two-factor authentication';
  end if;
  select * into b from public.elitetrade_bots where id=p_bot_id and user_id=auth.uid() for update;
  if not found then raise exception 'bot not found'; end if;
  if b.account_id is null then raise exception 'select an MT5 account first'; end if;
  perform pg_advisory_xact_lock(hashtextextended(b.account_id::text,0));
  if exists(select 1 from public.elitetrade_engine_leases where account_id=b.account_id and expires_at>now()) then
    raise exception 'connection command in progress; retry shortly';
  end if;
  if not p_running and exists(select 1 from public.elitetrade_engine_orders where account_id=b.account_id and status='reserved') then
    raise exception 'unconfirmed order in progress; reconcile before stopping';
  end if;
  if p_running then
    if not exists(select 1 from public.elitetrade_engine_heartbeat where updated_at>now()-interval '90 seconds') then
      raise exception 'demo worker unavailable';
    end if;
    if not exists(select 1 from public.elitetrade_profiles where id=auth.uid() and not disabled and (active or role='admin')) then
      raise exception 'activate subscription first';
    end if;
    select * into a from public.elitetrade_accounts where id=b.account_id and user_id=auth.uid();
    if a.status<>'connected' or a.gateway_id is null or not (
      a.gateway_id like 'metaapi:%' or
      a.gateway_id ~* '^metaapi-existing:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ) then
      raise exception 'confirm the MT5 connection first';
    end if;
    if exists(select 1 from public.elitetrade_engine_orders where account_id=b.account_id and status in ('reserved','unknown')) then
      raise exception 'unconfirmed order requires provider reconciliation';
    end if;
    if exists(select 1 from public.elitetrade_engine_runs where account_id=b.account_id and enabled and bot_id<>p_bot_id) then
      raise exception 'another bot already monitors this account';
    end if;
    if exists(select 1 from public.elitetrade_engine_runs where bot_id=p_bot_id and enabled) then return; end if;
  end if;
  insert into public.elitetrade_engine_runs(bot_id,user_id,account_id,enabled,config,message)
  values(b.id,b.user_id,b.account_id,p_running,to_jsonb(b),
    case when p_running then 'Armed for demo monitoring; waiting for worker evaluation' else 'Stopped; broker positions remain open' end)
  on conflict(bot_id) do update set
    enabled=excluded.enabled,config=excluded.config,updated_at=now(),message=excluded.message;
  update public.elitetrade_bots set status=case when p_running then 'running' else 'stopped' end where id=p_bot_id;
end;
$function$

