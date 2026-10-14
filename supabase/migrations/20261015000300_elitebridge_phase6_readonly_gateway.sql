-- EliteBridge Phase 6: independent MetaAPI-like *read-only* terminal telemetry.
-- Self-reported DEMO state is NEVER broker verification. NO broker orders.
-- Requires Phase 4 private registry + Phase 4.1 inventory.
-- Opt-in backend deployment only, not for production without staging approval.
begin;

create table if not exists elitetrade_private.bridge_terminal_snapshots (
  device_id uuid primary key references elitetrade_private.bridge_devices(id) on delete cascade,
  owner_id uuid not null,
  account_id uuid not null,
  last_sequence bigint not null check(last_sequence > 0),
  last_received_at timestamptz not null,
  heartbeat_received_at timestamptz,
  terminal_connected boolean,
  terminal_trade_allowed boolean,
  quote_symbol text check (quote_symbol is null or quote_symbol ~ '^[A-Za-z0-9._-]{3,30}$'),
  quote_bid numeric(22,8) check(quote_bid is null or quote_bid > 0),
  quote_ask numeric(22,8) check(quote_ask is null or quote_ask >= quote_bid),
  quote_observed_at timestamptz,
  check ((quote_symbol is null and quote_bid is null and quote_ask is null
            and quote_observed_at is null)
      or (quote_symbol is not null and quote_bid is not null
            and quote_ask is not null and quote_observed_at is not null))
);
create index if not exists bridge_snapshots_owner_idx
  on elitetrade_private.bridge_terminal_snapshots(owner_id,account_id);
alter table elitetrade_private.bridge_terminal_snapshots enable row level security;
revoke all on elitetrade_private.bridge_terminal_snapshots from public,anon,authenticated;
grant select,insert,update on elitetrade_private.bridge_terminal_snapshots to service_role;

-- The API verifies signed bytes against the enrolled public key BEFORE this
-- transaction. This atomic claim/snapshot RPC refuses unapproved/revoked
-- devices, old sequences, duplicate message IDs and malformed DEMO payloads.
create or replace function public.elitetrade_bridge_record_packet(
  p_owner_id uuid,p_account_id uuid,p_device_id uuid,p_sequence bigint,
  p_message_id text,p_kind text,p_payload jsonb
) returns boolean language plpgsql security invoker set search_path='' as $$
declare
  v_last bigint;
  v_added text;
  v_now timestamptz := clock_timestamp();
  v_quote_ms numeric;
  v_quote_at timestamptz;
  v_bid numeric;
  v_ask numeric;
begin
  if current_user <> 'service_role' then
    raise exception 'trusted backend required' using errcode='42501';
  end if;
  if p_sequence is null or p_sequence < 1
     or p_message_id is null or p_message_id !~ '^[a-f0-9]{32}$'
     or p_kind is null or p_kind not in ('terminal.heartbeat','terminal.quote')
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'accountType' is distinct from 'demo'
     then return false;
  end if;
  if p_kind='terminal.heartbeat' then
    if (select count(*) from jsonb_object_keys(p_payload)) <> 3
      or jsonb_typeof(p_payload->'connected') is distinct from 'boolean'
      or jsonb_typeof(p_payload->'tradeAllowed') is distinct from 'boolean'
      then return false;
    end if;
  else
    if (select count(*) from jsonb_object_keys(p_payload)) <> 5
      or coalesce(p_payload->>'symbol','') !~ '^[A-Za-z0-9._-]{3,30}$'
      or jsonb_typeof(p_payload->'bid') is distinct from 'number'
      or jsonb_typeof(p_payload->'ask') is distinct from 'number'
      or jsonb_typeof(p_payload->'observedAt') is distinct from 'number'
      or coalesce(p_payload->>'observedAt','') !~ '^[0-9]{13}$'
      then return false;
    end if;
    v_bid := (p_payload->>'bid')::numeric;
    v_ask := (p_payload->>'ask')::numeric;
    v_quote_ms := (p_payload->>'observedAt')::numeric;
    if v_bid <= 0 or v_bid > 100000000 or v_ask < v_bid
       or v_ask > 100000000 then return false;
    end if;
    v_quote_at := to_timestamp(v_quote_ms/1000);
    if v_quote_at < v_now - interval '180 seconds'
       or v_quote_at > v_now + interval '30 seconds' then return false;
    end if;
  end if;

  select d.last_sequence into v_last
    from elitetrade_private.bridge_devices d
    where d.id=p_device_id and d.owner_id=p_owner_id
      and d.account_id=p_account_id
      and d.state='approved' and d.role='terminal'
      and exists(select 1 from public.elitetrade_profiles p
        where p.id=d.owner_id and not p.disabled)
    for update;
  if not found or p_sequence <= v_last then return false;end if;

  insert into elitetrade_private.bridge_accepted_messages
    (message_id,device_id,owner_id,account_id,sequence,kind)
  values (p_message_id,p_device_id,p_owner_id,p_account_id,p_sequence,p_kind)
  on conflict do nothing returning message_id into v_added;
  if v_added is null then return false;end if;

  update elitetrade_private.bridge_devices
    set last_sequence=p_sequence,updated_at=v_now
    where id=p_device_id;

  insert into elitetrade_private.bridge_terminal_snapshots as snap (
    device_id,owner_id,account_id,last_sequence,last_received_at,
    heartbeat_received_at,terminal_connected,terminal_trade_allowed,
    quote_symbol,quote_bid,quote_ask,quote_observed_at
  ) values (
    p_device_id,p_owner_id,p_account_id,p_sequence,v_now,
    case when p_kind='terminal.heartbeat' then v_now else null end,
    case when p_kind='terminal.heartbeat' then (p_payload->>'connected')::boolean else null end,
    case when p_kind='terminal.heartbeat' then (p_payload->>'tradeAllowed')::boolean else null end,
    case when p_kind='terminal.quote' then p_payload->>'symbol' else null end,
    v_bid,v_ask,v_quote_at
  )
  on conflict (device_id) do update set
    last_sequence=excluded.last_sequence,
    last_received_at=excluded.last_received_at,
    heartbeat_received_at=case when p_kind='terminal.heartbeat'
      then excluded.heartbeat_received_at else snap.heartbeat_received_at end,
    terminal_connected=case when p_kind='terminal.heartbeat'
      then excluded.terminal_connected else snap.terminal_connected end,
    terminal_trade_allowed=case when p_kind='terminal.heartbeat'
      then excluded.terminal_trade_allowed else snap.terminal_trade_allowed end,
    quote_symbol=case when p_kind='terminal.quote'
      then excluded.quote_symbol else snap.quote_symbol end,
    quote_bid=case when p_kind='terminal.quote'
      then excluded.quote_bid else snap.quote_bid end,
    quote_ask=case when p_kind='terminal.quote'
      then excluded.quote_ask else snap.quote_ask end,
    quote_observed_at=case when p_kind='terminal.quote'
      then excluded.quote_observed_at else snap.quote_observed_at end;
  return true;
end;$$;

-- Scoped and redacted; cannot return any secret, enrolled key, or broker proof.
create or replace function public.elitetrade_bridge_snapshot(
  p_owner_id uuid,p_account_id uuid,p_device_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_result jsonb;
begin
  if current_user <> 'service_role' then
    raise exception 'trusted backend required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'deviceId',d.id,'accountId',d.account_id,
    'lastSequence',d.last_sequence,
    'lastReceivedAt',s.last_received_at,
    'heartbeatAt',s.heartbeat_received_at,
    'terminalConnectedClaim',coalesce(s.terminal_connected,false),
    'terminalTradeAllowedClaim',coalesce(s.terminal_trade_allowed,false),
    'quote',case when s.quote_symbol is null then null else jsonb_build_object(
      'symbol',s.quote_symbol,'bid',s.quote_bid,'ask',s.quote_ask,
      'observedAt',floor(extract(epoch from s.quote_observed_at)*1000)::bigint
    ) end
  ) into v_result
    from elitetrade_private.bridge_devices d
    left join elitetrade_private.bridge_terminal_snapshots s on s.device_id=d.id
    where d.id=p_device_id and d.owner_id=p_owner_id and d.account_id=p_account_id
      and d.state='approved' and d.role='terminal'
      and exists(select 1 from public.elitetrade_profiles p
        where p.id=d.owner_id and not p.disabled);
  return v_result;
end;$$;

revoke all on function
  public.elitetrade_bridge_record_packet(uuid,uuid,uuid,bigint,text,text,jsonb),
  public.elitetrade_bridge_snapshot(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function
  public.elitetrade_bridge_record_packet(uuid,uuid,uuid,bigint,text,text,jsonb),
  public.elitetrade_bridge_snapshot(uuid,uuid,uuid)
  to service_role;
commit;
