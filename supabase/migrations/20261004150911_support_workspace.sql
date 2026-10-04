-- Additive migration. Customer-facing messages remain in the existing history table.
create table elitetrade_private.support_config(id boolean primary key default true check(id), value jsonb not null);
insert into elitetrade_private.support_config values(true,'{"words":["fuck","shit","bitch","asshole"],"categories":["Account access","MT5 connection","Bot settings","Subscription","Payments","Other"],"priorities":["Normal","High","Urgent"],"replies":["Thanks for contacting EliteTrade. Could you describe the issue and when it started?","Please share the error message. Keep passwords, API keys, and MT5 credentials out of this chat."],"hours":"Support hours have not been configured.","offline":"Your message is saved. An assigned agent can reply when available.","maxAttachments":5,"maxFileBytes":20971520}');
create table elitetrade_private.support_meta(conversation_id uuid primary key references public.elitetrade_conversations(id) on delete cascade, assigned_to uuid references public.elitetrade_profiles(id), stage text not null default 'open' check(stage in ('open','waiting','resolved')), category text not null default 'Other', priority text not null default 'Normal', rating integer check(rating between 1 and 5));
create table elitetrade_private.support_presence(conversation_id uuid references public.elitetrade_conversations(id) on delete cascade,user_id uuid references public.elitetrade_profiles(id) on delete cascade,tab_id uuid, seen bigint not null, active bigint not null, typing bigint not null default 0, connected boolean not null default true, primary key(conversation_id,user_id,tab_id));
create table elitetrade_private.support_reads(conversation_id uuid references public.elitetrade_conversations(id) on delete cascade,user_id uuid references public.elitetrade_profiles(id) on delete cascade, cursor bigint not null default 0, primary key(conversation_id,user_id));
create table elitetrade_private.support_notes(id uuid primary key default gen_random_uuid(),conversation_id uuid references public.elitetrade_conversations(id) on delete cascade,author_id uuid references public.elitetrade_profiles(id),body text not null,created_at bigint not null);
create table elitetrade_private.support_attachments(id uuid primary key,conversation_id uuid references public.elitetrade_conversations(id) on delete cascade,owner_id uuid references public.elitetrade_profiles(id),message_id uuid references public.elitetrade_messages(id),name text not null,mime text not null,size bigint not null,created_at bigint not null);
create table elitetrade_private.support_limits(user_id uuid,kind text,window_start bigint,hits int not null default 1, primary key(user_id,kind));
create table elitetrade_private.support_abuse(user_id uuid primary key references public.elitetrade_profiles(id),count int not null default 1,updated_at bigint not null);
-- Flag counts only; original blocked drafts are never persisted.
alter table public.elitetrade_messages add column support_seq bigint generated always as identity;
alter table public.elitetrade_messages add column client_id uuid;
alter table public.elitetrade_messages add column author_id uuid references public.elitetrade_profiles(id);
create unique index elitetrade_support_dedup on public.elitetrade_messages(conversation_id,client_id) where client_id is not null;
create index elitetrade_support_history on public.elitetrade_messages(conversation_id,support_seq desc);
create index elitetrade_support_updated on public.elitetrade_conversations(updated_at desc);
create index elitetrade_support_assigned on elitetrade_private.support_meta(assigned_to);
-- No Data API grants on private support tables. One RPC enforces every operation.
revoke all on elitetrade_private.support_config,elitetrade_private.support_meta,elitetrade_private.support_presence,elitetrade_private.support_reads,elitetrade_private.support_notes,elitetrade_private.support_attachments,elitetrade_private.support_limits,elitetrade_private.support_abuse from public,anon,authenticated;

create function elitetrade_private.support_presence_value(p_chat uuid,p_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case when p_user is null then jsonb_build_object('status','unavailable','lastSeen',null) else coalesce((select jsonb_build_object('status',case when bool_or(connected and seen>extract(epoch from clock_timestamp())*1000-45000) then case when max(active)>extract(epoch from clock_timestamp())*1000-120000 then 'online' else 'away' end else 'offline' end,'lastSeen',max(seen),'typing',bool_or(conversation_id=p_chat and connected and typing>extract(epoch from clock_timestamp())*1000-5000 and seen>extract(epoch from clock_timestamp())*1000-45000)) from elitetrade_private.support_presence where user_id=p_user having count(*)>0),jsonb_build_object('status','unavailable','lastSeen',null)) end
$$;
revoke all on function elitetrade_private.support_presence_value(uuid,uuid) from public,anon,authenticated;

create function elitetrade_private.support(p_action text,p_id uuid,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
#variable_conflict use_column
declare u uuid:=auth.uid(); adm boolean; ms bigint:=(extract(epoch from clock_timestamp())*1000)::bigint; c public.elitetrade_conversations; m elitetrade_private.support_meta; cfg jsonb; result jsonb; msg public.elitetrade_messages; n bigint; client uuid; word text; txt text; ids uuid[]; peer uuid; size_limit int; block boolean:=false;
begin
 if u is null or not elitetrade_private.browser_verified() or not exists(select 1 from public.elitetrade_profiles where id=u and not disabled) then raise exception 'Sign in and verify this browser to continue.' using errcode='42501'; end if;
 adm:=elitetrade_private.is_admin(); select value into cfg from elitetrade_private.support_config where id;
 if p_action in ('create','send','note','upload','config_save','update') then
  insert into elitetrade_private.support_limits values(u,p_action,ms,1) on conflict(user_id,kind) do update set window_start=case when support_limits.window_start<ms-60000 then ms else support_limits.window_start end,hits=case when support_limits.window_start<ms-60000 then 1 else support_limits.hits+1 end returning hits into n;
  if n>(case when p_action='create' then 5 when p_action='upload' then 15 else 30 end) then return jsonb_build_object('error','Too many attempts. Please wait a minute.','status',429); end if;
 end if;
 if p_action='config_save' then
  if not adm then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if jsonb_typeof(p_data->'words')<>'array' or jsonb_array_length(p_data->'words')>100 or length(p_data::text)>50000 then raise exception 'Invalid support configuration.'; end if;
  update elitetrade_private.support_config set value=p_data where id; return jsonb_build_object('ok',true);
 end if;
 if p_action='list' then
  select coalesce(jsonb_agg(x order by (x->>'updated_at')::bigint desc),'[]') into result from (
   select to_jsonb(c)-'guest_hash'||jsonb_build_object('reference','ET-'||upper(left(c.id::text,8)),'stage',coalesce(m.stage,case when c.status='closed' then 'resolved' else 'open' end),'assigned_to',m.assigned_to,'agent_name',a.full_name,'category',coalesce(m.category,'Other'),'priority',coalesce(m.priority,'Normal'),'preview',coalesce((select left(body,160) from public.elitetrade_messages where conversation_id=c.id order by support_seq desc limit 1),''),'unread',(select count(*) from public.elitetrade_messages where conversation_id=c.id and sender=case when adm then 'customer' else 'admin' end and support_seq>coalesce((select cursor from elitetrade_private.support_reads where conversation_id=c.id and user_id=u),0)),'presence',elitetrade_private.support_presence_value(c.id,case when adm then c.user_id else m.assigned_to end)) x
   from public.elitetrade_conversations c left join elitetrade_private.support_meta m on m.conversation_id=c.id left join public.elitetrade_profiles a on a.id=m.assigned_to where adm or c.user_id=u
  ) q;
  return jsonb_build_object('conversations',result,'config',cfg-'words'-'replies'||case when adm then jsonb_build_object('words',cfg->'words','replies',cfg->'replies') else '{}'::jsonb end,'agents',case when adm then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name)),'[]') from public.elitetrade_profiles where role='admin' and not disabled) else '[]'::jsonb end,'abuse',case when adm then (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select user_id,count,updated_at from elitetrade_private.support_abuse where count>=3 and updated_at>ms-2592000000) x) else '[]'::jsonb end);
 end if;
 if p_action='create' then
  if not cfg->'categories' ? coalesce(p_data->>'category','Other') then raise exception 'Choose a valid category.'; end if;
  insert into public.elitetrade_conversations(user_id,name,email,created_at,updated_at) select u,full_name,email,ms,ms from public.elitetrade_profiles where id=u returning * into c;
  insert into elitetrade_private.support_meta(conversation_id,category) values(c.id,coalesce(p_data->>'category','Other'));return jsonb_build_object('id',c.id);
 end if;
 select * into c from public.elitetrade_conversations where id=p_id for update;
 if c.id is null or not(adm or c.user_id=u) then raise exception 'Conversation not found.' using errcode='42501'; end if;
 insert into elitetrade_private.support_meta(conversation_id,stage) values(c.id,case when c.status='closed' then 'resolved' else 'open' end) on conflict do nothing;
 select * into m from elitetrade_private.support_meta where conversation_id=c.id;
 peer:=case when adm then c.user_id else m.assigned_to end;
 if p_action='history' then
  select coalesce(jsonb_agg(x order by (x->>'support_seq')::bigint),'[]') into result from (select to_jsonb(msg)||jsonb_build_object('attachments',(select coalesce(jsonb_agg(to_jsonb(a)-'owner_id'),'[]') from elitetrade_private.support_attachments a where a.message_id=msg.id)) x from (select * from public.elitetrade_messages where conversation_id=c.id and (p_data->>'before' is null or support_seq<(p_data->>'before')::bigint) and (p_data->>'after' is null or support_seq>(p_data->>'after')::bigint) and (p_data->>'search' is null or position(lower(p_data->>'search') in lower(body))>0) order by case when p_data->>'after' is not null then support_seq end asc,support_seq desc limit 60) msg) q;
  return jsonb_build_object('conversation',to_jsonb(c)-'guest_hash'||to_jsonb(m)-'conversation_id'||jsonb_build_object('reference','ET-'||upper(left(c.id::text,8)),'agent_name',(select full_name from public.elitetrade_profiles where id=m.assigned_to)),'messages',result,'presence',elitetrade_private.support_presence_value(c.id,peer),'peerRead',case when adm then (select cursor from elitetrade_private.support_reads where conversation_id=c.id and user_id=c.user_id) else (select max(r.cursor) from elitetrade_private.support_reads r join public.elitetrade_profiles p on p.id=r.user_id and p.role='admin' where r.conversation_id=c.id) end,'notes',case when adm then (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]') from elitetrade_private.support_notes a where a.conversation_id=c.id) else '[]'::jsonb end);
 end if;
 if p_action='heartbeat' then
  insert into elitetrade_private.support_presence values(c.id,u,(p_data->>'tabId')::uuid,ms,case when coalesce((p_data->>'active')::boolean,false) then ms else 0 end,case when coalesce((p_data->>'typing')::boolean,false) then ms else 0 end,not coalesce((p_data->>'leaving')::boolean,false)) on conflict(conversation_id,user_id,tab_id) do update set seen=excluded.seen,active=greatest(support_presence.active,excluded.active),typing=excluded.typing,connected=excluded.connected;
  return jsonb_build_object('presence',elitetrade_private.support_presence_value(c.id,peer));
 end if;
 if p_action='read' then
  select coalesce(max(support_seq),0) into n from public.elitetrade_messages where conversation_id=c.id and support_seq<=coalesce((p_data->>'cursor')::bigint,0);
  insert into elitetrade_private.support_reads values(c.id,u,n) on conflict(conversation_id,user_id) do update set cursor=greatest(support_reads.cursor,excluded.cursor);return jsonb_build_object('ok',true);
 end if;
 if p_action in ('send','note') then
  txt:=coalesce(p_data->>'message','');
  if length(txt)+(select count(*) from regexp_split_to_table(txt,'') ch where octet_length(ch)=4)>20000 or (length(trim(txt))=0 and jsonb_array_length(coalesce(p_data->'attachments','[]'))=0) then raise exception 'Message must be 1–20000 characters or include an attachment.'; end if;
  if p_action='note' then
   if not adm or length(trim(txt))=0 then raise exception 'Administrator note required.' using errcode='42501';end if;
   insert into elitetrade_private.support_notes(conversation_id,author_id,body,created_at) values(c.id,u,txt,ms);return jsonb_build_object('ok',true);
  end if;
  client:=(p_data->>'clientId')::uuid;if client is null then raise exception 'A client message ID is required.';end if;
  select * into msg from public.elitetrade_messages where conversation_id=c.id and client_id=client;
  if msg.id is not null then return jsonb_build_object('message',to_jsonb(msg),'duplicate',true);end if;
  if m.stage='resolved' then raise exception 'This conversation is resolved. Reopen it before sending.';end if;
  for word in select jsonb_array_elements_text(cfg->'words') loop
   if lower(normalize(txt,NFKC)) ~ ('(^|[^[:alnum:]_])'||regexp_replace(lower(normalize(word,NFKC)),'([^[:alnum:]_])','\\\1','g')||'([^[:alnum:]_]|$)') then block:=true;end if;
  end loop;
  if block then
   insert into elitetrade_private.support_abuse values(u,1,ms) on conflict(user_id) do update set count=case when support_abuse.updated_at<ms-2592000000 then 1 else support_abuse.count+1 end,updated_at=ms;
   return jsonb_build_object('error','This message contains a blocked word. Please revise it; your draft is still here.','status',422);
  end if;
  select coalesce(array_agg(v::uuid),'{}') into ids from jsonb_array_elements_text(coalesce(p_data->'attachments','[]')) v;
  if cardinality(ids)>(cfg->>'maxAttachments')::int or (select count(*) from elitetrade_private.support_attachments where id=any(ids) and conversation_id=c.id and owner_id=u and message_id is null)<>cardinality(ids) then raise exception 'Invalid attachments.';end if;
  insert into public.elitetrade_messages(conversation_id,sender,body,created_at,client_id,author_id) values(c.id,case when adm then 'admin' else 'customer' end,txt,ms,client,u) returning * into msg;
  update elitetrade_private.support_attachments set message_id=msg.id where id=any(ids);update public.elitetrade_conversations set updated_at=ms where id=c.id;
  update elitetrade_private.support_presence set typing=0 where conversation_id=c.id and user_id=u;
  return jsonb_build_object('message',to_jsonb(msg));
 end if;
 if p_action='update' then
  if p_data ? 'stage' then
   if p_data->>'stage' not in ('open','waiting','resolved') or (not adm and p_data->>'stage'<>'open') then raise exception 'Administrator access required.' using errcode='42501';end if;
   update elitetrade_private.support_meta set stage=p_data->>'stage' where conversation_id=c.id;
   update public.elitetrade_conversations set status=case when p_data->>'stage'='resolved' then 'closed' else 'open' end,updated_at=ms where id=c.id;
  end if;
  if p_data ? 'assigned_to' or p_data ? 'priority' or p_data ? 'category' then
   if not adm then raise exception 'Administrator access required.' using errcode='42501';end if;
   if p_data ? 'assigned_to' then
    if nullif(p_data->>'assigned_to','') is not null and not exists(select 1 from public.elitetrade_profiles where id=(p_data->>'assigned_to')::uuid and role='admin' and not disabled) then raise exception 'Invalid support agent.';end if;
    update elitetrade_private.support_meta set assigned_to=nullif(p_data->>'assigned_to','')::uuid where conversation_id=c.id;
   end if;
   if p_data ? 'priority' then if not cfg->'priorities' ? (p_data->>'priority') then raise exception 'Invalid priority.';end if;update elitetrade_private.support_meta set priority=p_data->>'priority' where conversation_id=c.id;end if;
   if p_data ? 'category' then if not cfg->'categories' ? (p_data->>'category') then raise exception 'Invalid category.';end if;update elitetrade_private.support_meta set category=p_data->>'category' where conversation_id=c.id;end if;
  end if;
  if p_data ? 'rating' then if adm or m.stage<>'resolved' or (p_data->>'rating')::int not between 1 and 5 then raise exception 'Rating unavailable.';end if;update elitetrade_private.support_meta set rating=(p_data->>'rating')::int where conversation_id=c.id;end if;
  return jsonb_build_object('ok',true);
 end if;
 if p_action='upload' then
  if m.stage='resolved' then raise exception 'Reopen this conversation before uploading.';end if;
  if (p_data->>'size')::bigint not between 1 and least((cfg->>'maxFileBytes')::bigint,20971520) or length(p_data->>'name')>180 or p_data->>'mime' not in ('image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv') then raise exception 'Invalid attachment.';end if;
  insert into elitetrade_private.support_attachments values((p_data->>'id')::uuid,c.id,u,null,p_data->>'name',p_data->>'mime',(p_data->>'size')::bigint,ms);return p_data;
 end if;
 if p_action in ('attachment','remove_attachment') then
  select to_jsonb(a) into result from elitetrade_private.support_attachments a where a.id=(p_data->>'id')::uuid and a.conversation_id=c.id and (a.message_id is not null or a.owner_id=u);
  if result is null then raise exception 'Attachment not found.';end if;
  if p_action='remove_attachment' then delete from elitetrade_private.support_attachments where id=(p_data->>'id')::uuid and owner_id=u and message_id is null;return jsonb_build_object('ok',true);end if;
  return result;
 end if;
 raise exception 'Invalid support operation.';
end $$;
revoke all on function elitetrade_private.support(text,uuid,jsonb) from public,anon,authenticated;
create function public.elitetrade_support(p_action text,p_id uuid default null,p_data jsonb default '{}') returns jsonb language sql security invoker set search_path='' as $$select elitetrade_private.support(p_action,p_id,p_data)$$;
grant execute on function elitetrade_private.support(text,uuid,jsonb) to authenticated;
revoke all on function public.elitetrade_support(text,uuid,jsonb) from public,anon;
grant execute on function public.elitetrade_support(text,uuid,jsonb) to authenticated;
-- Direct REST writes would bypass moderation, deduplication, and assignment checks.
revoke insert,update,delete on public.elitetrade_messages from authenticated;
revoke insert,update,delete on public.elitetrade_conversations from authenticated;
insert into storage.buckets(id,name,public,file_size_limit) values('elitetrade-support','elitetrade-support',false,20971520) on conflict(id) do update set public=false,file_size_limit=20971520;
-- No customer object policies: uploads/downloads use the authorized server proxy.

create function elitetrade_private.support_message_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare cfg jsonb; w text;
begin
 if length(new.body)+(select count(*) from regexp_split_to_table(new.body,'') ch where octet_length(ch)=4)>20000 then raise exception 'Message must not exceed 20000 characters.';end if;
 select value into cfg from elitetrade_private.support_config where id;
 for w in select jsonb_array_elements_text(cfg->'words') loop
  if lower(normalize(new.body,NFKC)) ~ ('(^|[^[:alnum:]_])'||regexp_replace(lower(normalize(w,NFKC)),'([^[:alnum:]_])','\\\1','g')||'([^[:alnum:]_]|$)') then raise exception 'This message contains a blocked word. Please revise it.';end if;
 end loop;
 return new;
end $$;
revoke all on function elitetrade_private.support_message_guard() from public,anon,authenticated;
create trigger elitetrade_support_message_guard before insert or update of body on public.elitetrade_messages for each row execute function elitetrade_private.support_message_guard();
