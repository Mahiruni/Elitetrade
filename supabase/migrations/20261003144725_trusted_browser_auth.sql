-- Stage the new guard without interrupting the current deployment. Enable the
-- singleton flag after the matching application version is live.
create table elitetrade_private.browser_auth_config (
  id boolean primary key default true check (id),
  enforced boolean not null default false
);
insert into elitetrade_private.browser_auth_config(id,enforced) values(true,false);

create table elitetrade_private.browser_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version text not null,
  changed_at timestamptz not null
);
create table elitetrade_private.trusted_browsers (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null check(device_hash ~ '^[0-9a-f]{64}$'),
  credential_version text not null,
  verified_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key(user_id,device_hash)
);
create table elitetrade_private.browser_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,
  credential_version text not null,
  expires_at timestamptz not null,
  foreign key(user_id,device_hash)
    references elitetrade_private.trusted_browsers(user_id,device_hash) on delete cascade
);
create index browser_sessions_user on elitetrade_private.browser_sessions(user_id);
alter table elitetrade_private.browser_auth_config enable row level security;
alter table elitetrade_private.browser_credentials enable row level security;
alter table elitetrade_private.trusted_browsers enable row level security;
alter table elitetrade_private.browser_sessions enable row level security;
revoke all on elitetrade_private.browser_auth_config,
  elitetrade_private.browser_credentials,elitetrade_private.trusted_browsers,
  elitetrade_private.browser_sessions from public,anon,authenticated;

insert into elitetrade_private.browser_credentials(user_id,version,changed_at)
select id,encode(extensions.digest(coalesce(encrypted_password,'') || '|' || coalesce(email,''),'sha256'),'hex'),
  coalesce(created_at,now()) from auth.users;

create function elitetrade_private.browser_credentials_changed() returns trigger
language plpgsql security definer set search_path='' as $fn$
begin
  if tg_op='INSERT' or new.encrypted_password is distinct from old.encrypted_password
     or new.email is distinct from old.email then
    insert into elitetrade_private.browser_credentials(user_id,version,changed_at)
    values(new.id,encode(extensions.digest(coalesce(new.encrypted_password,'') || '|' || coalesce(new.email,''),'sha256'),'hex'),clock_timestamp())
    on conflict(user_id) do update set version=excluded.version,changed_at=excluded.changed_at;
    -- Changing credentials removes all remembered browsers and their approvals.
    delete from elitetrade_private.trusted_browsers where user_id=new.id;
  end if;
  return new;
end;
$fn$;
revoke all on function elitetrade_private.browser_credentials_changed() from public,anon,authenticated;
create trigger elitetrade_browser_credentials_changed
after insert or update of encrypted_password,email on auth.users
for each row execute function elitetrade_private.browser_credentials_changed();

create function elitetrade_private.browser_verified() returns boolean
language plpgsql stable security definer set search_path='' as $fn$
declare
  v_user uuid := auth.uid();
  v_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  v_raw text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-elite-device','');
begin
  if auth.jwt()->>'role'='service_role' then return true; end if;
  if v_user is null then return false; end if;
  if not (select enforced from elitetrade_private.browser_auth_config where id) then return true; end if;
  if v_raw !~ '^[A-Za-z0-9_-]{43}$' or v_session is null then return false; end if;
  if exists(select 1 from auth.mfa_factors where user_id=v_user and status='verified')
     and coalesce(auth.jwt()->>'aal','')<>'aal2' then return false; end if;
  return exists(
    select 1 from elitetrade_private.browser_sessions bs
    join elitetrade_private.trusted_browsers b using(user_id,device_hash)
    join elitetrade_private.browser_credentials c using(user_id)
    join auth.sessions s on s.id=bs.session_id and s.user_id=bs.user_id
    where bs.user_id=v_user and bs.session_id=v_session
      and bs.device_hash=encode(extensions.digest(v_raw,'sha256'),'hex')
      and bs.credential_version=c.version and b.credential_version=c.version
      and s.created_at>=c.changed_at-interval '1 second'
      and bs.expires_at>now() and b.expires_at>now()
  );
end;
$fn$;
revoke all on function elitetrade_private.browser_verified() from public,anon;
grant execute on function elitetrade_private.browser_verified() to authenticated,service_role;

create function elitetrade_private.require_browser() returns void
language plpgsql security invoker set search_path='' as $fn$
begin
  if not elitetrade_private.browser_verified() then
    raise exception 'Verify this browser using your email before opening your account.' using errcode='42501';
  end if;
end;
$fn$;
revoke all on function elitetrade_private.require_browser() from public,anon;
grant execute on function elitetrade_private.require_browser() to authenticated,service_role;

create function elitetrade_private.browser_status() returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  v_user uuid := auth.uid();
  v_session uuid := nullif(auth.jwt()->>'session_id','')::uuid;
  v_raw text := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-elite-device','');
  v_hash text;
  v_version text;
  v_changed timestamptz;
  v_expiry timestamptz;
  v_proof boolean;
begin
  if v_user is null or v_session is null or v_raw !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'Sign in to verify this browser.' using errcode='42501';
  end if;
  -- Hold application enforcement as well as RLS during the coordinated rollout.
  -- Email delivery must be configured before unfamiliar browsers can be gated.
  if not (select enforced from elitetrade_private.browser_auth_config where id) then
    return jsonb_build_object('verified',true,'needsEmail',false,'enforced',false);
  end if;
  if not exists(select 1 from public.elitetrade_profiles where id=v_user and not disabled)
     or not exists(select 1 from auth.users where id=v_user and email_confirmed_at is not null) then
    raise exception 'This account is unavailable or its email is unconfirmed.' using errcode='42501';
  end if;
  select version,changed_at into v_version,v_changed
    from elitetrade_private.browser_credentials where user_id=v_user;
  if v_version is null or not exists(
    select 1 from auth.sessions where id=v_session and user_id=v_user
      and created_at>=v_changed-interval '1 second'
  ) then
    raise exception 'Your sign-in session has expired. Sign in again.' using errcode='42501';
  end if;
  v_hash:=encode(extensions.digest(v_raw,'sha256'),'hex');
  select expires_at into v_expiry from elitetrade_private.trusted_browsers
    where user_id=v_user and device_hash=v_hash and credential_version=v_version and expires_at>now();
  -- Trust signed authentication evidence, never editable user_metadata.
  select exists(
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a
    where a->>'method' in ('otp','magiclink','recovery','email/signup','email_change','invite','oauth','sso/saml','passkey')
      and (a->>'timestamp')::bigint>=greatest(extract(epoch from now()-interval '10 minutes')::bigint,
                                            extract(epoch from v_changed-interval '1 second')::bigint)
      and (a->>'timestamp')::bigint<=extract(epoch from now()+interval '30 seconds')::bigint
  ) into v_proof;
  if v_expiry is null and not v_proof then return jsonb_build_object('verified',false,'needsEmail',true); end if;
  if exists(select 1 from auth.mfa_factors where user_id=v_user and status='verified')
     and coalesce(auth.jwt()->>'aal','')<>'aal2' then
    return jsonb_build_object('verified',false,'needsEmail',false);
  end if;
  if v_expiry is null then
    v_expiry:=now()+interval '90 days';
    insert into elitetrade_private.trusted_browsers(user_id,device_hash,credential_version,expires_at)
      values(v_user,v_hash,v_version,v_expiry)
      on conflict(user_id,device_hash) do update set credential_version=excluded.credential_version,
        verified_at=now(),expires_at=excluded.expires_at;
  end if;
  insert into elitetrade_private.browser_sessions(session_id,user_id,device_hash,credential_version,expires_at)
    values(v_session,v_user,v_hash,v_version,v_expiry)
    on conflict(session_id) do update set device_hash=excluded.device_hash,
      credential_version=excluded.credential_version,expires_at=excluded.expires_at
    where browser_sessions.user_id=v_user;
  return jsonb_build_object('verified',true,'needsEmail',false,
    'expiresIn',greatest(1,extract(epoch from v_expiry-now())::integer));
end;
$fn$;
revoke all on function elitetrade_private.browser_status() from public,anon;
grant execute on function elitetrade_private.browser_status() to authenticated;
grant usage on schema elitetrade_private to authenticated,service_role;
create function public.elitetrade_browser_status() returns jsonb
language sql security invoker set search_path='' as $fn$
  select elitetrade_private.browser_status();
$fn$;
revoke all on function public.elitetrade_browser_status() from public,anon;
grant execute on function public.elitetrade_browser_status() to authenticated;

-- Restrictive policies combine with the existing ownership/admin policies.
do $migration$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname='public'
    and tablename like 'elitetrade_%'
    and tablename not in ('elitetrade_profiles','elitetrade_engine_heartbeat')
  loop
    execute format('create policy verified_browser on public.%I as restrictive for all to authenticated using ((select elitetrade_private.browser_verified())) with check ((select elitetrade_private.browser_verified()))',t.tablename);
  end loop;
end;
$migration$;
create policy verified_browser_profile_read on public.elitetrade_profiles
as restrictive for select to authenticated
using(id=(select auth.uid()) or (select elitetrade_private.browser_verified()));
create policy verified_browser_profile_update on public.elitetrade_profiles
as restrictive for update to authenticated
using((select elitetrade_private.browser_verified()))
with check((select elitetrade_private.browser_verified()));

-- Keep each original authorization implementation private and expose an
-- invoker wrapper that checks browser approval before calling it. Guest support
-- and service-only scanner endpoints retain their independent authentication.
do $migration$
declare f record; v_call text; v_body text;
begin
  for f in select p.oid,p.proname,p.pronargs,p.proretset,p.prorettype,
      pg_get_function_arguments(p.oid) args,pg_get_function_identity_arguments(p.oid) identity_args,
      pg_get_function_result(p.oid) result
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'elitetrade_admin_get_account_secret','elitetrade_admin_review_payout','elitetrade_admin_set_access',
      'elitetrade_admin_set_settings','elitetrade_admin_update_account','elitetrade_audit',
      'elitetrade_create_account','elitetrade_crypto_invoice','elitetrade_crypto_save_key',
      'elitetrade_ebook_download','elitetrade_ebook_submit_payment','elitetrade_engine_control',
      'elitetrade_engine_forget_account','elitetrade_engine_lease','elitetrade_engine_reserve',
      'elitetrade_pool_summary','elitetrade_request_payout','elitetrade_review_payment',
      'elitetrade_set_bot_status','elitetrade_submit_payment'
    ])
  loop
    select coalesce(string_agg('$'||i,',' order by i),'') into v_call from generate_series(1,f.pronargs) i;
    execute format('alter function public.%I(%s) set schema elitetrade_private',f.proname,f.identity_args);
    execute format('revoke all on function elitetrade_private.%I(%s) from public,anon',f.proname,f.identity_args);
    execute format('grant execute on function elitetrade_private.%I(%s) to authenticated,service_role',f.proname,f.identity_args);
    v_body:='begin perform elitetrade_private.require_browser(); ';
    if f.proretset then v_body:=v_body||format('return query select * from elitetrade_private.%I(%s); ',f.proname,v_call);
    elsif f.prorettype='void'::regtype then v_body:=v_body||format('perform elitetrade_private.%I(%s); return; ',f.proname,v_call);
    else v_body:=v_body||format('return elitetrade_private.%I(%s); ',f.proname,v_call); end if;
    v_body:=v_body||'end;';
    execute format('create function public.%I(%s) returns %s language plpgsql security invoker set search_path='''' as %L',f.proname,f.args,f.result,v_body);
    execute format('revoke all on function public.%I(%s) from public,anon',f.proname,f.identity_args);
    execute format('grant execute on function public.%I(%s) to authenticated,service_role',f.proname,f.identity_args);
  end loop;
end;
$migration$;
notify pgrst,'reload schema';
