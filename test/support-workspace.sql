-- Every fixture rolls back. No emails, broker requests, or production conversations.
begin;
-- Simulate final deployed permissions without changing the compatibility rollout state.
revoke insert,update,delete on public.elitetrade_messages from authenticated;
revoke insert,update,delete on public.elitetrade_conversations from authenticated;
select set_config('support_test.customer',gen_random_uuid()::text,true),set_config('support_test.other',gen_random_uuid()::text,true),set_config('support_test.admin',gen_random_uuid()::text,true),set_config('support_test.session',gen_random_uuid()::text,true),set_config('support_test.other_session',gen_random_uuid()::text,true),set_config('support_test.admin_session',gen_random_uuid()::text,true);
insert into auth.users(id,email,encrypted_password,email_confirmed_at,created_at,updated_at,role,raw_user_meta_data)
select current_setting('support_test.'||name)::uuid,'support-rollback-'||current_setting('support_test.'||name)||'@example.invalid','fixture-password',now(),now()-interval '1 day',now(),'authenticated','{"full_name":"Support rollback fixture"}'::jsonb from unnest(array['customer','other','admin']) name;
update elitetrade_private.browser_credentials set changed_at=now()-interval '1 hour' where user_id in(current_setting('support_test.customer')::uuid,current_setting('support_test.other')::uuid,current_setting('support_test.admin')::uuid);
update public.elitetrade_profiles set role='admin' where id=current_setting('support_test.admin')::uuid;
insert into auth.sessions(id,user_id,created_at,updated_at) values(current_setting('support_test.session')::uuid,current_setting('support_test.customer')::uuid,now(),now()),(current_setting('support_test.other_session')::uuid,current_setting('support_test.other')::uuid,now(),now()),(current_setting('support_test.admin_session')::uuid,current_setting('support_test.admin')::uuid,now(),now());
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('support_test.customer'),'role','authenticated','aal','aal1','session_id',current_setting('support_test.session'),'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
select set_config('request.headers',jsonb_build_object('x-elite-device',repeat('A',43))::text,true);
set local role authenticated;
select public.elitetrade_browser_status();
do $$ declare r jsonb; cid uuid; mid uuid:=gen_random_uuid();blocked boolean:=false;begin
 r:=public.elitetrade_support('create',null,'{"category":"MT5 connection"}');cid:=(r->>'id')::uuid;perform set_config('support_test.chat',cid::text,true);
 r:=public.elitetrade_support('send',cid,jsonb_build_object('message',repeat('x',20000),'clientId',mid,'attachments','[]'::jsonb));if r->'message' is null then raise exception '20k send failed: %',r;end if;
 r:=public.elitetrade_support('send',cid,jsonb_build_object('message',repeat('x',20000),'clientId',mid,'attachments','[]'::jsonb));if not (r->>'duplicate')::boolean then raise exception 'Dedup failed';end if;
 r:=public.elitetrade_support('send',cid,jsonb_build_object('message','ｆｕｃｋ','clientId',gen_random_uuid(),'attachments','[]'::jsonb));if r->>'status'<>'422' then raise exception 'Moderation failed: %',r;end if;
 r:=public.elitetrade_support('send',cid,jsonb_build_object('message','Scunthorpe asset classes, broker slippage. This bot is awful!','clientId',gen_random_uuid(),'attachments','[]'::jsonb));if r->'message' is null then raise exception 'False-positive filter: %',r;end if;
 r:=public.elitetrade_support('history',cid);if jsonb_array_length(r->'messages')<>2 then raise exception 'History failed: %',r;end if;
 r:=public.elitetrade_support('list');if jsonb_array_length(r->'conversations')<>1 then raise exception 'List isolation failed';end if;
 begin perform public.elitetrade_support('update',cid,jsonb_build_object('assigned_to',current_setting('support_test.admin')));exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception 'Customer assignment bypass';end if;
 blocked:=false;begin insert into public.elitetrade_messages(conversation_id,sender,body) values(cid,'admin','Forbidden direct write');exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception 'Direct write bypass';end if;
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('support_test.admin'),'role','authenticated','aal','aal1','session_id',current_setting('support_test.admin_session'),'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
select set_config('request.headers',jsonb_build_object('x-elite-device',repeat('B',43))::text,true);
set local role authenticated;select public.elitetrade_browser_status();
do $$ declare cid uuid:=current_setting('support_test.chat')::uuid; r jsonb;cursor bigint;begin
 r:=public.elitetrade_support('history',cid);if jsonb_array_length(r->'messages')<>2 then raise exception 'Admin history failed: %',r;end if;cursor:=(r->'messages'->1->>'support_seq')::bigint;
 r:=public.elitetrade_support('update',cid,jsonb_build_object('assigned_to',auth.uid(),'priority','High','stage','waiting'));if r->>'ok'<>'true' then raise exception 'Assignment failed';end if;
 perform public.elitetrade_support('heartbeat',cid,jsonb_build_object('tabId',gen_random_uuid(),'active',true,'typing',true));
 perform public.elitetrade_support('note',cid,'{"message":"PRIVATE ROLLBACK NOTE"}');
 perform public.elitetrade_support('read',cid,jsonb_build_object('cursor',cursor));
 r:=public.elitetrade_support('history',cid);if r->'notes'->0->>'body'<>'PRIVATE ROLLBACK NOTE' then raise exception 'Notes missing';end if;
 perform public.elitetrade_support('update',cid,'{"stage":"resolved"}');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('support_test.customer'),'role','authenticated','aal','aal1','session_id',current_setting('support_test.session'),'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
select set_config('request.headers',jsonb_build_object('x-elite-device',repeat('A',43))::text,true);
set local role authenticated;
do $$ declare cid uuid:=current_setting('support_test.chat')::uuid;r jsonb;begin
 r:=public.elitetrade_support('history',cid);if r::text like '%PRIVATE ROLLBACK NOTE%' then raise exception 'Internal note leaked';end if;if r->'presence'->>'status'<>'online' or r->'presence'->>'typing'<>'true' then raise exception 'Presence failed: %',r;end if;if r->>'peerRead' is null then raise exception 'Read marker missing';end if;
 perform public.elitetrade_support('update',cid,'{"rating":5}');perform public.elitetrade_support('update',cid,'{"stage":"open"}');
end $$;
reset role;
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('support_test.other'),'role','authenticated','aal','aal1','session_id',current_setting('support_test.other_session'),'amr',jsonb_build_array(jsonb_build_object('method','otp','timestamp',extract(epoch from now())::bigint)))::text,true);
select set_config('request.headers',jsonb_build_object('x-elite-device',repeat('C',43))::text,true);
set local role authenticated;select public.elitetrade_browser_status();
do $$ declare blocked boolean:=false;r jsonb;begin
 begin perform public.elitetrade_support('history',current_setting('support_test.chat')::uuid);exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception 'Conversation isolation failed';end if;
 r:=public.elitetrade_support('list');if jsonb_array_length(r->'conversations')<>0 then raise exception 'Other inbox not isolated';end if;
end $$;
reset role;
select 'Support production RPC fixtures passed; all changes rolled back' as result;
rollback;
