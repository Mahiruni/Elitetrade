-- EliteBridge Phase 4: dormant, DEMO-only device trust and replay state.
-- NO broker connection, public enrollment RPC, order transport or provider switch.
-- Apply separately after review. Service-role access is server-side ONLY.
begin;

create table if not exists elitetrade_private.bridge_devices (
  id uuid primary key,
  owner_id uuid not null references public.elitetrade_profiles(id) on delete cascade,
  account_id uuid not null references public.elitetrade_accounts(id) on delete cascade,
  role text not null default 'terminal' check(role='terminal'),
  display_name text not null check(length(display_name) between 1 and 64),
  public_key_spki text not null check(public_key_spki ~ '^[A-Za-z0-9_-]{58,100}$'),
  fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  state text not null default 'pending' check(state in ('pending','approved','revoked')),
  approved_by uuid references public.elitetrade_profiles(id),
  approved_at timestamptz,
  revoked_at timestamptz,
  last_sequence bigint not null default 0 check(last_sequence >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(account_id,fingerprint)
);
create index if not exists bridge_devices_owner_idx
  on elitetrade_private.bridge_devices(owner_id,created_at desc);
-- Deliberately limit Phase 4 to one approved terminal per MT5 account.
create unique index if not exists bridge_one_approved_terminal
  on elitetrade_private.bridge_devices(account_id) where state='approved';

create table if not exists elitetrade_private.bridge_accepted_messages (
  message_id text primary key check(message_id ~ '^[0-9a-f]{32}$'),
  device_id uuid not null references elitetrade_private.bridge_devices(id) on delete cascade,
  owner_id uuid not null,
  account_id uuid not null,
  sequence bigint not null check(sequence > 0),
  kind text not null check(kind in ('terminal.heartbeat','terminal.quote')),
  accepted_at timestamptz not null default clock_timestamp(),
  unique(device_id,sequence)
);
create index if not exists bridge_accepted_device_idx
  on elitetrade_private.bridge_accepted_messages(device_id,accepted_at desc);

alter table elitetrade_private.bridge_devices enable row level security;
alter table elitetrade_private.bridge_accepted_messages enable row level security;
revoke all on elitetrade_private.bridge_devices,
  elitetrade_private.bridge_accepted_messages from public,anon,authenticated;
grant select,insert,update on elitetrade_private.bridge_devices to service_role;
grant select,insert on elitetrade_private.bridge_accepted_messages to service_role;
grant usage on schema elitetrade_private to service_role;

-- Caller: trusted backend with service_role; never Android or a client JWT.
create or replace function public.elitetrade_bridge_stage(
  p_owner_id uuid,p_account_id uuid,p_device_id uuid,p_display_name text,
  p_public_key_spki text,p_fingerprint text
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if current_user <> 'service_role' then raise exception 'trusted backend required' using errcode='42501';end if;
  if p_display_name is null or length(p_display_name) not between 1 and 64
    or p_public_key_spki !~ '^[A-Za-z0-9_-]{58,100}$'
    or p_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid device enrollment';
  end if;
  if not exists(select 1 from public.elitetrade_accounts where id=p_account_id and user_id=p_owner_id)
    or not exists(select 1 from public.elitetrade_profiles where id=p_owner_id and not disabled) then
    raise exception 'account is unavailable' using errcode='42501';
  end if;
  insert into elitetrade_private.bridge_devices
    (id,owner_id,account_id,role,display_name,public_key_spki,fingerprint)
  values(p_device_id,p_owner_id,p_account_id,'terminal',p_display_name,p_public_key_spki,p_fingerprint);
  return true;
end;$$;

create or replace function public.elitetrade_bridge_approve(
  p_actor_id uuid,p_device_id uuid
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if current_user <> 'service_role' then raise exception 'trusted backend required' using errcode='42501';end if;
  if not exists(select 1 from public.elitetrade_profiles
      where id=p_actor_id and role='admin' and not disabled) then
    raise exception 'administrator required' using errcode='42501';
  end if;
  update elitetrade_private.bridge_devices d
    set state='approved',approved_by=p_actor_id,approved_at=clock_timestamp(),updated_at=clock_timestamp()
    where d.id=p_device_id and d.state='pending'
      and exists(select 1 from public.elitetrade_accounts a
        where a.id=d.account_id and a.user_id=d.owner_id);
  if not found then return false;end if;
  return true;
end;$$;

create or replace function public.elitetrade_bridge_revoke(
  p_actor_id uuid,p_device_id uuid
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if current_user <> 'service_role' then raise exception 'trusted backend required' using errcode='42501';end if;
  update elitetrade_private.bridge_devices d
    set state='revoked',revoked_at=clock_timestamp(),updated_at=clock_timestamp()
    where d.id=p_device_id and d.state<>'revoked'
      and (d.owner_id=p_actor_id or exists(select 1 from public.elitetrade_profiles p
        where p.id=p_actor_id and p.role='admin' and not p.disabled));
  if not found then return false;end if;
  return true;
end;$$;

-- Never disclose key material to client tokens.
create or replace function public.elitetrade_bridge_key(
  p_owner_id uuid,p_account_id uuid,p_device_id uuid
) returns text language plpgsql security invoker set search_path='' as $$
declare v_key text;
begin
  if current_user <> 'service_role' then raise exception 'trusted backend required' using errcode='42501';end if;
  select public_key_spki into v_key from elitetrade_private.bridge_devices
    where id=p_device_id and owner_id=p_owner_id and account_id=p_account_id
      and role='terminal' and state='approved';
  return v_key;
end;$$;

-- One PostgreSQL transaction / row lock for replay checks and audit persistence.
-- The application must validate Ed25519 BEFORE invoking this RPC.
-- Revoke competes for the same device row lock, so revoked keys cannot claim.
create or replace function public.elitetrade_bridge_claim(
  p_owner_id uuid,p_account_id uuid,p_device_id uuid,
  p_sequence bigint,p_message_id text,p_kind text
) returns boolean language plpgsql security invoker set search_path='' as $$
declare v_last bigint;v_added text;
begin
  if current_user <> 'service_role' then raise exception 'trusted backend required' using errcode='42501';end if;
  if p_sequence is null or p_sequence < 1 or p_message_id !~ '^[0-9a-f]{32}$'
    or p_kind not in ('terminal.heartbeat','terminal.quote') then return false;end if;
  select last_sequence into v_last from elitetrade_private.bridge_devices
    where id=p_device_id and owner_id=p_owner_id and account_id=p_account_id
      and state='approved' and role='terminal' for update;
  if not found or p_sequence <= v_last then return false;end if;
  insert into elitetrade_private.bridge_accepted_messages
    (message_id,device_id,owner_id,account_id,sequence,kind)
  values(p_message_id,p_device_id,p_owner_id,p_account_id,p_sequence,p_kind)
  on conflict do nothing returning message_id into v_added;
  if v_added is null then return false;end if;
  update elitetrade_private.bridge_devices set last_sequence=p_sequence,
    updated_at=clock_timestamp() where id=p_device_id;
  return true;
end;$$;

revoke all on function public.elitetrade_bridge_stage(uuid,uuid,uuid,text,text,text),
  public.elitetrade_bridge_approve(uuid,uuid),
  public.elitetrade_bridge_revoke(uuid,uuid),
  public.elitetrade_bridge_key(uuid,uuid,uuid),
  public.elitetrade_bridge_claim(uuid,uuid,uuid,bigint,text,text)
  from public,anon,authenticated;
grant execute on function public.elitetrade_bridge_stage(uuid,uuid,uuid,text,text,text),
  public.elitetrade_bridge_approve(uuid,uuid),
  public.elitetrade_bridge_revoke(uuid,uuid),
  public.elitetrade_bridge_key(uuid,uuid,uuid),
  public.elitetrade_bridge_claim(uuid,uuid,uuid,bigint,text,text)
  to service_role;
commit;
