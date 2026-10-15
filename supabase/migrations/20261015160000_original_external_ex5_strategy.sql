-- Register original, unchanged user-supplied EX5 as external MT5 strategy.
-- This is metadata only: no file is stored in Git, no EA is started by MetaApi.
-- Enforce engine guard even against direct authenticated RPC invocation.
begin;

do $guard$
begin
  if to_regclass('public.elitetrade_bots') is null
     or to_regclass('public.elitetrade_engine_runs') is null then
    raise exception 'Required EliteTrade bot and demo engine tables are missing';
  end if;
end
$guard$;

alter table public.elitetrade_bots
  drop constraint if exists elitetrade_bots_strategy_check;
alter table public.elitetrade_bots
  add constraint elitetrade_bots_strategy_check
  check (strategy in ('trend','scalping','scalping-m1','scalping-s15','breakout','scalpin-ss-ex5'));

create or replace function elitetrade_private.block_external_ex5_web_engine()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.enabled and exists (
    select 1 from public.elitetrade_bots b
    where b.id=new.bot_id and b.strategy='scalpin-ss-ex5'
  ) then
    raise exception 'External EX5 requires a verified Windows MT5 terminal. Web/demo engine execution is unavailable.';
  end if;
  return new;
end;$$;

drop trigger if exists elitetrade_reject_original_ex5_engine_start on public.elitetrade_engine_runs;
create trigger elitetrade_reject_original_ex5_engine_start
before insert or update of enabled on public.elitetrade_engine_runs
for each row execute function elitetrade_private.block_external_ex5_web_engine();

create or replace function elitetrade_private.block_external_ex5_running_bot()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.strategy='scalpin-ss-ex5' and new.status='running' then
    raise exception 'Original EX5 may be configured but cannot be marked running without native MT5 verification.';
  end if;
  return new;
end;$$;

drop trigger if exists elitetrade_reject_original_ex5_running_bot on public.elitetrade_bots;
create trigger elitetrade_reject_original_ex5_running_bot
before insert or update of strategy,status on public.elitetrade_bots
for each row execute function elitetrade_private.block_external_ex5_running_bot();
commit;
