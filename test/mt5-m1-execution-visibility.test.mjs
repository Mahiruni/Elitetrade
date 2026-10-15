import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
import {STRATEGIES} from '../src/trading-strategies.mjs';

test('M1 is an explicit DEMO-only optional preset; previous strategies retain timeframe',()=>{
 assert.deepEqual(Object.keys(STRATEGIES),['trend','scalping','scalping-m1','scalping-s15','breakout']);
 assert.equal(STRATEGIES['scalping-m1'].timeframe,'1m');
 assert.equal(STRATEGIES['scalping-m1'].minutes,1);
 assert.equal(STRATEGIES['scalping-m1'].fast,5);
 assert.equal(STRATEGIES['scalping-m1'].slow,13);
 assert.equal(STRATEGIES.scalping.timeframe,'5m');
 assert.equal(STRATEGIES.trend.timeframe,'15m');
 assert.equal(STRATEGIES.breakout.timeframe,'15m');
});

test('M1 migration updates only strategy options, preserving existing secure control function',()=>{
 const migration=readFileSync(new URL('../supabase/migrations/20261015000400_m1_demo_and_imported_account.sql',import.meta.url),'utf8');
 const existing=readFileSync(new URL('../db/demo-engine.sql',import.meta.url),'utf8');
 assert.match(migration,/check\(strategy in \('trend','scalping','scalping-m1','breakout'\)\)/);
 assert.match(migration,/pg_get_functiondef/);
 assert.match(migration,/metaapi-existing:/);
 assert.doesNotMatch(migration,/create or replace function|drop function|update public\.elitetrade_bots|delete from|disable row level security/);
 assert.match(existing,/a\.gateway_id not like 'metaapi-existing:%'/);
 assert.match(existing,/auth\.mfa_factors/);
 assert.match(existing,/elitetrade_engine_heartbeat/);
 assert.match(existing,/elitetrade_engine_orders/);
 assert.match(existing,/elitetrade_engine_leases/);
});

test('owner-scoped confirmed broker receipts display on DEMO app; never fabricate simulated executions',async t=>{
 const owner=randomUUID(),botId=randomUUID(),accountId=randomUUID();
 const calls={query:[],orders:0};
 const receipts=[
  {bot_id:botId,status:'confirmed',created_at:'2026-10-15T10:00:00Z',
   request:{actionType:'ORDER_TYPE_BUY',symbol:'XAUUSDm',volume:0.01,credentials:'NEVER'},
   result:{orderId:1234,secret:'NOT_SAFE'}},
  {bot_id:botId,status:'unknown',created_at:'2026-10-15T10:01:00Z',
   request:{actionType:'ORDER_TYPE_SELL',symbol:'XAUUSDm',volume:0.01},
   result:{orderId:6789}},
  {bot_id:botId,status:'cancelled',created_at:'2026-10-15T10:02:00Z',
   request:{actionType:'ORDER_TYPE_BUY',symbol:'XAUUSDm',volume:0.01},
   result:{orderId:9999}}
 ];
 const db={
  authUser:async()=>({id:owner,email:'test@example.com',factors:[]}),
  one:async(table)=>{
   if(table==='elitetrade_profiles')return {id:owner,email:'test@example.com',role:'user',active:true,disabled:false};
   if(table==='elitetrade_engine_heartbeat')return {updated_at:'2020-01-01T00:00:00.000Z'};
   return null;
  },
  query:async(table,query)=>{
   calls.query.push({table,query});
   if(table==='elitetrade_bots')return [{id:botId,user_id:owner,name:'M1 DEMO',status:'stopped',account_id:accountId,
    strategy:'scalping-m1',symbol:'XAUUSDm'}];
   if(table==='elitetrade_engine_runs')return [];
   if(table==='elitetrade_engine_orders')return receipts;
   return [];
  }
 };
 const app=createSupabaseApplication({db,gateway:{mode:'account-data',
   async demoOrder(){calls.orders++}},deviceVerification:false,telegram:null,
   env:{APP_ORIGIN:'http://localhost:3000'}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 const noAuth=await fetch(base+'/api/bots');
 assert.equal(noAuth.status,401);
 const response=await fetch(base+'/api/bots',{headers:{Authorization:'Bearer owner'}});
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.engineReady,false);
 assert.equal(body.bots[0].strategy,'scalping-m1');
 assert.equal(body.executionHistory.length,3);
 assert.equal(body.executionHistory[0].status,'confirmed');
 assert.equal(body.executionHistory[0].brokerOrderId,'1234');
 assert.equal(body.executionHistory[1].brokerOrderId,null);
 assert.equal(body.executionHistory[2].brokerOrderId,null);
 assert.ok(calls.query.some(x=>x.table==='elitetrade_engine_orders'&&
   x.query.includes('user_id=eq.'+owner)&&x.query.includes('limit=12')));
 assert.equal(calls.orders,0);
 const printed=JSON.stringify(body);
 assert.ok(!printed.includes('NEVER'));
 assert.ok(!printed.includes('NOT_SAFE'));
 assert.ok(!printed.includes('6789'));
 assert.ok(!printed.includes('9999'));
});

test('Android/web bot UI exposes opt-in M1 and true broker receipt states',()=>{
 const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(source,/1-Min Scalper · M1 \(experimental\)/);
 assert.match(source,/MT5 DEMO trade execution/);
 assert.match(source,/No broker-confirmed DEMO executions recorded yet/);
 assert.match(source,/Unknown · reconcile in MT5/);
 assert.match(source,/entry\.status==='confirmed'/);
 assert.match(source,/engineMessage/);
 const server=readFileSync(new URL('../src/supabase-app.mjs',import.meta.url),'utf8');
 assert.match(server,/scalping-m1/);
 assert.match(server,/elitetrade_engine_orders/);
});

test('native Android strategy list includes M1 next to M5 and M15 presets',()=>{
 const ui=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt',import.meta.url),'utf8');
 const api=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt',import.meta.url),'utf8');
 for(const item of ['1-Min Scalper · M1','Scalping · M5','Trend · M15','Breakout · M15']){
   assert.ok(ui.includes(item),item);
 }
 assert.match(ui,/DropdownMenu\(expanded=strategyMenuExpanded/);
 assert.match(ui,/onStrategy\(bot,key\)/);
 assert.match(ui,/enabled=bot\.str\("status"\)=="stopped"/);
 assert.match(api,/suspend fun selectStrategy\(bot:JSONObject,strategy:String\)/);
 assert.match(api,/if\(strategy !in setOf\("trend","scalping","scalping-m1","scalping-s15","breakout"\)\)/);
 assert.match(api,/if\(bot\.optString\("status"\)!="stopped"\)/);
 assert.doesNotMatch(api.slice(api.indexOf('suspend fun selectStrategy'),api.indexOf('suspend fun eliteBridgeStatus')),/controlBot\(|demoOrder\(|executeOrder\(/);
});
