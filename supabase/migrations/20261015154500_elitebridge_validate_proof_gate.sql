-- All existing EliteBridge terminal records have been checked (none enrolled
-- at the time of Phase 7 rollout). Mark approval proof invariant validated.
-- Existing MetaApi accounts and trading engine remain untouched.
alter table public.elitetrade_bridge_terminals
  validate constraint elitetrade_bridge_approved_requires_proof;
