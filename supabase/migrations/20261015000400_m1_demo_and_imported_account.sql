-- Add the M1 DEMO strategy without overwriting the already installed,
-- owner-protected engine_control() function. Existing production migrations
-- already allow imported MetaApi account bindings.
-- No bot config, enabled run, risk state or order is modified.
begin;
do $guard$
begin
 if to_regprocedure('elitetrade_private.engine_control(uuid,boolean)') is null then
   raise exception 'EliteTrade DEMO engine is not installed';
 end if;
 if strpos(pg_get_functiondef('elitetrade_private.engine_control(uuid,boolean)'::regprocedure),
           'metaapi-existing:')=0 then
   raise exception 'Apply the existing imported MetaApi account fix before M1';
 end if;
end;
$guard$;
alter table public.elitetrade_bots drop constraint if exists elitetrade_bots_strategy_check;
alter table public.elitetrade_bots add constraint elitetrade_bots_strategy_check
  check(strategy in ('trend','scalping','scalping-m1','breakout'));
commit;
