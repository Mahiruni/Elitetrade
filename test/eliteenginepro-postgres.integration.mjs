// Actual disposable PostgreSQL; all broker receipts and commissioning flags are fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const url=process.env.ELITETRADE_ENGINEPRO_CI_POSTGRES_URL;
if(!url||!/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):5432\/enginepro_ci$/.test(url))
 throw Error('Use only disposable localhost enginepro_ci PostgreSQL.');

test('independent ledger rehearsal on actual PostgreSQL',async t=>{
 const pool=new pg.Pool({connectionString:url,max:5});t.after(()=>pool.end());
 const owner=randomUUID(),other=randomUUID(),account=randomUUID(),bot=randomUUID();
 const worker=randomUUID(),version='a'.repeat(64),signal='b'.repeat(64);
 const command={symbol:'XAUUSDm',side:'buy',volume:'0.01',stopLoss:'2000.00',takeProfit:'2010.00'};
 await pool.query(`create role authenticated nologin;create role anon nologin;create role service_role nologin bypassrls;
 create schema auth;create schema elitetrade_private;
 grant usage on schema auth to authenticated,service_role;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.user',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('test.aal',true))$$;
 create table auth.mfa_factors(user_id uuid,status text);
 create function elitetrade_private.require_browser() returns void language plpgsql as $$begin
 if current_setting('test.device',true) is distinct from 'verified' then raise exception 'DEVICE_REQUIRED';end if;end$$;
 create table public.elitetrade_profiles(id uuid primary key,active boolean,disabled boolean,role text);
 create table public.elitetrade_accounts(id uuid primary key,user_id uuid references public.elitetrade_profiles(id),broker text,server text);
 create table public.elitetrade_bots(id uuid primary key,user_id uuid,account_id uuid);
 grant select on public.elitetrade_accounts,public.elitetrade_bots,public.elitetrade_profiles to service_role;`);
 await pool.query('insert into public.elitetrade_profiles values($1,true,false,\'user\'),($2,true,false,\'user\')',[owner,other]);
 await pool.query("insert into public.elitetrade_accounts values($1,$2,'Exness','Exness-MT5Trial9')",[account,owner]);
 await pool.query('insert into public.elitetrade_bots values($1,$2,$3)',[bot,owner,account]);
 const migration=readFileSync(new URL('../supabase/migrations/20261016172242_eliteenginepro_durable_intents.sql',import.meta.url),'utf8');
 await pool.query(migration);
 const role=async(roleName,sql,args=[],{user=owner,aal='aal2',device='verified'}={})=>{
  const c=await pool.connect();try{await c.query('begin');await c.query('set local role '+roleName);
   await c.query("select set_config('test.user',$1,true),set_config('test.aal',$2,true),set_config('test.device',$3,true)",[user,aal,device]);
   const r=await c.query(sql,args);await c.query('commit');return r.rows[0]?.value;
  }catch(e){await c.query('rollback');throw e;}finally{c.release();}
 };
 const inspect=(stop=false,options={})=>role('authenticated','select public.elitetrade_enginepro_account($1,$2) as value',[account,stop],options);
 const claim=(id=worker)=>role('service_role','select public.elitetrade_enginepro_claim($1,$2,30) as value',[account,id]);
 const prepare=(epoch,key=signal,cmd=command,config=version)=>role('service_role',
  'select public.elitetrade_enginepro_prepare($1,$2,$3,$4,$5,$6,$7) as value',[account,bot,worker,epoch,config,key,cmd]);
 const advance=(id,epoch,state,receipt=null)=>role('service_role',
  'select public.elitetrade_enginepro_advance($1,$2,$3,$4,$5) as value',[id,worker,epoch,state,receipt]);
 const expire=()=>pool.query("update elitetrade_private.enginepro_accounts set lease_until=clock_timestamp()-interval '1 second'");
 const fixtureAuthorize=()=>pool.query("update elitetrade_private.enginepro_accounts set stopped=false,broker_verified_until=clock_timestamp()+interval '1 minute',execution_authorized_until=clock_timestamp()+interval '1 minute'");
 let lease,intent;
 await t.test('no direct table access, anonymous RPC or client worker access',async()=>{
  await assert.rejects(role('authenticated','select * from elitetrade_private.enginepro_intents'),e=>e.code==='42501');
  await assert.rejects(role('anon','select public.elitetrade_enginepro_account($1,false)',[account]),e=>e.code==='42501');
  await assert.rejects(role('authenticated','select public.elitetrade_enginepro_claim($1,$2,30)',[account,worker]),e=>e.code==='42501');
  const s=await inspect();assert.equal(s.killSwitch,true);assert.equal(s.executionEnabled,false);assert.deepEqual(s.intents,[]);
  assert.equal((await pool.query('select count(*)::int as n from elitetrade_private.enginepro_accounts')).rows[0].n,0,'GET must not create state');
 });
 await t.test('ownership, device and MFA enforced inside database RPC',async()=>{
  await assert.rejects(inspect(false,{user:other}),/ACCOUNT_NOT_FOUND/);
  await assert.rejects(inspect(true,{device:'unverified'}),/DEVICE_REQUIRED/);
  await pool.query("insert into auth.mfa_factors values($1,'verified')",[owner]);
  await assert.rejects(inspect(true,{aal:'aal1'}),/MFA_REQUIRED/);
 });
 await t.test('owner stop persists across connections and is audited',async()=>{
  const s=await inspect(true);assert.equal(s.killSwitch,true);assert.equal(s.positionsClosed,false);assert.equal(s.legacyEngineAffected,false);
  assert.equal((await inspect()).epoch,s.epoch);
  assert.equal((await pool.query("select count(*)::int as n from elitetrade_private.enginepro_events where code='OWNER_STOP'")).rows[0].n,1);
 });
 await t.test('competing claims have one winner and stop fences old worker',async()=>{
  const a=randomUUID(),b=randomUUID(),r=await Promise.all([claim(a),claim(b)]);
  assert.equal(r.filter(Boolean).length,1);
  await inspect(true);lease=await claim();
  await assert.rejects(prepare(lease.epoch),/STOPPED/);
  await fixtureAuthorize();
 });
 await t.test('DEMO-only binding and strict intent schema',async()=>{
  await pool.query("update public.elitetrade_accounts set server='Exness-MT5Real9'");
  await assert.rejects(prepare(lease.epoch),/DEMO_REQUIRED/);
  await pool.query("update public.elitetrade_accounts set server='Exness-MT5Trial9'");
  await assert.rejects(prepare(lease.epoch,signal,{...command,password:'synthetic-forbidden-field'}),/INTENT_INVALID/);
  await assert.rejects(prepare(lease.epoch,signal,{...command,volume:'0'}),/INTENT_INVALID/);
 });
 await t.test('duplicate signal is idempotent; changed configuration and parallel intents fail',async()=>{
  intent=await prepare(lease.epoch);assert.equal(await prepare(lease.epoch),intent);
  await assert.rejects(prepare(lease.epoch,signal,command,'f'.repeat(64)),/SIGNAL_CONFLICT/);
  await assert.rejects(prepare(lease.epoch,'c'.repeat(64)),/RECONCILIATION_REQUIRED/);
  await assert.rejects(advance(intent,lease.epoch,'accepted',{orderId:'42'}),/TRANSITION_REJECTED/);
 });
 await t.test('uncommissioned or expired authorization blocks submission',async()=>{
  await advance(intent,lease.epoch,'validating');await advance(intent,lease.epoch,'ready');
  await pool.query('update elitetrade_private.enginepro_accounts set execution_authorized_until=null');
  await assert.rejects(advance(intent,lease.epoch,'submitting'),/COMMISSIONING_REQUIRED/);
  await fixtureAuthorize();await advance(intent,lease.epoch,'submitting');
 });
 await t.test('restart after send fences stale worker and preserves unknown outcome',async()=>{
  const stale=lease.epoch;await expire();lease=await claim();assert.notEqual(lease.epoch,stale);
  assert.equal((await inspect()).intents[0].state,'unknown');
  await assert.rejects(advance(intent,stale,'accepted',{orderId:'42'}),/LEASE_LOST/);
  assert.equal(await prepare(lease.epoch),intent,'duplicate returns original record, never a fresh submission');
  await assert.rejects(prepare(lease.epoch,'c'.repeat(64)),/RECONCILIATION_REQUIRED/);
 });
 await t.test('stop retains ambiguity; reconciliation remains available while stopped',async()=>{
  await inspect(true);lease=await claim();const s=await inspect();
  assert.equal(s.unresolvedCount,1);assert.equal(s.intents[0].state,'unknown');
  await assert.rejects(advance(intent,lease.epoch,'reconciled'),/BROKER_RECEIPT_REQUIRED/);
  await advance(intent,lease.epoch,'reconciled',{orderId:'42',dealId:'43'});
  assert.equal((await inspect()).unresolvedCount,0);
  await assert.rejects(advance(intent,lease.epoch,'ready'),/TRANSITION_REJECTED/);
 });
 await t.test('stop cancels unsent work, never a request already submitting',async()=>{
  await fixtureAuthorize();const next=await prepare(lease.epoch,'d'.repeat(64));await inspect(true);
  assert.equal((await inspect()).intents.find(i=>i.id===next).state,'cancelled');
  lease=await claim();await fixtureAuthorize();const sent=await prepare(lease.epoch,'e'.repeat(64));
  await advance(sent,lease.epoch,'validating');await advance(sent,lease.epoch,'ready');await advance(sent,lease.epoch,'submitting');
  await inspect(true);assert.equal((await inspect()).intents.find(i=>i.id===sent).state,'unknown');
  assert.equal((await inspect()).killSwitch,true);
 });
});
