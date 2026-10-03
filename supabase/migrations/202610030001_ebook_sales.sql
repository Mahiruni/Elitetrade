-- The paid PDF is uploaded separately into the private table. Never commit it
-- or its base64 contents to this public repository.
create table elitetrade_private.ebook_assets (
  product_id text primary key check (product_id = 'elitebot-strategy-rulebook'),
  pdf_base64 text not null check (length(pdf_base64) > 100),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  file_name text not null default 'EliteBot_Strategy_Rulebook.pdf',
  page_count integer not null default 8 check (page_count > 0),
  updated_at timestamptz not null default now()
);
alter table elitetrade_private.ebook_assets enable row level security;
revoke all on elitetrade_private.ebook_assets from public, anon, authenticated;

alter table public.elitetrade_payments add column product_id text;
alter table public.elitetrade_payments drop constraint elitetrade_payments_kind_check;
alter table public.elitetrade_payments add constraint elitetrade_payments_kind_check
  check (kind in ('subscription', 'pool', 'ebook'));
alter table public.elitetrade_payments drop constraint elitetrade_payments_check;
alter table public.elitetrade_payments add constraint elitetrade_payments_check
  check ((kind = 'pool' and round_id is not null) or
         (kind in ('subscription', 'ebook') and round_id is null));
alter table public.elitetrade_payments add constraint elitetrade_ebook_product_check
  check ((kind = 'ebook' and product_id is not null and
          product_id = 'elitebot-strategy-rulebook' and amount_cents = 5000) or
         (kind <> 'ebook' and product_id is null));
create unique index elitetrade_ebook_purchase_once
  on public.elitetrade_payments (user_id, product_id)
  where kind = 'ebook' and status in ('pending', 'approved');
-- A blockchain transaction cannot fund both a manual ebook purchase and an
-- automatically confirmed membership invoice under different reference formats.
create unique index elitetrade_unique_transaction_hash
  on public.elitetrade_payments ((regexp_replace(lower(reference), '^trc20:', '')))
  where reference ~* '^(trc20:)?[0-9a-f]{64}$';

create function elitetrade_private.ebook_user() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in to continue.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.elitetrade_profiles where id = v_user and not disabled) then
    raise exception 'This account is unavailable.' using errcode = '42501';
  end if;
  if exists (select 1 from auth.mfa_factors where user_id = v_user and status = 'verified')
     and coalesce(auth.jwt()->>'aal', '') <> 'aal2' then
    raise exception 'Complete two-factor authentication to continue.' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

create function elitetrade_private.ebook_submit_payment(p_method_id uuid, p_reference text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := elitetrade_private.ebook_user();
  v_method public.elitetrade_payment_methods%rowtype;
  v_reference text := regexp_replace(lower(trim(p_reference)), '\s', '', 'g');
  v_payment uuid := pg_catalog.gen_random_uuid();
begin
  if p_reference is null or length(trim(p_reference)) not between 6 and 200
     or length(v_reference) < 6 or v_reference ~ '^trc20:' then
    raise exception 'Invalid transaction reference.';
  end if;
  if not exists (select 1 from elitetrade_private.ebook_assets
                 where product_id = 'elitebot-strategy-rulebook') then
    raise exception 'The ebook is unavailable. Contact support before paying.';
  end if;
  select * into v_method from public.elitetrade_payment_methods
    where id = p_method_id and enabled;
  if not found then raise exception 'Choose an available payment method.'; end if;
  if v_method.kind = 'crypto' and (v_method.network is distinct from 'TRC20' or v_method.details is distinct from 'TYubnUkFUzoh2exZHzUA9ScLtihhC1bxeB') then
    raise exception 'Choose an available ebook payment method.';
  end if;
  if exists (select 1 from public.elitetrade_payments where user_id = v_user
             and kind = 'ebook' and status in ('pending', 'approved')) then
    raise exception 'Your ebook purchase is already approved or awaiting review.';
  end if;
  if exists (select 1 from public.elitetrade_payments
             where regexp_replace(lower(reference), '^trc20:', '') = v_reference) then
    raise exception 'This transaction reference has already been submitted.';
  end if;
  insert into public.elitetrade_payments
    (id, user_id, method_id, reference, amount_cents, kind, round_id, product_id, method_snapshot)
    values (v_payment, v_user, v_method.id, v_reference, 5000, 'ebook', null,
            'elitebot-strategy-rulebook', to_jsonb(v_method));
  return v_payment;
end;
$$;

create function elitetrade_private.ebook_download() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := elitetrade_private.ebook_user(); v_asset jsonb;
begin
  if not exists (select 1 from public.elitetrade_payments where user_id = v_user
                 and kind = 'ebook' and product_id = 'elitebot-strategy-rulebook'
                 and amount_cents = 5000 and status = 'approved') then
    raise exception 'An approved ebook purchase is required.' using errcode = '42501';
  end if;
  select jsonb_build_object('pdf_base64', pdf_base64, 'sha256', sha256)
    into v_asset from elitetrade_private.ebook_assets
    where product_id = 'elitebot-strategy-rulebook';
  if v_asset is null then raise exception 'The ebook file is unavailable. Contact support.'; end if;
  return v_asset;
end;
$$;

create function public.elitetrade_ebook_submit_payment(p_method_id uuid, p_reference text)
returns uuid language sql security invoker set search_path = '' as $$
  select elitetrade_private.ebook_submit_payment(p_method_id, p_reference);
$$;
create function public.elitetrade_ebook_download() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select elitetrade_private.ebook_download();
$$;
revoke all on function elitetrade_private.ebook_user() from public, anon;
revoke all on function elitetrade_private.ebook_submit_payment(uuid, text) from public, anon;
revoke all on function elitetrade_private.ebook_download() from public, anon;
revoke all on function public.elitetrade_ebook_submit_payment(uuid, text) from public, anon;
revoke all on function public.elitetrade_ebook_download() from public, anon;
grant usage on schema elitetrade_private to authenticated;
grant execute on function elitetrade_private.ebook_user() to authenticated;
grant execute on function elitetrade_private.ebook_submit_payment(uuid, text) to authenticated;
grant execute on function elitetrade_private.ebook_download() to authenticated;
grant execute on function public.elitetrade_ebook_submit_payment(uuid, text) to authenticated;
grant execute on function public.elitetrade_ebook_download() to authenticated;
