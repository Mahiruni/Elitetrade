begin;
create table if not exists public.elitetrade_engine_heartbeat (
 id boolean primary key default true check (id), updated_at timestamptz not null default now()
);
create table if not exists public.elitetrade_engine_runs (
 bot_id uuid primary key references public.elitetrade_bots(id) on delete cascade,
 user_id uuid not null references public.elitetrade_profiles(id),
 account_id uuid not null references public.elitetrade_accounts(id),
 enabled boolean not null default false,
 config jsonb not null,
 updated_at timestamptz not null default now(),
 message text not null default 'Stopped'
);
create index if not exists elitetrade_engine_runs_owner on public.elitetrade_engine_runs(user_id);
create unique index if not exists elitetrade_one_engine_per_account on public.elitetrade_engine_runs(account_id) where enabled;
create table if not exists public.elitetrade_engine_risk (
 account_id uuid primary key, day text not null, day_equity numeric not null check (day_equity>0),peak_equity numeric not null check (peak_equity>0)
);
create table if not exists public.elitetrade_engine_leases (
 account_id uuid primary key, owner uuid not null, expires_at timestamptz not null
);
create table if not exists public.elitetrade_engine_orders (
 id uuid primary key default gen_random_uuid(),bot_id uuid not null,user_id uuid not null,account_id uuid not null,
 candle_time bigint not null,status text not null check(status in ('reserved','confirmed','unknown','cancelled')),
 request jsonb not null,result jsonb,created_at timestamptz not null default now(),
 unique(bot_id,candle_time)
);
create index if not exists elitetrade_engine_orders_owner on public.elitetrade_engine_orders(user_id);
create index if not exists elitetrade_engine_orders_pending on public.elitetrade_engine_orders(account_id,status);
alter table public.elitetrade_engine_heartbeat enable row level security;
alter table public.elitetrade_engine_runs enable row level security;
alter table public.elitetrade_engine_risk enable row level security;
alter table public.elitetrade_engine_leases enable row level security;
alter table public.elitetrade_engine_orders enable row level security;
revoke all on public.elitetrade_engine_heartbeat,public.elitetrade_engine_runs,public.elitetrade_engine_risk,public.elitetrade_engine_leases,public.elitetrade_engine_orders from anon,authenticated;
grant select on public.elitetrade_engine_heartbeat to anon,authenticated;
grant select on public.elitetrade_engine_runs,public.elitetrade_engine_orders to authenticated;
grant all on public.elitetrade_engine_heartbeat,public.elitetrade_engine_runs,public.elitetrade_engine_risk,public.elitetrade_engine_leases,public.elitetrade_engine_orders to service_role;
drop policy if exists engine_public_health on public.elitetrade_engine_heartbeat;
create policy engine_public_health on public.elitetrade_engine_heartbeat for select to anon,authenticated using(true);
drop policy if exists engine_own_runs on public.elitetrade_engine_runs;
create policy engine_own_runs on public.elitetrade_engine_runs for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists engine_own_orders on public.elitetrade_engine_orders;
create policy engine_own_orders on public.elitetrade_engine_orders for select to authenticated using(user_id=(select auth.uid()));

create or replace function elitetrade_private.engine_control(p_bot_id uuid,p_running boolean) returns void
language plpgsql security definer set search_path='' as $$
declare b public.elitetrade_bots; a public.elitetrade_accounts;
begin
 if auth.uid() is null then raise exception 'sign in required';end if;
 if exists(select 1 from auth.mfa_factors where user_id=auth.uid() and status='verified') and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then raise exception 'complete two-factor authentication';end if;
 select * into b from public.elitetrade_bots where id=p_bot_id and user_id=auth.uid() for update;
 if not found then raise exception 'bot not found';end if;
 if b.account_id is null then raise exception 'select an MT5 account first';end if;
 perform pg_advisory_xact_lock(hashtextextended(b.account_id::text,0));
 if exists(select 1 from public.elitetrade_engine_leases where account_id=b.account_id and expires_at>now()) then raise exception 'connection command in progress; retry shortly';end if;
 if not p_running and exists(select 1 from public.elitetrade_engine_orders where account_id=b.account_id and status='reserved') then raise exception 'unconfirmed order in progress; reconcile before stopping';end if;
 if p_running then
  if not exists(select 1 from public.elitetrade_engine_heartbeat where updated_at>now()-interval '90 seconds') then raise exception 'demo worker unavailable';end if;
  if not exists(select 1 from public.elitetrade_profiles where id=auth.uid() and not disabled and (active or role='admin')) then raise exception 'activate subscription first';end if;
  select * into a from public.elitetrade_accounts where id=b.account_id and user_id=auth.uid();
  if a.status<>'connected' or a.gateway_id is null or a.gateway_id not like 'metaapi:%' then raise exception 'confirm the MT5 connection first';end if;
  if exists(select 1 from public.elitetrade_engine_orders where account_id=b.account_id and status in ('reserved','unknown')) then raise exception 'unconfirmed order requires provider reconciliation';end if;
  if exists(select 1 from public.elitetrade_engine_runs where account_id=b.account_id and enabled and bot_id<>p_bot_id) then raise exception 'another bot already monitors this account';end if;
  if exists(select 1 from public.elitetrade_engine_runs where bot_id=p_bot_id and enabled) then return;end if;
 end if;
 insert into public.elitetrade_engine_runs(bot_id,user_id,account_id,enabled,config,message)
 values(b.id,b.user_id,b.account_id,p_running,to_jsonb(b),case when p_running then 'Armed for demo monitoring; waiting for worker evaluation' else 'Stopped; broker positions remain open' end)
 on conflict(bot_id) do update set enabled=excluded.enabled,config=excluded.config,updated_at=now(),message=excluded.message;
 update public.elitetrade_bots set status=case when p_running then 'running' else 'stopped' end where id=p_bot_id;
end;$$;
grant usage on schema elitetrade_private to authenticated;
revoke all on function elitetrade_private.engine_control(uuid,boolean) from public,anon;
grant execute on function elitetrade_private.engine_control(uuid,boolean) to authenticated;
create or replace function public.elitetrade_engine_control(p_bot_id uuid,p_running boolean) returns void
language sql security invoker set search_path='' as $$select elitetrade_private.engine_control(p_bot_id,p_running);$$;
revoke all on function public.elitetrade_engine_control(uuid,boolean) from public,anon;
grant execute on function public.elitetrade_engine_control(uuid,boolean) to authenticated;

create or replace function public.elitetrade_engine_lease(p_account_id uuid,p_owner uuid,p_release boolean default false) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'worker access required';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account_id::text,0));
 if p_release then delete from public.elitetrade_engine_leases where account_id=p_account_id and owner=p_owner;return true;end if;
 if exists(select 1 from public.elitetrade_engine_leases where account_id=p_account_id and expires_at>now()) then return false;end if;
 insert into public.elitetrade_engine_leases values(p_account_id,p_owner,now()+interval '120 seconds')
 on conflict(account_id) do update set owner=excluded.owner,expires_at=excluded.expires_at;
 return true;
end;$$;
revoke all on function public.elitetrade_engine_lease(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.elitetrade_engine_lease(uuid,uuid,boolean) to service_role;

create or replace function public.elitetrade_engine_reserve(p_bot_id uuid,p_owner uuid,p_candle_time bigint,p_request jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.elitetrade_engine_runs; receipt uuid;
begin
 if current_user<>'service_role' then raise exception 'worker access required';end if;
 select * into r from public.elitetrade_engine_runs where bot_id=p_bot_id and enabled;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(r.account_id::text,0));
 select * into r from public.elitetrade_engine_runs where bot_id=p_bot_id and enabled for update;
 if not found then return null;end if;
 if not exists(select 1 from public.elitetrade_engine_leases where account_id=r.account_id and owner=p_owner and expires_at>now()) then return null;end if;
 if not exists(select 1 from public.elitetrade_profiles where id=r.user_id and not disabled and (active or role='admin')) then return null;end if;
 if not exists(select 1 from public.elitetrade_accounts where id=r.account_id and user_id=r.user_id and status='connected') then return null;end if;
 if exists(select 1 from public.elitetrade_engine_orders where account_id=r.account_id and status in ('reserved','unknown')) then return null;end if;
 insert into public.elitetrade_engine_orders(bot_id,user_id,account_id,candle_time,status,request)
 values(r.bot_id,r.user_id,r.account_id,p_candle_time,'reserved',p_request)
 on conflict(bot_id,candle_time) do nothing returning id into receipt;
 return receipt;
end;$$;
revoke all on function public.elitetrade_engine_reserve(uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.elitetrade_engine_reserve(uuid,uuid,bigint,jsonb) to service_role;

create or replace function elitetrade_private.engine_forget_account(p_account_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.elitetrade_accounts where id=p_account_id and user_id=auth.uid()) then raise exception 'account not found';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account_id::text,0));
 if exists(select 1 from public.elitetrade_engine_runs where account_id=p_account_id and enabled) then raise exception 'must stop demo monitoring first';end if;
 if exists(select 1 from public.elitetrade_engine_leases where account_id=p_account_id and expires_at>now()) or exists(select 1 from public.elitetrade_engine_orders where account_id=p_account_id and status in ('reserved','unknown')) then raise exception 'unconfirmed order or command requires reconciliation before removal';end if;
 update public.elitetrade_accounts set status='disconnected' where id=p_account_id and user_id=auth.uid();
 delete from public.elitetrade_engine_runs where account_id=p_account_id and user_id=auth.uid();
end;$$;
revoke all on function elitetrade_private.engine_forget_account(uuid) from public,anon;
grant execute on function elitetrade_private.engine_forget_account(uuid) to authenticated;
create or replace function public.elitetrade_engine_forget_account(p_account_id uuid) returns void
language sql security invoker set search_path='' as $$select elitetrade_private.engine_forget_account(p_account_id);$$;
revoke all on function public.elitetrade_engine_forget_account(uuid) from public,anon;
grant execute on function public.elitetrade_engine_forget_account(uuid) to authenticated;
create index if not exists elitetrade_engine_runs_account on public.elitetrade_engine_runs(account_id);
drop policy if exists engine_worker_risk on public.elitetrade_engine_risk;
create policy engine_worker_risk on public.elitetrade_engine_risk for all to service_role using(true) with check(true);
drop policy if exists engine_worker_leases on public.elitetrade_engine_leases;
create policy engine_worker_leases on public.elitetrade_engine_leases for all to service_role using(true) with check(true);
commit;
