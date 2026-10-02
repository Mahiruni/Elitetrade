-- Integration assertions use synthetic users and proofs inside a ROLLBACK.
-- This cannot be used to activate a real subscription or register a transfer.
begin;
create temporary table crypto_test_ids(user_id uuid,referrer_id uuid,invoice_id uuid,payment_id uuid,lease_id uuid);
insert into crypto_test_ids(user_id,referrer_id) values(gen_random_uuid(),gen_random_uuid());
insert into auth.users(id,email,raw_user_meta_data)
select user_id,'usdt-test-'||user_id||'@example.test','{"full_name":"USDT verification fixture"}'::jsonb from crypto_test_ids
union all
select referrer_id,'usdt-referrer-'||referrer_id||'@example.test','{"full_name":"USDT referrer fixture"}'::jsonb from crypto_test_ids;
update public.elitetrade_profiles set referrer_id=(select referrer_id from crypto_test_ids) where id=(select user_id from crypto_test_ids);
update public.elitetrade_crypto_health set provider_ok=true,updated_at=now(),lease_until=null,lease_id=null where id=true;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from crypto_test_ids),'role','authenticated','aal','aal1')::text,true);
grant select,update on crypto_test_ids to authenticated,service_role;
set local role authenticated;
update crypto_test_ids set invoice_id=(public.elitetrade_crypto_invoice((select id from public.elitetrade_payment_methods where details='TYubnUkFUzoh2exZHzUA9ScLtihhC1bxeB' and network='TRC20' and enabled limit 1))->>'id')::uuid;
do $$declare v_again uuid;begin
 select (public.elitetrade_crypto_invoice((select method_id from public.elitetrade_crypto_invoices where id=(select invoice_id from crypto_test_ids)))->>'id')::uuid into v_again;
 if v_again<>(select invoice_id from crypto_test_ids) then raise exception 'duplicate invoice creation';end if;
 if (select count(*) from public.elitetrade_crypto_invoices)<>1 then raise exception 'invoice ownership check failed';end if;
 if has_function_privilege('authenticated','public.elitetrade_crypto_complete(uuid,text,bigint,bigint,bigint)','execute') then raise exception 'customer can activate invoice';end if;
 if has_table_privilege('authenticated','public.elitetrade_crypto_invoices','update') then raise exception 'customer can modify payment status';end if;
 if has_function_privilege('authenticated','public.elitetrade_crypto_provider_key()','execute') then raise exception 'provider key exposed';end if;
end;$$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select referrer_id from crypto_test_ids),'role','authenticated','aal','aal1')::text,true);
set local role authenticated;
do $$begin
 if exists(select 1 from public.elitetrade_crypto_invoices where id=(select invoice_id from crypto_test_ids)) then raise exception 'another customer can read invoice';end if;
 begin
  perform public.elitetrade_crypto_save_key('synthetic-key-123456789');
  raise exception 'non-admin saved provider key';
 exception when others then
  if sqlerrm not like '%administrator access required%' then raise;end if;
 end;
 begin
  perform public.elitetrade_submit_payment((select id from public.elitetrade_payment_methods where network='TRC20' limit 1),'trc20:'||repeat('a',64));
  raise exception 'manual reference reserved verified namespace';
 exception when check_violation then null;
 end;
end;$$;
reset role;
set local role service_role;
update crypto_test_ids set lease_id=public.elitetrade_crypto_claim_scan();
do $$begin
 if (select lease_id from crypto_test_ids) is null then raise exception 'scan lease not acquired';end if;
 if public.elitetrade_crypto_claim_scan() is not null then raise exception 'overlapping scan allowed';end if;
 perform public.elitetrade_crypto_finish_scan(gen_random_uuid(),false,'Foreign lease');
 if (select lease_id from public.elitetrade_crypto_health where id=true)<>(select lease_id from crypto_test_ids) then raise exception 'foreign lease released active scan';end if;
end;$$;
do $$declare v public.elitetrade_crypto_invoices%rowtype;v_payment uuid;begin
 select * into v from public.elitetrade_crypto_invoices where id=(select invoice_id from crypto_test_ids);
 begin
  perform public.elitetrade_crypto_complete(v.id,repeat('a',64),v.amount_units-1,123,v.created_at+1000);
  raise exception 'underpayment activated invoice';
 exception when others then if sqlerrm<>'invalid verified payment' then raise;end if;end;
 begin
  perform public.elitetrade_crypto_complete(v.id,repeat('a',64),null,123,v.created_at+1000);
  raise exception 'missing amount activated invoice';
 exception when others then if sqlerrm<>'invalid verified payment' then raise;end if;end;
 begin
  perform public.elitetrade_crypto_complete(v.id,repeat('a',64),v.amount_units,123,v.expires_at+1);
  raise exception 'late transfer activated invoice';
 exception when others then if sqlerrm<>'invalid verified payment' then raise;end if;end;
 v_payment:=public.elitetrade_crypto_complete(v.id,repeat('a',64),v.amount_units,123,v.created_at+1000);
 if v_payment<>public.elitetrade_crypto_complete(v.id,repeat('a',64),v.amount_units,123,v.created_at+1000) then raise exception 'repeat created another payment';end if;
 update crypto_test_ids set payment_id=v_payment;
 if not (select active from public.elitetrade_profiles where id=v.user_id) then raise exception 'confirmed invoice did not activate subscription';end if;
 if (select status from public.elitetrade_crypto_invoices where id=v.id)<>'paid' then raise exception 'invoice not marked paid';end if;
 if (select count(*) from public.elitetrade_payments where user_id=v.user_id and status='approved')<>1 then raise exception 'payment count incorrect';end if;
 if (select count(*) from public.elitetrade_commissions where payment_id=v_payment)<>1 then raise exception 'referral commission duplicated or missing';end if;
end;$$;
-- A second invoice cannot reuse the same transaction.
insert into public.elitetrade_crypto_invoices(user_id,method_id,destination,price_cents,amount_units,created_at,expires_at)
select referrer_id,i.method_id,i.destination,i.price_cents,i.amount_units+1,i.created_at,i.expires_at from crypto_test_ids t join public.elitetrade_crypto_invoices i on i.id=t.invoice_id;
do $$declare v public.elitetrade_crypto_invoices%rowtype;begin
 select * into v from public.elitetrade_crypto_invoices where user_id=(select referrer_id from crypto_test_ids);
 begin
  perform public.elitetrade_crypto_complete(v.id,repeat('a',64),v.amount_units,123,v.created_at+1000);
  raise exception 'transaction reused';
 exception when others then if sqlerrm<>'transaction already used' then raise;end if;end;
 perform public.elitetrade_crypto_finish_scan((select lease_id from crypto_test_ids),true,'Test complete.');
end;$$;
reset role;
select 'PASS: ownership, permissions, exact amount, deadline, replay, activation, referral and lease checks; all test writes rolled back.' as verification;
rollback;
