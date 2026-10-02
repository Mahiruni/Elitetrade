-- USDT TRC20 invoices and verified activation. No customer can mark an invoice paid.
create table if not exists public.elitetrade_crypto_invoices (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.elitetrade_profiles(id),
 method_id uuid not null references public.elitetrade_payment_methods(id),
 destination text not null,
 price_cents bigint not null check(price_cents>0),
 amount_units bigint not null check(amount_units>0),
 created_at bigint not null,
 expires_at bigint not null,
 status text not null default 'pending' check(status in ('pending','paid','expired')),
 txid text unique check(txid is null or txid ~ '^[a-f0-9]{64}$'),
 payment_id uuid unique references public.elitetrade_payments(id),
 last_checked_at timestamptz,
 check(expires_at>created_at)
);
create index if not exists elitetrade_crypto_owner_idx on public.elitetrade_crypto_invoices(user_id,created_at desc);
create index if not exists elitetrade_crypto_method_idx on public.elitetrade_crypto_invoices(method_id);
create unique index if not exists elitetrade_crypto_amount_unique on public.elitetrade_crypto_invoices(destination,amount_units);
create index if not exists elitetrade_crypto_scan_idx on public.elitetrade_crypto_invoices(last_checked_at) where status='pending';
create table if not exists public.elitetrade_crypto_health (
 id boolean primary key default true check(id),
 updated_at timestamptz,
 provider_ok boolean not null default false,
 message text not null default 'Payment verification is starting.',
 lease_until timestamptz,
 lease_id uuid
);
insert into public.elitetrade_crypto_health(id) values(true) on conflict do nothing;
alter table public.elitetrade_crypto_invoices enable row level security;
alter table public.elitetrade_crypto_health enable row level security;
revoke all on public.elitetrade_crypto_invoices,public.elitetrade_crypto_health from anon,authenticated;
grant select on public.elitetrade_crypto_invoices,public.elitetrade_crypto_health to authenticated;
grant all on public.elitetrade_crypto_invoices,public.elitetrade_crypto_health to service_role;
drop policy if exists crypto_own_read on public.elitetrade_crypto_invoices;
create policy crypto_own_read on public.elitetrade_crypto_invoices for select to authenticated using(user_id=(select auth.uid()) or elitetrade_private.is_admin());
drop policy if exists crypto_health_read on public.elitetrade_crypto_health;
create policy crypto_health_read on public.elitetrade_crypto_health for select to authenticated using(true);
drop policy if exists crypto_service on public.elitetrade_crypto_invoices;
create policy crypto_service on public.elitetrade_crypto_invoices to service_role using(true) with check(true);
drop policy if exists crypto_health_service on public.elitetrade_crypto_health;
create policy crypto_health_service on public.elitetrade_crypto_health to service_role using(true) with check(true);

insert into public.elitetrade_payment_methods(name,kind,details,network,instructions,enabled)
select 'USDT · TRC20','crypto','TYubnUkFUzoh2exZHzUA9ScLtihhC1bxeB','TRC20','Send only USDT on the TRON (TRC20) network. For automatic activation, create an invoice and send its exact amount. Transfer fees are separate. Payments without an invoice require administrator verification.',true
where not exists(select 1 from public.elitetrade_payment_methods where kind='crypto' and network='TRC20' and details='TYubnUkFUzoh2exZHzUA9ScLtihhC1bxeB');

-- Manual references cannot reserve a publicly visible transaction before the verifier.
do $$begin
 if not exists(select 1 from pg_constraint where conname='elitetrade_verified_usdt_reference' and conrelid='public.elitetrade_payments'::regclass) then
  alter table public.elitetrade_payments add constraint elitetrade_verified_usdt_reference check(reference !~ '^trc20:' or method_snapshot ? 'crypto_invoice_id');
 end if;
end;$$;

create or replace function elitetrade_private.crypto_invoice(p_method_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user uuid:=(select auth.uid()); v_at bigint:=(extract(epoch from clock_timestamp())*1000)::bigint;
 v_method public.elitetrade_payment_methods%rowtype; v_invoice public.elitetrade_crypto_invoices%rowtype;
 v_price bigint; v_units bigint; v_attempt integer;
begin
 if v_user is null then raise exception 'sign in required'; end if;
 if exists(select 1 from auth.mfa_factors where user_id=v_user and status='verified') and coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'two-factor authentication required';end if;
 perform pg_advisory_xact_lock(hashtextextended('elitetrade-usdt-invoice',0));
 if not exists(select 1 from public.elitetrade_profiles where id=v_user and disabled=false and active=false) then raise exception 'subscription already active or account disabled';end if;
 if exists(select 1 from public.elitetrade_payments where user_id=v_user and kind='subscription' and status='pending') then raise exception 'subscription payment already awaiting review';end if;
 if not exists(select 1 from public.elitetrade_crypto_health where id=true and provider_ok and updated_at>now()-interval '5 minutes') then raise exception 'automatic payment verification unavailable; contact support';end if;
 select * into v_method from public.elitetrade_payment_methods where id=p_method_id and enabled and kind='crypto' and network='TRC20' and details='TYubnUkFUzoh2exZHzUA9ScLtihhC1bxeB';
 if not found then raise exception 'automatic payment method unavailable';end if;
 select * into v_invoice from public.elitetrade_crypto_invoices where user_id=v_user and status='pending' and expires_at>v_at order by created_at desc limit 1;
 if found then return to_jsonb(v_invoice);end if;
 if (select count(*) from public.elitetrade_crypto_invoices where user_id=v_user and created_at>v_at-86400000)>=5 then raise exception 'invoice limit reached; contact support';end if;
 select value::bigint into v_price from public.elitetrade_settings where key='price_cents';
 if v_price is null or v_price<100 or v_price>1000000000 then raise exception 'invalid subscription price';end if;
 for v_attempt in 1..100 loop
  v_units:=v_price*10000+1+((get_byte(extensions.gen_random_bytes(2),0)*256+get_byte(extensions.gen_random_bytes(2),1))%9999);
  exit when not exists(select 1 from public.elitetrade_crypto_invoices where destination=v_method.details and amount_units=v_units);
  if v_attempt=100 then raise exception 'invoice allocation unavailable; retry later';end if;
 end loop;
 insert into public.elitetrade_crypto_invoices(user_id,method_id,destination,price_cents,amount_units,created_at,expires_at)
 values(v_user,v_method.id,v_method.details,v_price,v_units,v_at,v_at+86400000) returning * into v_invoice;
 return to_jsonb(v_invoice);
end;$$;
revoke all on function elitetrade_private.crypto_invoice(uuid) from public,anon;
grant execute on function elitetrade_private.crypto_invoice(uuid) to authenticated;
create or replace function public.elitetrade_crypto_invoice(p_method_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select elitetrade_private.crypto_invoice(p_method_id);$$;
revoke all on function public.elitetrade_crypto_invoice(uuid) from public,anon;
grant execute on function public.elitetrade_crypto_invoice(uuid) to authenticated;

create or replace function public.elitetrade_crypto_complete(p_invoice_id uuid,p_txid text,p_amount_units bigint,p_block_number bigint,p_block_timestamp bigint)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_invoice public.elitetrade_crypto_invoices%rowtype; v_payment uuid; v_referrer uuid; v_commission integer; v_active boolean; v_manual_status text;
begin
 if current_user<>'service_role' then raise exception 'verified payment service required';end if;
 select * into v_invoice from public.elitetrade_crypto_invoices where id=p_invoice_id for update;
 if not found then raise exception 'invoice not found';end if;
 if v_invoice.status='paid' and v_invoice.txid=p_txid then return v_invoice.payment_id;end if;
 if v_invoice.status<>'pending' then raise exception 'invoice already reviewed';end if;
 if p_txid is null or p_amount_units is null or p_block_number is null or p_block_timestamp is null or p_txid!~'^[a-f0-9]{64}$' or p_amount_units<>v_invoice.amount_units or p_block_number<=0 or p_block_timestamp<v_invoice.created_at or p_block_timestamp>v_invoice.expires_at then raise exception 'invalid verified payment';end if;
 if exists(select 1 from public.elitetrade_crypto_invoices where txid=p_txid) then raise exception 'transaction already used';end if;
 -- Lock a matching manual submission before the profile, matching administrator review lock order.
 select id,status into v_payment,v_manual_status from public.elitetrade_payments
 where user_id=v_invoice.user_id and kind='subscription' and reference=p_txid and status in ('pending','approved')
 and method_snapshot->>'details'=v_invoice.destination and method_snapshot->>'network'='TRC20' for update;
 if v_manual_status='approved' then
  -- Preserve any administrator decision to revoke access after manual approval.
  update public.elitetrade_crypto_invoices set status='paid',txid=p_txid,payment_id=v_payment where id=v_invoice.id;
  return v_payment;
 end if;
 select active,referrer_id into v_active,v_referrer from public.elitetrade_profiles where id=v_invoice.user_id and disabled=false for update;
 if not found then raise exception 'account disabled';end if;
 if v_manual_status='pending' then
  update public.elitetrade_payments set method_id=v_invoice.method_id,reference='trc20:'||p_txid,amount_cents=v_invoice.price_cents,
  method_snapshot=(select to_jsonb(m) from public.elitetrade_payment_methods m where m.id=v_invoice.method_id)||jsonb_build_object('details',v_invoice.destination,'network','TRC20','crypto_invoice_id',v_invoice.id),
  status='approved',note='Confirmed USDT TRC20 transfer: '||p_amount_units::text||' micro-USDT; block '||p_block_number::text,reviewed_at=(extract(epoch from clock_timestamp())*1000)::bigint,reviewer_id=null where id=v_payment;
 else
 insert into public.elitetrade_payments(user_id,method_id,reference,amount_cents,kind,method_snapshot,status,note,reviewed_at)
 select v_invoice.user_id,m.id,'trc20:'||p_txid,v_invoice.price_cents,'subscription',to_jsonb(m)||jsonb_build_object('details',v_invoice.destination,'network','TRC20','crypto_invoice_id',v_invoice.id),'approved','Confirmed USDT TRC20 transfer: '||p_amount_units::text||' micro-USDT; block '||p_block_number::text,(extract(epoch from clock_timestamp())*1000)::bigint
 from public.elitetrade_payment_methods m where m.id=v_invoice.method_id returning id into v_payment;
 end if;
 update public.elitetrade_profiles set active=true,updated_at=now() where id=v_invoice.user_id;
 if not v_active and v_referrer is not null then
  select value::integer into v_commission from public.elitetrade_settings where key='commission_percent';
  insert into public.elitetrade_commissions(user_id,referred_id,payment_id,amount_cents) values(v_referrer,v_invoice.user_id,v_payment,floor(v_invoice.price_cents*coalesce(v_commission,0)/100.0)::bigint) on conflict(payment_id) do nothing;
 end if;
 update public.elitetrade_crypto_invoices set status='paid',txid=p_txid,payment_id=v_payment where id=v_invoice.id;
 return v_payment;
end;$$;
revoke all on function public.elitetrade_crypto_complete(uuid,text,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.elitetrade_crypto_complete(uuid,text,bigint,bigint,bigint) to service_role;

create or replace function public.elitetrade_crypto_claim_scan()
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_lease uuid:=gen_random_uuid();
begin
 if current_user<>'service_role' then raise exception 'payment service required';end if;
 update public.elitetrade_crypto_health set lease_id=v_lease,lease_until=now()+interval '3 minutes' where id=true and (lease_until is null or lease_until<now());
 if found then return v_lease;end if;return null;
end;$$;
create or replace function public.elitetrade_crypto_finish_scan(p_lease_id uuid,p_ok boolean,p_message text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'payment service required';end if;
 update public.elitetrade_crypto_health set updated_at=now(),provider_ok=p_ok,message=left(p_message,250),lease_until=null,lease_id=null where id=true and lease_id=p_lease_id;
 if not found then return;end if;
 update public.elitetrade_crypto_invoices set status='expired' where status='pending' and expires_at<(extract(epoch from clock_timestamp())*1000)::bigint-86400000;
end;$$;
revoke all on function public.elitetrade_crypto_claim_scan(),public.elitetrade_crypto_finish_scan(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.elitetrade_crypto_claim_scan(),public.elitetrade_crypto_finish_scan(uuid,boolean,text) to service_role;

-- Store scheduler authentication in Vault, never in Git or the browser.
do $$begin
 if not exists(select 1 from vault.secrets where name='elitetrade_crypto_scheduler') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'elitetrade_crypto_scheduler');
 end if;
end;$$;
create or replace function elitetrade_private.crypto_scheduler_valid(p_token text)
returns boolean language sql security definer set search_path='' as $$
 select length(p_token)=64 and exists(select 1 from vault.decrypted_secrets where name='elitetrade_crypto_scheduler' and decrypted_secret=p_token);
$$;
revoke all on function elitetrade_private.crypto_scheduler_valid(text) from public,anon,authenticated;
grant execute on function elitetrade_private.crypto_scheduler_valid(text) to service_role;
create or replace function public.elitetrade_crypto_scheduler_valid(p_token text)
returns boolean language sql security invoker set search_path='' as $$select elitetrade_private.crypto_scheduler_valid(p_token);$$;
revoke all on function public.elitetrade_crypto_scheduler_valid(text) from public,anon,authenticated;
grant execute on function public.elitetrade_crypto_scheduler_valid(text) to service_role;
grant usage on schema elitetrade_private to service_role;

create or replace function elitetrade_private.crypto_provider_key()
returns text language sql security definer set search_path='' as $$select decrypted_secret from vault.decrypted_secrets where name='elitetrade_trongrid_api_key' limit 1;$$;
revoke all on function elitetrade_private.crypto_provider_key() from public,anon,authenticated;
grant execute on function elitetrade_private.crypto_provider_key() to service_role;
create or replace function public.elitetrade_crypto_provider_key()
returns text language sql security invoker set search_path='' as $$select elitetrade_private.crypto_provider_key();$$;
revoke all on function public.elitetrade_crypto_provider_key() from public,anon,authenticated;
grant execute on function public.elitetrade_crypto_provider_key() to service_role;
create or replace function elitetrade_private.crypto_save_key(p_key text)
returns void language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if not elitetrade_private.is_admin() then raise exception 'administrator access required';end if;
 if exists(select 1 from auth.mfa_factors where user_id=(select auth.uid()) and status='verified') and coalesce(auth.jwt()->>'aal','')<>'aal2' then raise exception 'two-factor authentication required';end if;
 if p_key is null or p_key!~'^[a-zA-Z0-9._-]{16,256}$' then raise exception 'invalid TronGrid API key';end if;
 select id into v_id from vault.secrets where name='elitetrade_trongrid_api_key';
 if v_id is null then perform vault.create_secret(p_key,'elitetrade_trongrid_api_key');else perform vault.update_secret(v_id,p_key);end if;
 update public.elitetrade_crypto_health set provider_ok=false,message='TronGrid key saved. Waiting for verification check.' where id=true;
end;$$;
revoke all on function elitetrade_private.crypto_save_key(text) from public,anon;
grant execute on function elitetrade_private.crypto_save_key(text) to authenticated;
create or replace function public.elitetrade_crypto_save_key(p_key text)
returns void language sql security invoker set search_path='' as $$select elitetrade_private.crypto_save_key(p_key);$$;
revoke all on function public.elitetrade_crypto_save_key(text) from public,anon;
grant execute on function public.elitetrade_crypto_save_key(text) to authenticated;
