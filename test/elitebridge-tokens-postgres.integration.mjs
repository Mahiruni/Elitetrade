import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const url=process.env.ELITEBRIDGE_TOKEN_CI_PG;
if(!url||!/^postgresql:\/\/[^@]+@(?:localhost|127\.0\.0\.1):5432\/elitebridge_token_ci$/.test(url))
 throw new Error('EliteBridge SQL rehearsal must use disposable localhost elitebridge_token_ci.');
test('isolated PostgreSQL proves EliteBridge-owned token restrictions and revocation',async t=>{
 const pool=new pg.Pool({connectionString:url,max:5});
 t.after(()=>pool.end());
 await pool.query("create role authenticated nologin");
 await pool.query("create role anon nologin");
 await pool.query("create role service_role nologin");
 await pool.query("create schema auth");
 await pool.query("grant usage on schema auth to authenticated");
 await pool.query("create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$");
 await pool.query("create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$");
 await pool.query("grant execute on function auth.uid(),auth.jwt() to authenticated");
 await pool.query("create table public.elitetrade_profiles(id uuid primary key,role text not null,disabled boolean not null default false)");
 const admin=randomUUID(),peer=randomUUID(),member=randomUUID();
 for(const [id,role]of [[admin,'admin'],[peer,'admin'],[member,'user']])
   await pool.query('insert into public.elitetrade_profiles(id,role) values ($1,$2)',[id,role]);
 const migration=readFileSync(new URL('../supabase/migrations/20261015000600_elitebridge_owned_tokens.sql',import.meta.url),'utf8');
 await pool.query(migration);
 const digest1='a'.repeat(64),digest2='b'.repeat(64);
 const asRole=async(role,id,aal,sql,params=[])=>{
   const c=await pool.connect();
   try{
     await c.query('begin');
     await c.query('set local role '+role);
     if(id)await c.query('select set_config($1,$2,true)',['request.jwt.claim.sub',id]);
     if(aal)await c.query('select set_config($1,$2,true)',['request.jwt.claim.aal',aal]);
     const result=await c.query(sql,params);
     await c.query('commit');
     return result;
   }catch(e){await c.query('rollback');throw e}finally{c.release()}
 };
 await t.test('only authenticated MFA-enabled admin can issue',async()=>{
   const cmd='select public.elitetrade_bridge_token_issue($1,$2,$3) as id';
   await assert.rejects(asRole('authenticated',admin,'aal1',cmd,['Private status key',digest1,24]),/MFA/);
   await assert.rejects(asRole('authenticated',member,'aal2',cmd,['Private status key',digest1,24]),/MFA/);
   await assert.rejects(asRole('anon',admin,'aal2',cmd,['Private status key',digest1,24]));
   const inserted=await asRole('authenticated',admin,'aal2',cmd,['Private status key',digest1,24]);
   assert.match(inserted.rows[0].id,/^[0-9a-f-]{36}$/);
   await assert.rejects(asRole('authenticated',admin,'aal2',cmd,['Duplicate key',digest1,24]),e=>e.code==='23505');
 });
 await t.test('private table is not readable and verifier RPC is service-only',async()=>{
   const canCall=(await pool.query("select has_function_privilege('authenticated','public.elitetrade_bridge_token_verify(text)','execute') as u,has_function_privilege('service_role','public.elitetrade_bridge_token_verify(text)','execute') as svc")).rows[0];
   assert.equal(canCall.u,false);assert.equal(canCall.svc,true);
   await assert.rejects(asRole('authenticated',admin,'aal2',
      'select token_hash from elitetrade_private.elitetrade_bridge_api_tokens'));
   await assert.rejects(asRole('authenticated',admin,'aal2',
      'select * from public.elitetrade_bridge_token_verify($1)',[digest1]));
   const listed=await asRole('authenticated',admin,'aal2','select * from public.elitetrade_bridge_token_list()');
   assert.equal(listed.rows.length,1);
   assert.deepEqual(Object.keys(listed.rows[0]).sort(),['created_at','expires_at','id','label','revoked_at','scope']);
   const verified=await asRole('service_role',null,null,
      'select * from public.elitetrade_bridge_token_verify($1)',[digest1]);
   assert.equal(verified.rows[0].owner_id,admin);assert.equal(verified.rows[0].scope,'bridge:status');
 });
 await t.test('owner isolation and immediate revocation',async()=>{
   const id=(await asRole('authenticated',admin,'aal2','select id from public.elitetrade_bridge_token_list()')).rows[0].id;
   const peerRows=await asRole('authenticated',peer,'aal2','select * from public.elitetrade_bridge_token_list()');
   assert.equal(peerRows.rows.length,0);
   assert.equal((await asRole('authenticated',peer,'aal2',
      'select public.elitetrade_bridge_token_revoke($1) as result',[id])).rows[0].result,false);
   assert.equal((await asRole('authenticated',admin,'aal2',
      'select public.elitetrade_bridge_token_revoke($1) as result',[id])).rows[0].result,true);
   assert.equal((await asRole('service_role',null,null,
      'select * from public.elitetrade_bridge_token_verify($1)',[digest1])).rows.length,0);
 });
 await t.test('bad hash, overlong expiry and invalid label are rejected',async()=>{
   const cmd='select public.elitetrade_bridge_token_issue($1,$2,$3)';
   await assert.rejects(asRole('authenticated',admin,'aal2',cmd,['ok',digest2,24]),/Invalid/);
   await assert.rejects(asRole('authenticated',admin,'aal2',cmd,['Valid token',digest2,721]),/Invalid/);
   await assert.rejects(asRole('authenticated',admin,'aal2',cmd,['Valid token','<secret>',24]),/Invalid/);
 });
});
