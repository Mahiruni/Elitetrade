-- Disposable GitHub CI ONLY. Mimics the minimum Supabase roles and owner tables.
-- This must never be run on the real EliteTrade Supabase project.
begin;
create role service_role nologin bypassrls;
create role authenticated nologin;
create role anon nologin;
create schema if not exists elitetrade_private;
create table public.elitetrade_profiles (
  id uuid primary key,
  role text not null check (role in ('user','admin')),
  disabled boolean not null default false
);
create table public.elitetrade_accounts (
  id uuid primary key,
  user_id uuid not null references public.elitetrade_profiles(id)
);
grant usage on schema public to service_role,authenticated,anon;
grant select on public.elitetrade_profiles,public.elitetrade_accounts to service_role;
commit;
