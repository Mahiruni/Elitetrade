-- EliteBridge Phase 8: read-only server-RECEIPT diagnostics.
-- Do not report this as broker verification or grant trading authority.
begin;

-- Each terminal can generate frequent quotes. Look up the last heartbeat
-- independently so bursts of quotes cannot mask a stopped heartbeat.
create index if not exists elitetrade_bridge_packets_terminal_kind_received_idx
  on public.elitetrade_bridge_packets (terminal_id,kind,received_at desc,id desc);

create or replace function public.elitetrade_bridge_health(
  p_owner_id uuid
) returns table(
  id uuid,
  label text,
  account_mode text,
  status text,
  proof_verified_at timestamptz,
  last_heartbeat_at timestamptz,
  heartbeat_connected_claim text,
  last_quote_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select t.id,t.label,t.account_mode,t.status,t.proof_verified_at,
    heartbeat.received_at,
    heartbeat.payload->>'connected',
    quote.received_at
  from (
    select a.id,a.label,a.account_mode,a.status,a.proof_verified_at,a.created_at
    from public.elitetrade_bridge_terminals a
    where a.owner_id=p_owner_id
    order by a.created_at desc,a.id
    limit 30
  ) t
  left join lateral (
    select p.received_at,p.payload
    from public.elitetrade_bridge_packets p
    where p.terminal_id=t.id and p.kind='terminal.heartbeat'
    order by p.received_at desc,p.id desc
    limit 1
  ) heartbeat on true
  left join lateral (
    select p.received_at
    from public.elitetrade_bridge_packets p
    where p.terminal_id=t.id and p.kind='terminal.quote'
    order by p.received_at desc,p.id desc
    limit 1
  ) quote on true
  order by t.created_at desc,t.id;
$$;

-- Private registry is accessed via the trusted server only, never Android,
-- the browser client, or a terminal-held Supabase service-role secret.
revoke all on function public.elitetrade_bridge_health(uuid)
  from public, anon, authenticated;
grant execute on function public.elitetrade_bridge_health(uuid) to service_role;
commit;
