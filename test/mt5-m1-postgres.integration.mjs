import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const url=process.env.ELITETRADE_M1_CI_POSTGRES_URL;
if(!url||!/^postgres(?:ql)?:\/\/[^@]+@(?:127\.0\.0\.1|localhost):5432\/mt5_m1_ci$/.test(url))
 throw new Error('Use only disposable localhost mt5_m1_ci PostgreSQL.');

test('isolated PostgreSQL 16 M1 migration preserves strict DEMO arm gates',async t=>{
 const owner=randomUUID(),bot=randomUUID(),account=randomUUID();
 const pool=new pg.Pool({connectionString:url,max:3});
 t.after(async()=>pool.end());
 const sql=[
 "create role authenticated nologin",
 "create role anon nologin",
 "create schema auth",
 "create schema elitetrade_private",
 "grant usage on schema elitetrade_private to authenticated",
 "grant usage on schema auth to authenticated",
 "create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$",
 "create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('aal',current_setting('request.jwt.claim.aal',true))$$",
 "grant execute on function auth.uid(),auth.jwt() to authenticated",
 "create table auth.mfa_factors(user_id uuid,status text)",
 "create table public.elitetrade_profiles(id uuid primary key,active boolean not null,disabled boolean not null,role text not null)",
 "create table public.elitetrade_accounts(id uuid primary key,user_id uuid not null,status text not null,gateway_id text)",
 "create table public.elitetrade_bots(id uuid primary key,user_id uuid not null,account_id uuid,strategy text not null,status text default 'stopped', constraint elitetrade_bots_strategy_check check(strategy in ('trend','scalping','breakout')))",
 "create table public.elitetrade_engine_heartbeat(updated_at timestamptz not null)",
 "create table public.elitetrade_engine_leases(account_id uuid,expires_at timestamptz)",
 "create table public.elitetrade_engine_orders(account_id uuid,status text)",
 "create table public.elitetrade_engine_runs(bot_id uuid primary key,user_id uuid not null,account_id uuid not null,enabled boolean not null,config jsonb not null,message text not null,updated_at timestamptz default now())"
 ].join(';\n')+';';
 await pool.query(sql);
 await pool.query('insert into public.elitetrade_profiles values($1,true,false,$2)',[owner,'admin']);
 await pool.query('insert into public.elitetrade_accounts values($1,$2,$3,$4)',[account,owner,'connected','metaapi-existing:local:remote']);
 await pool.query('insert into public.elitetrade_bots values($1,$2,$3,$4,$5)',[bot,owner,account,'scalping','stopped']);
 await pool.query('insert into public.elitetrade_engine_heartbeat values(now())');
 // The engine control function is installed by the existing DEMO engine.
 // Prove M1 changes the CHECK constraint only: no privileged function rewrite.
 const baseline=readFileSync(new URL('../db/demo-engine.sql',import.meta.url),'utf8');
 const from=baseline.indexOf('create or replace function elitetrade_private.engine_control(');
 const to=baseline.indexOf('create or replace function public.elitetrade_engine_control(',from);
 assert.ok(from>0&&to>from,'original engine-control fixture must exist');
 await pool.query(baseline.slice(from,to));
 const readDef=async()=>(await pool.query(
   "select pg_get_functiondef('elitetrade_private.engine_control(uuid,boolean)'::regprocedure) as definition"
 )).rows[0].definition;
 const beforeDef=await readDef();
 const migration=readFileSync(new URL('../supabase/migrations/20261015000400_m1_demo_and_imported_account.sql',import.meta.url),'utf8');
 await pool.query(migration);
 assert.equal(await readDef(),beforeDef,'M1 migration must never replace privileged production engine control');
 await t.test('old preset preserved, M1 accepted, unsupported preset rejected',async()=>{
  assert.equal((await pool.query('select strategy from public.elitetrade_bots')).rows[0].strategy,'scalping');
  await pool.query('update public.elitetrade_bots set strategy=$1 where id=$2',['scalping-m1',bot]);
  await assert.rejects(pool.query('update public.elitetrade_bots set strategy=$1 where id=$2',['auto-execute',bot]),e=>e.code==='23514');
 });
 // Rehearse S15 separately after M1; never rewrite protected control().
 const s15=readFileSync(new URL('../supabase/migrations/20261015000500_s15_tick_scalper_option.sql',import.meta.url),'utf8');
 await pool.query(s15);
 assert.equal(await readDef(),beforeDef,'S15 must preserve the original protected control function');
 await t.test('S15 can be selected only explicitly, and old presets remain valid',async()=>{
   await pool.query('update public.elitetrade_bots set strategy=$1 where id=$2',['scalping-s15',bot]);
   assert.equal((await pool.query('select strategy from public.elitetrade_bots')).rows[0].strategy,'scalping-s15');
   await pool.query('update public.elitetrade_bots set strategy=$1 where id=$2',['scalping-m1',bot]);
   await assert.rejects(pool.query('update public.elitetrade_bots set strategy=$1 where id=$2',['unverified-tick',bot]),e=>e.code==='23514');
 });
 const arm=async ({user=owner,aal='aal2',running=true}={})=>{
  const c=await pool.connect();
  try{
   await c.query('begin');
   await c.query('set local role authenticated');
   await c.query('select set_config($1,$2,true)',['request.jwt.claim.sub',user]);
   await c.query('select set_config($1,$2,true)',['request.jwt.claim.aal',aal]);
   const r=await c.query('select elitetrade_private.engine_control($1,$2)',[bot,running]);
   await c.query('commit');
   return r;
  }catch(e){await c.query('rollback');throw e;}finally{c.release()}
 };
 await t.test('reject unowned bot, incomplete MFA, and non-provider links',async()=>{
  await assert.rejects(arm({user:randomUUID()}),/bot not found|sign in required/);
  await pool.query('insert into auth.mfa_factors values($1,$2)',[owner,'verified']);
  await assert.rejects(arm({aal:'aal1'}),/complete two-factor authentication/);
 });
 await t.test('approved imported MetaApi link can arm M1 without sending orders',async()=>{
  await arm();
  const run=(await pool.query("select enabled,config->>'strategy' as strategy from public.elitetrade_engine_runs")).rows[0];
  assert.equal(run.enabled,true);
  assert.equal(run.strategy,'scalping-m1');
  assert.equal((await pool.query('select count(*)::int as n from public.elitetrade_engine_orders')).rows[0].n,0);
 });
 await t.test('stale worker, wrong gateway, and unresolved orders block starting',async()=>{
  await arm({running:false});
  await pool.query('update public.elitetrade_accounts set gateway_id=$1',['rogue-host:remote']);
  await assert.rejects(arm(),/confirm the MT5 connection first/);
  await pool.query('update public.elitetrade_accounts set gateway_id=$1',['metaapi-existing:local:remote']);
  await pool.query("update public.elitetrade_engine_heartbeat set updated_at=now()-interval '180 seconds'");
  await assert.rejects(arm(),/demo worker unavailable/);
  await pool.query('update public.elitetrade_engine_heartbeat set updated_at=now()');
  await pool.query("insert into public.elitetrade_engine_orders values($1,'unknown')",[account]);
  await assert.rejects(arm(),/unconfirmed order requires provider reconciliation/);
 });
});
