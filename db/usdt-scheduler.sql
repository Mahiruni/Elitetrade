-- Deploy supabase/functions/elitetrade-usdt before applying this schedule.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('elitetrade-usdt-confirmations','* * * * *',$job$
 select net.http_post(
  url:='https://cgpvhayfwnpipktyltho.supabase.co/functions/v1/elitetrade-usdt',
  headers:=jsonb_build_object('Content-Type','application/json','x-elitetrade-job',(select decrypted_secret from vault.decrypted_secrets where name='elitetrade_crypto_scheduler')),
  body:='{}'::jsonb,
  timeout_milliseconds:=125000
 );
$job$);
