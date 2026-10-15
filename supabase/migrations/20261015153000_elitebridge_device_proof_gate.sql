-- Phase 7: explicit device-private-key possession proof BEFORE approval.
-- Safe additive migration; no MT5 broker accounts, orders or MetaApi bindings changed.
begin;
alter table public.elitetrade_bridge_terminals
  add column if not exists proof_nonce text,
  add column if not exists proof_expires_at timestamptz,
  add column if not exists proof_verified_at timestamptz;

alter table public.elitetrade_bridge_terminals
  add constraint elitetrade_bridge_proof_nonce_format
  check (proof_nonce is null or (proof_nonce ~ '^[a-f0-9]{64}$' and proof_expires_at is not null));

-- Deny approval even to accidentally buggy privileged API writes. This
-- check is NOT VALID to avoid blocking migration on legacy approved records;
-- PostgreSQL enforces it for all new/updated rows, while the explicit
-- service-layer filter denies replay and approval before proof.
alter table public.elitetrade_bridge_terminals
  add constraint elitetrade_bridge_approved_requires_proof
  check (status <> 'approved' or proof_verified_at is not null) not valid;

-- Never expose private registry fields or challenge values through Data API.
revoke all on public.elitetrade_bridge_terminals from anon, authenticated;
grant select, insert, update, delete on public.elitetrade_bridge_terminals to service_role;
commit;
