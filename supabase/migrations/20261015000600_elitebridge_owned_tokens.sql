-- EliteBridge-owned API tokens: read-only status capability, NOT MetaApi credentials.
-- Requires existing Supabase auth/profiles. No changes to bots, orders or broker gateway.
begin;
create schema if not exists elitetrade_private;

create table if not exists elitetrade_private.elitetrade_bridge_api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.elitetrade_profiles(id) on delete cascade,
  label text not null check(char_length(label) between 3 and 48),
  scope text not null default 'bridge:status' check(scope='bridge:status'),
  token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  constraint elite_bridge_token_expiry check(expires_at > created_at and expires_at <= created_at + interval '30 days')
);
create index if not exists elitetrade_bridge_api_tokens_owner_idx
  on elitetrade_private.elitetrade_bridge_api_tokens(user_id,created_at desc);
alter table elitetrade_private.elitetrade_bridge_api_tokens enable row level security;
revoke all on table elitetrade_private.elitetrade_bridge_api_tokens from public,anon,authenticated;

-- Management RPCs are always independently owner/admin + AAL2 checked:
-- even if called directly via Supabase instead of through the application.
create or replace function public.elitetrade_bridge_token_issue(
  p_label text,p_hash text,p_expires_hours integer default 168
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare v_user uuid;v_id uuid;v_count integer;
begin
  v_user := auth.uid();
  if v_user is null or not exists(
    select 1 from public.elitetrade_profiles p where p.id=v_user
       and p.role='admin' and p.disabled=false
  ) or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'EliteBridge token management requires a verified administrator session with MFA';
  end if;
  if p_label is null or char_length(p_label) not between 3 and 48
     or p_label !~ '^[A-Za-z0-9][A-Za-z0-9 ._:-]*$'
     or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
     or p_expires_hours is null or p_expires_hours not between 1 and 720 then
    raise exception 'Invalid EliteBridge API token request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('EliteBridge/token/'||v_user::text,0));
  select count(*) into v_count
    from elitetrade_private.elitetrade_bridge_api_tokens t
    where t.user_id=v_user and t.revoked_at is null and t.expires_at>now();
  if v_count>=5 then raise exception 'Revoke an active EliteBridge token before issuing another'; end if;
  insert into elitetrade_private.elitetrade_bridge_api_tokens
    (user_id,label,token_hash,expires_at)
    values(v_user,p_label,p_hash,now()+pg_catalog.make_interval(hours=>p_expires_hours))
    returning id into v_id;
  return v_id;
end $$;

create or replace function public.elitetrade_bridge_token_list()
returns table(id uuid,label text,scope text,created_at timestamptz,
  expires_at timestamptz,revoked_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare v_user uuid;
begin
  v_user := auth.uid();
  if v_user is null or not exists(
    select 1 from public.elitetrade_profiles p where p.id=v_user
       and p.role='admin' and p.disabled=false
  ) or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'EliteBridge token management requires an administrator with MFA';
  end if;
  return query select t.id,t.label,t.scope,t.created_at,t.expires_at,t.revoked_at
    from elitetrade_private.elitetrade_bridge_api_tokens t
    where t.user_id=v_user order by t.created_at desc limit 30;
end $$;

create or replace function public.elitetrade_bridge_token_revoke(p_id uuid)
returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_user uuid;v_changed integer;
begin
  v_user := auth.uid();
  if v_user is null or not exists(
    select 1 from public.elitetrade_profiles p where p.id=v_user
       and p.role='admin' and p.disabled=false
  ) or coalesce(auth.jwt()->>'aal','')<>'aal2' then
    raise exception 'EliteBridge token management requires an administrator with MFA';
  end if;
  update elitetrade_private.elitetrade_bridge_api_tokens t
  set revoked_at=now()
  where t.id=p_id and t.user_id=v_user and t.revoked_at is null;
  get diagnostics v_changed=row_count;
  return v_changed=1;
end $$;

-- This verification RPC is callable ONLY by the server's service_role;
-- public/authenticated identities can never test candidate token digests.
create or replace function public.elitetrade_bridge_token_verify(p_hash text)
returns table(owner_id uuid,scope text)
language plpgsql security definer set search_path=''
as $$
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then return; end if;
  return query
    update elitetrade_private.elitetrade_bridge_api_tokens t
      set last_used_at=now()
    where t.token_hash=p_hash and t.revoked_at is null
      and t.expires_at>now()
    returning t.user_id,t.scope;
end $$;

revoke all on function public.elitetrade_bridge_token_issue(text,text,integer) from public,anon,authenticated;
revoke all on function public.elitetrade_bridge_token_list() from public,anon,authenticated;
revoke all on function public.elitetrade_bridge_token_revoke(uuid) from public,anon,authenticated;
revoke all on function public.elitetrade_bridge_token_verify(text) from public,anon,authenticated;
grant execute on function public.elitetrade_bridge_token_issue(text,text,integer) to authenticated;
grant execute on function public.elitetrade_bridge_token_list() to authenticated;
grant execute on function public.elitetrade_bridge_token_revoke(uuid) to authenticated;
grant execute on function public.elitetrade_bridge_token_verify(text) to service_role;
commit;
