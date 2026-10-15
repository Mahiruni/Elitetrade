-- Phase 5: opt-in, REAL-account observation-only envelopes.
-- Extends existing approved terminal identities, but never approves orders.
begin;
alter table public.elitetrade_bridge_terminals
  add column if not exists account_mode text not null default 'demo'
  check (account_mode in ('demo','real'));

-- Keep previous service-role-only RPC, atomic sequence and message uniqueness.
-- Strengthen claim to ensure the terminal's mode is bound in the same row lock.
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
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or p_payload->>'accountType' not in ('demo','real') then
    return false;
  end if;
  update public.elitetrade_bridge_terminals
     set last_sequence=p_sequence, last_seen_at=clock_timestamp()
   where id=p_terminal_id and account_id=p_account_id
     and status='approved' and account_mode=p_payload->>'accountType'
     and last_sequence<p_sequence
   returning id into v_terminal;

  if v_terminal is null then return false; end if;
  insert into public.elitetrade_bridge_packets
    (terminal_id,message_id,sequence,kind,payload)
  values (v_terminal,p_message_id,p_sequence,p_kind,p_payload)
  on conflict do nothing returning id into v_packet_id;

  if v_packet_id is null then
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
