-- Experimental S15 strategy: schema option only; does not arm or execute bots.
-- Existing DEMO authorization, MFA, leases, and risk protections are unchanged.
begin;
do $guard$
begin
  if to_regprocedure('elitetrade_private.engine_control(uuid,boolean)') is null then
    raise exception 'DEMO bot control must exist before S15 migration';
  end if;
  if strpos(pg_get_functiondef('elitetrade_private.engine_control(uuid,boolean)'::regprocedure),
            'metaapi-existing:')=0 then
    raise exception 'Existing imported MetaApi authorization guard missing';
  end if;
end;
$guard$;
alter table public.elitetrade_bots
  drop constraint if exists elitetrade_bots_strategy_check;
alter table public.elitetrade_bots
  add constraint elitetrade_bots_strategy_check
  check(strategy in ('trend','scalping','scalping-m1','scalping-s15','breakout'));
commit;
