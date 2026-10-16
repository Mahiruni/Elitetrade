begin;
-- Independent engine only. No legacy table, account binding or strategy is changed.
create table elitetrade_private.enginepro_accounts (
 account_id uuid primary key references public.elitetrade_accounts(id),
 user_id uuid not null references public.elitetrade_profiles(id),
 stopped boolean not null default true,
 epoch bigint not null default 0 check(epoch>=0),
 lease_owner uuid, lease_until timestamptz,
 -- No owner-facing or worker RPC grants commissioning/authorization.
 -- A later verified runtime milestone must supply the authorization workflow.
 broker_verified_until timestamptz, execution_authorized_until timestamptz,
 updated_at timestamptz not null default clock_timestamp(),
 check ((lease_owner is null)=(lease_until is null))
);
create index enginepro_accounts_owner on elitetrade_private.enginepro_accounts(user_id);
create table elitetrade_private.enginepro_intents (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references elitetrade_private.enginepro_accounts(account_id),
 user_id uuid not null references public.elitetrade_profiles(id),
 bot_id uuid not null references public.elitetrade_bots(id),
 strategy_version text not null check(strategy_version ~ '^[a-f0-9]{64}$'),
 signal_key text not null check(signal_key ~ '^[a-f0-9]{64}$'),
 command jsonb not null,
 state text not null default 'created' check(state in
  ('created','validating','ready','submitting','accepted','rejected','unknown','reconciled','cancelled')),
 broker_receipt jsonb,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(),
 unique(account_id,bot_id,signal_key)
);
create unique index enginepro_one_unresolved_per_account on elitetrade_private.enginepro_intents(account_id)
 where state in ('created','validating','ready','submitting','accepted','unknown');
create index enginepro_intents_owner on elitetrade_private.enginepro_intents(user_id);
create index enginepro_intents_bot on elitetrade_private.enginepro_intents(bot_id);
create index enginepro_intents_recent on elitetrade_private.enginepro_intents(account_id,created_at desc);
create table elitetrade_private.enginepro_events (
 id bigint generated always as identity primary key,
 account_id uuid not null references elitetrade_private.enginepro_accounts(account_id),
 intent_id uuid references elitetrade_private.enginepro_intents(id),
 code text not null check(code ~ '^[A-Z_]{3,60}$'),
 epoch bigint not null,
 created_at timestamptz not null default clock_timestamp()
);
create index enginepro_events_account on elitetrade_private.enginepro_events(account_id,created_at desc);
create index enginepro_events_intent on elitetrade_private.enginepro_events(intent_id);
alter table elitetrade_private.enginepro_accounts enable row level security;
alter table elitetrade_private.enginepro_intents enable row level security;
alter table elitetrade_private.enginepro_events enable row level security;
revoke all on elitetrade_private.enginepro_accounts,elitetrade_private.enginepro_intents,elitetrade_private.enginepro_events from public,anon,authenticated;
grant usage on schema elitetrade_private to service_role;
grant usage on schema elitetrade_private to authenticated;
grant select,insert,update on elitetrade_private.enginepro_accounts,elitetrade_private.enginepro_intents to service_role;
grant select,insert on elitetrade_private.enginepro_events to service_role;
grant usage,select on sequence elitetrade_private.enginepro_events_id_seq to service_role;
create policy enginepro_worker_accounts on elitetrade_private.enginepro_accounts to service_role using(true) with check(true);
create policy enginepro_worker_intents on elitetrade_private.enginepro_intents to service_role using(true) with check(true);
create policy enginepro_worker_events on elitetrade_private.enginepro_events to service_role using(true) with check(true);

-- Private privileged implementation: only authenticated account owners may call.
create function elitetrade_private.enginepro_account(p_account_id uuid,p_stop boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); a elitetrade_private.enginepro_accounts; recent jsonb; unresolved bigint;
begin
 if v_user is null then raise exception 'ENGINEPRO_AUTH_REQUIRED' using errcode='42501';end if;
 perform elitetrade_private.require_browser();
 if exists(select 1 from auth.mfa_factors where user_id=v_user and status='verified')
  and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
  raise exception 'ENGINEPRO_MFA_REQUIRED' using errcode='42501';end if;
 if not exists(select 1 from public.elitetrade_accounts x join public.elitetrade_profiles p on p.id=x.user_id
  where x.id=p_account_id and x.user_id=v_user and not p.disabled) then
  raise exception 'ENGINEPRO_ACCOUNT_NOT_FOUND' using errcode='42501';end if;
 if p_stop then
  insert into elitetrade_private.enginepro_accounts(account_id,user_id) values(p_account_id,v_user) on conflict do nothing;
  select * into a from elitetrade_private.enginepro_accounts where account_id=p_account_id for update;
  update elitetrade_private.enginepro_accounts set stopped=true,epoch=epoch+1,lease_owner=null,lease_until=null,
   execution_authorized_until=null,updated_at=clock_timestamp() where account_id=p_account_id returning * into a;
  -- A sent request is never labelled cancelled: the broker outcome is unknown.
  with changed as (
   update elitetrade_private.enginepro_intents set state=case when state='submitting' then 'unknown' else 'cancelled' end,
    updated_at=clock_timestamp() where account_id=p_account_id and state in ('created','validating','ready','submitting') returning id,state
  ) insert into elitetrade_private.enginepro_events(account_id,intent_id,code,epoch)
   select p_account_id,id,case when state='unknown' then 'STOP_OUTCOME_UNKNOWN' else 'STOP_CANCELLED_UNSENT' end,a.epoch from changed;
  insert into elitetrade_private.enginepro_events(account_id,code,epoch) values(p_account_id,'OWNER_STOP',a.epoch);
 else
  select * into a from elitetrade_private.enginepro_accounts where account_id=p_account_id;
 end if;
 select count(*) into unresolved from elitetrade_private.enginepro_intents where account_id=p_account_id and state in ('submitting','accepted','unknown');
 select coalesce(jsonb_agg(r),'[]'::jsonb) into recent from
  (select id,bot_id,state,broker_receipt,created_at,updated_at from elitetrade_private.enginepro_intents where account_id=p_account_id order by created_at desc,id limit 20) r;
 return jsonb_build_object('accountId',p_account_id,'killSwitch',coalesce(a.stopped,true),'epoch',coalesce(a.epoch,0)::text,
  'executionEnabled',false,'positionsClosed',false,'legacyEngineAffected',false,
  'unresolvedCount',unresolved,'intents',recent,'checkedAt',clock_timestamp(),'scope','independent-engine-only');
end;$$;
revoke all on function elitetrade_private.enginepro_account(uuid,boolean) from public,anon;
grant execute on function elitetrade_private.enginepro_account(uuid,boolean) to authenticated;
create function public.elitetrade_enginepro_account(p_account_id uuid,p_stop boolean default false) returns jsonb
language sql security invoker set search_path='' as $$select elitetrade_private.enginepro_account(p_account_id,p_stop);$$;
revoke all on function public.elitetrade_enginepro_account(uuid,boolean) from public,anon;
grant execute on function public.elitetrade_enginepro_account(uuid,boolean) to authenticated;

-- Account row lock serializes leases, stop, reservation and transitions.
-- Epochs fence DATABASE writes only. A broker cannot be fenced by this table.
create function public.elitetrade_enginepro_claim(p_account_id uuid,p_owner uuid,p_ttl integer default 30) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a elitetrade_private.enginepro_accounts; v_user uuid;
begin
 if current_user<>'service_role' then raise exception 'ENGINEPRO_WORKER_REQUIRED' using errcode='42501';end if;
 if p_owner is null or p_ttl is null or p_ttl not between 5 and 120 then raise exception 'ENGINEPRO_LEASE_INVALID';end if;
 select user_id into v_user from public.elitetrade_accounts where id=p_account_id;
 if not found then raise exception 'ENGINEPRO_ACCOUNT_NOT_FOUND';end if;
 insert into elitetrade_private.enginepro_accounts(account_id,user_id) values(p_account_id,v_user) on conflict do nothing;
 select * into a from elitetrade_private.enginepro_accounts where account_id=p_account_id for update;
 if a.lease_until>clock_timestamp() and a.lease_owner<>p_owner then return null;end if;
 if a.lease_until is null or a.lease_until<=clock_timestamp() then
  update elitetrade_private.enginepro_accounts set epoch=epoch+1 where account_id=p_account_id returning * into a;
  with changed as (update elitetrade_private.enginepro_intents set state='unknown',updated_at=clock_timestamp()
   where account_id=p_account_id and state='submitting' returning id)
  insert into elitetrade_private.enginepro_events(account_id,intent_id,code,epoch)
   select p_account_id,id,'LEASE_LOST_OUTCOME_UNKNOWN',a.epoch from changed;
 end if;
 update elitetrade_private.enginepro_accounts set lease_owner=p_owner,lease_until=clock_timestamp()+make_interval(secs=>p_ttl),updated_at=clock_timestamp()
  where account_id=p_account_id returning * into a;
 return jsonb_build_object('epoch',a.epoch::text,'expiresAt',a.lease_until,'stopped',a.stopped);
end;$$;
revoke all on function public.elitetrade_enginepro_claim(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.elitetrade_enginepro_claim(uuid,uuid,integer) to service_role;

create function public.elitetrade_enginepro_prepare(p_account_id uuid,p_bot_id uuid,p_owner uuid,p_epoch bigint,
 p_strategy_version text,p_signal_key text,p_command jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare a elitetrade_private.enginepro_accounts; existing elitetrade_private.enginepro_intents; result uuid;
begin
 if current_user<>'service_role' then raise exception 'ENGINEPRO_WORKER_REQUIRED' using errcode='42501';end if;
 select * into a from elitetrade_private.enginepro_accounts where account_id=p_account_id for update;
 if not found or p_owner is null or p_epoch is null or a.lease_owner is distinct from p_owner or a.epoch<>p_epoch
  or a.lease_until<=clock_timestamp() or a.lease_until is null then raise exception 'ENGINEPRO_LEASE_LOST';end if;
 if a.stopped then raise exception 'ENGINEPRO_STOPPED';end if;
 if not exists(select 1 from public.elitetrade_accounts x where x.id=p_account_id and x.user_id=a.user_id
  and x.broker='Exness' and x.server ~ '^Exness-MT5Trial[1-9][0-9]*$') then raise exception 'ENGINEPRO_DEMO_REQUIRED';end if;
 if not exists(select 1 from public.elitetrade_bots b where b.id=p_bot_id and b.account_id=p_account_id and b.user_id=a.user_id)
  then raise exception 'ENGINEPRO_BOT_BINDING_REJECTED';end if;
 if not exists(select 1 from public.elitetrade_profiles p where p.id=a.user_id and not p.disabled and (p.active or p.role='admin'))
  then raise exception 'ENGINEPRO_PERMISSION_REJECTED';end if;
 -- Strict typed intent, no credential fields, comments or arbitrary log payloads.
 if not coalesce(jsonb_typeof(p_command)='object'
  and (p_command-array['symbol','side','volume','stopLoss','takeProfit'])='{}'::jsonb
  and jsonb_typeof(p_command->'symbol')='string' and (p_command->>'symbol') ~ '^[A-Za-z0-9._-]{3,30}$'
  and (p_command->>'side') in ('buy','sell')
  and jsonb_typeof(p_command->'volume')='string' and (p_command->>'volume') ~ '^[0-9]{1,12}(\.[0-9]{1,8})?$'
  and jsonb_typeof(p_command->'stopLoss')='string' and (p_command->>'stopLoss') ~ '^[0-9]{1,12}(\.[0-9]{1,8})?$'
  and jsonb_typeof(p_command->'takeProfit')='string' and (p_command->>'takeProfit') ~ '^[0-9]{1,12}(\.[0-9]{1,8})?$'
  and p_strategy_version ~ '^[a-f0-9]{64}$' and p_signal_key ~ '^[a-f0-9]{64}$',false)
 then raise exception 'ENGINEPRO_INTENT_INVALID';end if;
 if (p_command->>'volume')::numeric<=0 or (p_command->>'stopLoss')::numeric<=0 or (p_command->>'takeProfit')::numeric<=0 then raise exception 'ENGINEPRO_INTENT_INVALID';end if;
 select * into existing from elitetrade_private.enginepro_intents where account_id=p_account_id and bot_id=p_bot_id and signal_key=p_signal_key;
 if found then
  if existing.strategy_version<>p_strategy_version or existing.command<>p_command then raise exception 'ENGINEPRO_SIGNAL_CONFLICT';end if;
  return existing.id;
 end if;
 if exists(select 1 from elitetrade_private.enginepro_intents where account_id=p_account_id and state in ('created','validating','ready','submitting','accepted','unknown'))
 then raise exception 'ENGINEPRO_RECONCILIATION_REQUIRED';end if;
 insert into elitetrade_private.enginepro_intents(account_id,user_id,bot_id,strategy_version,signal_key,command)
 values(p_account_id,a.user_id,p_bot_id,p_strategy_version,p_signal_key,p_command) returning id into result;
 insert into elitetrade_private.enginepro_events(account_id,intent_id,code,epoch) values(p_account_id,result,'INTENT_CREATED',a.epoch);
 return result;
end;$$;
revoke all on function public.elitetrade_enginepro_prepare(uuid,uuid,uuid,bigint,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.elitetrade_enginepro_prepare(uuid,uuid,uuid,bigint,text,text,jsonb) to service_role;

create function public.elitetrade_enginepro_advance(p_intent_id uuid,p_owner uuid,p_epoch bigint,p_next text,p_receipt jsonb default null) returns text
language plpgsql security invoker set search_path='' as $$
declare a elitetrade_private.enginepro_accounts; i elitetrade_private.enginepro_intents; v_account uuid;
begin
 if current_user<>'service_role' then raise exception 'ENGINEPRO_WORKER_REQUIRED' using errcode='42501';end if;
 select account_id into v_account from elitetrade_private.enginepro_intents where id=p_intent_id;
 select * into a from elitetrade_private.enginepro_accounts where account_id=v_account for update;
 if not found or p_owner is null or p_epoch is null or a.lease_owner is distinct from p_owner or a.epoch<>p_epoch
  or a.lease_until<=clock_timestamp() or a.lease_until is null then raise exception 'ENGINEPRO_LEASE_LOST';end if;
 select * into i from elitetrade_private.enginepro_intents where id=p_intent_id for update;
 if p_next is null or not ((i.state='created' and p_next in ('validating','rejected','cancelled'))
  or (i.state='validating' and p_next in ('ready','rejected','cancelled'))
  or (i.state='ready' and p_next in ('submitting','rejected','cancelled'))
  or (i.state='submitting' and p_next in ('accepted','rejected','unknown'))
  or (i.state in ('accepted','unknown') and p_next='reconciled')) then raise exception 'ENGINEPRO_TRANSITION_REJECTED';end if;
 if a.stopped and p_next in ('validating','ready','submitting') then raise exception 'ENGINEPRO_STOPPED';end if;
 if p_next='submitting' then
  if not exists(select 1 from public.elitetrade_accounts x where x.id=v_account and x.user_id=i.user_id
   and x.broker='Exness' and x.server ~ '^Exness-MT5Trial[1-9][0-9]*$') then raise exception 'ENGINEPRO_DEMO_REQUIRED';end if;
  if a.broker_verified_until is null or a.broker_verified_until<=clock_timestamp()
   or a.execution_authorized_until is null or a.execution_authorized_until<=clock_timestamp()
   then raise exception 'ENGINEPRO_COMMISSIONING_REQUIRED';end if;
  if not exists(select 1 from public.elitetrade_profiles p where p.id=i.user_id and not p.disabled and (p.active or p.role='admin'))
   then raise exception 'ENGINEPRO_PERMISSION_REJECTED';end if;
 end if;
 if p_next in ('accepted','reconciled') then
  if not coalesce(jsonb_typeof(p_receipt)='object' and (p_receipt-array['orderId','dealId','positionId'])='{}'::jsonb
   and (p_receipt->>'orderId') ~ '^[0-9]{1,30}$'
   and (not p_receipt ? 'dealId' or (p_receipt->>'dealId') ~ '^[0-9]{1,30}$')
   and (not p_receipt ? 'positionId' or (p_receipt->>'positionId') ~ '^[0-9]{1,30}$'),false)
   then raise exception 'ENGINEPRO_BROKER_RECEIPT_REQUIRED';end if;
  if i.broker_receipt is not null and i.broker_receipt->>'orderId' is distinct from p_receipt->>'orderId'
   then raise exception 'ENGINEPRO_RECEIPT_IDENTITY_REJECTED';end if;
 else
  if p_receipt is not null then raise exception 'ENGINEPRO_RECEIPT_REJECTED';end if;
 end if;
 update elitetrade_private.enginepro_intents set state=p_next,broker_receipt=coalesce(p_receipt,broker_receipt),updated_at=clock_timestamp() where id=p_intent_id;
 insert into elitetrade_private.enginepro_events(account_id,intent_id,code,epoch) values(v_account,p_intent_id,upper(p_next),a.epoch);
 return p_next;
end;$$;
revoke all on function public.elitetrade_enginepro_advance(uuid,uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.elitetrade_enginepro_advance(uuid,uuid,bigint,text,jsonb) to service_role;

create function public.elitetrade_enginepro_load(p_intent_id uuid,p_owner uuid,p_epoch bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i elitetrade_private.enginepro_intents; a elitetrade_private.enginepro_accounts;
begin
 if current_user<>'service_role' then raise exception 'ENGINEPRO_WORKER_REQUIRED' using errcode='42501';end if;
 select * into i from elitetrade_private.enginepro_intents where id=p_intent_id;
 if not found then raise exception 'ENGINEPRO_INTENT_NOT_FOUND';end if;
 select * into a from elitetrade_private.enginepro_accounts where account_id=i.account_id;
 if p_owner is null or p_epoch is null or a.lease_owner is distinct from p_owner or a.epoch<>p_epoch
  or a.lease_until is null or a.lease_until<=clock_timestamp() then raise exception 'ENGINEPRO_LEASE_LOST';end if;
 return jsonb_build_object('id',i.id,'accountId',i.account_id,'botId',i.bot_id,'state',i.state,
  'command',i.command,'strategyVersion',i.strategy_version,'signalKey',i.signal_key,'stopped',a.stopped);
end;$$;
revoke all on function public.elitetrade_enginepro_load(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.elitetrade_enginepro_load(uuid,uuid,bigint) to service_role;
commit;
