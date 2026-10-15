-- EliteBridge Phase 4. Independent READ-ONLY DEMO telemetry transport.
-- No gateway switching, broker credential storage, broker orders, or bot arming.
-- Never expose this registry or replay history to anon/authenticated Data API.
begin;

create table if not exists public.elitetrade_bridge_terminals (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.elitetrade_accounts(id) on delete cascade,
  label text not null check (char_length(label) between 3 and 64),
  public_key text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','revoked')),
  last_sequence bigint not null default 0 check (last_sequence>=0),
  last_seen_at timestamptz,
  approved_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists elitetrade_bridge_terminals_owner_idx
  on public.elitetrade_bridge_terminals(owner_id,account_id,status);
alter table public.elitetrade_bridge_terminals enable row level security;
revoke all on table public.elitetrade_bridge_terminals from public, anon, authenticated;
grant select, insert, update, delete on table public.elitetrade_bridge_terminals to service_role;

create table if not exists public.elitetrade_bridge_packets (
  id bigint generated always as identity primary key,
  terminal_id uuid not null references public.elitetrade_bridge_terminals(id) on delete cascade,
  message_id text not null check (message_id ~ '^[0-9a-f]{32}$'),
  sequence bigint not null check (sequence>0),
  kind text not null check (kind in ('terminal.heartbeat','terminal.quote')),
  payload jsonb not null,
  received_at timestamptz not null default now(),
  unique (terminal_id,message_id),
  unique (terminal_id,sequence)
);
create index if not exists elitetrade_bridge_packets_received_idx
  on public.elitetrade_bridge_packets(received_at);
alter table public.elitetrade_bridge_packets enable row level security;
revoke all on table public.elitetrade_bridge_packets from public, anon, authenticated;
grant select, insert on table public.elitetrade_bridge_packets to service_role;
grant usage, select on sequence public.elitetrade_bridge_packets_id_seq to service_role;

-- The compare-and-swap and packet insert execute in ONE PostgreSQL transaction.
-- An approval revocation and a signed packet race on the same locked terminal
-- row; after revocation wins, no further claims can succeed. The sequence
-- lives on the terminal record permanently even if old audit rows are pruned.
create or replace function public.elitetrade_bridge_claim(
  p_terminal_id uuid,
  p_account_id uuid,
  p_sequence bigint,
  p_message_id text,
  p_kind text,
  p_payload jsonb
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_terminal uuid;
  v_packet_id bigint;
begin
  if p_sequence is null or p_sequence<1
     or p_message_id is null or p_message_id !~ '^[0-9a-f]{32}$'
     or p_kind not in ('terminal.heartbeat','terminal.quote')
     or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;

  update public.elitetrade_bridge_terminals
     set last_sequence=p_sequence, last_seen_at=clock_timestamp()
   where id=p_terminal_id and account_id=p_account_id
     and status='approved' and last_sequence<p_sequence
   returning id into v_terminal;

  if v_terminal is null then
    return false;
  end if;

  insert into public.elitetrade_bridge_packets
    (terminal_id,message_id,sequence,kind,payload)
  values (v_terminal,p_message_id,p_sequence,p_kind,p_payload)
  on conflict do nothing returning id into v_packet_id;

  if v_packet_id is null then
    -- Abort the enclosing transaction; do NOT advance the sequence on a
    -- duplicated message ID, even when it was supplied with a newer counter.
    raise exception 'EliteBridge duplicate message ID';
  end if;
  return true;
end;
$$;

revoke all on function public.elitetrade_bridge_claim(uuid,uuid,bigint,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.elitetrade_bridge_claim(uuid,uuid,bigint,text,text,jsonb)
  to service_role;
commit;
