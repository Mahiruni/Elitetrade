-- Run via a database administrator connection. Every fixture and change rolls
-- back; no auth-provider email is sent and no customer data is changed.
begin;
select set_config('elite_test.user',gen_random_uuid()::text,true),
       set_config('elite_test.other',gen_random_uuid()::text,true),
       set_config('elite_test.session',gen_random_uuid()::text,true),
       set_config('elite_test.second_session',gen_random_uuid()::text,true);
update elitetrade_private.browser_auth_config set enforced=true where id;
insert into auth.users(id,email,encrypted_password,email_confirmed_at,created_at,updated_at,role,raw_user_meta_data)
select current_setting('elite_test.'||name)::uuid,'browser-test-'||current_setting('elite_test.'||name)||'@example.invalid',
  'fixture-password-fingerprint',now(),now()-interval '1 day',now(),'authenticated','{"full_name":"Rollback fixture"}'::jsonb
from unnest(array['user','other']) name;
update elitetrade_private.browser_credentials set changed_at=now()-interval '1 hour'
where user_id in (current_setting('elite_test.user')::uuid,current_setting('elite_test.other')::uuid);
insert into auth.sessions(id,user_id,created_at,updated_at)
values(current_setting('elite_test.session')::uuid,current_setting('elite_test.user')::uuid,now(),now()),
      (current_setting('elite_test.second_session')::uuid,current_setting('elite_test.user')::uuid,now(),now());
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('elite_test.user'),'role','authenticated','aal','aal1',
  'session_id',current_setting('elite_test.session'),'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint)),
  'user_metadata',jsonb_build_object('browser_verified',true,'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint))))::text,true);
select set_config('request.headers',jsonb_build_object('x-elite-device',repeat('A',43))::text,true);
set local role authenticated;
do $test$
declare status jsonb; count_rows integer; blocked boolean:=false;
begin
  status:=public.elitetrade_browser_status();
  if status <> '{"verified":false,"needsEmail":true}'::jsonb then raise exception 'Password or editable metadata bypassed verification: %',status; end if;
  if elitetrade_private.browser_verified() then raise exception 'Unverified password session passed guard'; end if;
  begin perform count(*) from elitetrade_private.trusted_browsers;
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'Authenticated user could read private trust data'; end if;
  select count(*) into count_rows from public.elitetrade_payment_methods;
  if count_rows<>0 then raise exception 'Unverified browser could read protected rows'; end if;
  blocked:=false;
  begin perform public.elitetrade_pool_summary();
  exception when insufficient_privilege then
    if sqlerrm not like 'Verify this browser%' then raise; end if;blocked:=true;
  end;
  if not blocked then raise exception 'Definer-backed RPC bypassed guard'; end if;
  blocked:=false;
  begin perform public.elitetrade_ebook_download();
  exception when insufficient_privilege then
    if sqlerrm not like 'Verify this browser%' then raise; end if;blocked:=true;
  end;
  if not blocked then raise exception 'Ebook RPC bypassed guard'; end if;
end;
$test$;
reset role;

-- A recent signed email proof remembers this browser and approves this session.
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',
  jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
set local role authenticated;
do $test$
declare status jsonb;
begin
  status:=public.elitetrade_browser_status();
  if not (status->>'verified')::boolean or (status->>'needsEmail')::boolean then raise exception 'Fresh proof did not approve browser'; end if;
  if not elitetrade_private.browser_verified() then raise exception 'Approved session failed guard'; end if;
  perform public.elitetrade_pool_summary();
  if not exists(select 1 from public.elitetrade_profiles where id=auth.uid()) then raise exception 'Own profile inaccessible'; end if;
end;
$test$;
reset role;

-- A different password session is admitted only with the remembered secret.
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('elite_test.user'),'role','authenticated','aal','aal1',
 'session_id',current_setting('elite_test.second_session'),'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
set local role authenticated;
do $test$
begin
  if elitetrade_private.browser_verified() then raise exception 'Unapproved new session passed guard'; end if;
  if not (public.elitetrade_browser_status()->>'verified')::boolean then raise exception 'Remembered password browser asked for email again'; end if;
  if not elitetrade_private.browser_verified() then raise exception 'Remembered session failed guard'; end if;
end;
$test$;
reset role;
select set_config('request.headers',jsonb_build_object('x-elite-device',repeat('B',43))::text,true);
set local role authenticated;
do $test$
begin
 if elitetrade_private.browser_verified() then raise exception 'A different browser inherited a session approval'; end if;
 if not (public.elitetrade_browser_status()->>'needsEmail')::boolean then raise exception 'A different browser skipped email'; end if;
end;
$test$;
reset role;

-- Stale email evidence, unconfirmed accounts, absent sessions, and MFA cannot bypass.
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',
 jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now()-interval '20 minutes')::bigint)))::text,true);
set local role authenticated;
do $test$
begin
 if not (public.elitetrade_browser_status()->>'needsEmail')::boolean then raise exception 'Expired proof admitted an unfamiliar browser'; end if;
end;
$test$;
reset role;
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',
 jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
insert into auth.mfa_factors(id,user_id,factor_type,status,created_at,updated_at,friendly_name)
values(gen_random_uuid(),current_setting('elite_test.user')::uuid,'totp','verified',now(),now(),'Rollback MFA');
set local role authenticated;
do $test$
begin
 if public.elitetrade_browser_status()<>'{"verified":false,"needsEmail":false}'::jsonb then raise exception 'Email proof bypassed MFA'; end if;
 if elitetrade_private.browser_verified() then raise exception 'aal1 passed MFA guard'; end if;
end;
$test$;
reset role;
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{aal}','"aal2"')::text,true);
set local role authenticated;
do $test$
begin
 if not (public.elitetrade_browser_status()->>'verified')::boolean then raise exception 'aal2 with email proof did not approve browser'; end if;
 if not elitetrade_private.browser_verified() then raise exception 'aal2 approval failed guard'; end if;
end;
$test$;
reset role;

-- Credential changes immediately revoke remembered browsers and session approvals.
update auth.users set encrypted_password='new-fixture-fingerprint' where id=current_setting('elite_test.user')::uuid;
do $test$
begin
 if exists(select 1 from elitetrade_private.trusted_browsers where user_id=current_setting('elite_test.user')::uuid)
 or exists(select 1 from elitetrade_private.browser_sessions where user_id=current_setting('elite_test.user')::uuid) then
  raise exception 'Password change retained browser approval';
 end if;
end;
$test$;
update elitetrade_private.browser_credentials set changed_at=clock_timestamp()+interval '2 seconds' where user_id=current_setting('elite_test.user')::uuid;
set local role authenticated;
do $test$
declare blocked boolean:=false;
begin
 if elitetrade_private.browser_verified() then raise exception 'Old session passed after credential revision'; end if;
 begin perform public.elitetrade_browser_status();
 exception when insufficient_privilege then if sqlerrm not like '%session has expired%' then raise; end if;blocked:=true;end;
 if not blocked then raise exception 'Old session could reapprove after password change'; end if;
end;
$test$;
reset role;

-- Renew the fixture session; email change and expiry must revoke it too.
update elitetrade_private.browser_credentials set changed_at=now()-interval '1 minute' where user_id=current_setting('elite_test.user')::uuid;
set local role authenticated;
do $test$ begin
 if not (public.elitetrade_browser_status()->>'verified')::boolean then raise exception 'Renewed fixture did not verify'; end if;
end; $test$;
reset role;
update elitetrade_private.trusted_browsers set expires_at=now()-interval '1 minute' where user_id=current_setting('elite_test.user')::uuid;
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',
 jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
set local role authenticated;
do $test$ begin
 if elitetrade_private.browser_verified() then raise exception 'Expired browser passed guard'; end if;
 if not (public.elitetrade_browser_status()->>'needsEmail')::boolean then raise exception 'Expired browser skipped email'; end if;
end; $test$;
reset role;
update auth.users set email='changed-'||id||'@example.invalid' where id=current_setting('elite_test.user')::uuid;
do $test$ begin
 if exists(select 1 from elitetrade_private.trusted_browsers where user_id=current_setting('elite_test.user')::uuid) then raise exception 'Email change retained browser approval'; end if;
end; $test$;

-- Restore a proof for one user, then attempt to use that secret as another user.
update elitetrade_private.browser_credentials set changed_at=now()-interval '1 minute' where user_id=current_setting('elite_test.user')::uuid;
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',
 jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
set local role authenticated;
select public.elitetrade_browser_status();
reset role;
insert into auth.sessions(id,user_id,created_at,updated_at) values(gen_random_uuid(),current_setting('elite_test.other')::uuid,now(),now())
returning set_config('elite_test.other_session',id::text,true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('elite_test.other'),'role','authenticated','aal','aal1',
 'session_id',current_setting('elite_test.other_session'),'amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now())::bigint)))::text,true);
set local role authenticated;
do $test$ begin
 if elitetrade_private.browser_verified() then raise exception 'Other user inherited trust'; end if;
 if not (public.elitetrade_browser_status()->>'needsEmail')::boolean then raise exception 'Other user reused remembered secret'; end if;
end; $test$;
reset role;
delete from auth.sessions where id=current_setting('elite_test.other_session')::uuid;
set local role authenticated;
do $test$
declare blocked boolean:=false;
begin
 begin perform public.elitetrade_browser_status();exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'Revoked session could verify browser'; end if;
end;
$test$;
reset role;
rollback;
select 'Passed: trust, RLS, RPC guards, metadata isolation, MFA, expiry, credential revocation, and session revocation; all fixtures rolled back.' as verification;
