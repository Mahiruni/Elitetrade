import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
import {readFileSync} from 'node:fs';
const owned='11111111-2222-4333-8444-555555555555';
const foreign='99999999-2222-4333-8444-555555555555';
const now=Date.now();
async function createFixture(t){
 let healthCalls=0,quoteCalls=0,tradeCalls=0;
 const owner={id:'my-user',role:'user',disabled:false,active:true};
 const account={id:owned,broker:'Exness',login:'477054974',status:'connected',gateway_id:'metaapi-existing:11111111-2222-4333-8444-555555555555:aaaa1111-2222-4333-8444-555555555555'};
 const db={
  authUser:async()=>({id:'my-user',email:'owner@example.com',factors:[]}),
  one:async(t,where)=>{
   if(t==='elitetrade_profiles')return owner;
   if(t==='elitetrade_accounts')return where.includes('id=eq.'+owned)&&where.includes('user_id=eq.my-user')?account:null;
   if(t==='elitetrade_engine_heartbeat')return {updated_at:new Date(now).toISOString()};
   return null;
  },
  query:async(table,where)=>table==='elitetrade_accounts'?[account]:[]
 };
 const gateway={mode:'account-data',
  connectionHealth:async()=>{healthCalls++;return {hostingState:'DEPLOYED',connectionStatus:'CONNECTED',brokerVerified:true,accountType:'demo',tradeAllowed:true};},
  previewMarket:async(_,symbol)=>{quoteCalls++;return {info:{platform:'mt5',type:'ACCOUNT_TRADE_MODE_DEMO'},quote:{symbol,bid:4050,ask:4050.4,time:new Date(now).toISOString()}};},
  demoOrder:async()=>{tradeCalls++;}
 };
 const app=createSupabaseApplication({db,gateway,telegram:null,deviceVerification:false,env:{APP_ORIGIN:'http://localhost:3000'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const request=async(path,headers={})=>{
  const res=await fetch('http://127.0.0.1:'+app.server.address().port+path,{headers});
  return {status:res.status,data:await res.json(),headers:res.headers};
 };
 return {request,get healthCalls(){return healthCalls},get quoteCalls(){return quoteCalls},get tradeCalls(){return tradeCalls}};
}
test('probe requires signed-in owner and never invokes trade',async t=>{
 const f=await createFixture(t);
 assert.equal((await f.request('/api/elitebridge/accounts/'+owned+'/probe')).status,401);
 const authed={Authorization:'Bearer owner-token'};
 const x=await f.request('/api/elitebridge/accounts/'+owned+'/probe?symbol=XAUUSDm',authed);
 assert.equal(x.status,200);
 assert.equal(x.data.state,'verified-demo');assert.equal(x.data.market.state,'fresh');
 assert.equal(x.headers.get('cache-control'),'no-store');
 assert.equal(f.healthCalls,1);assert.equal(f.quoteCalls,1);assert.equal(f.tradeCalls,0);
 assert.ok(!JSON.stringify(x.data).includes('477054974'));
});
test('a guessed foreign account cannot trigger provider access',async t=>{
 const f=await createFixture(t);
 const r=await f.request('/api/elitebridge/accounts/'+foreign+'/probe',{Authorization:'Bearer owner-token'});
 assert.equal(r.status,404);assert.equal(f.healthCalls,0);
});
test('bad broker symbol rejected before any provider call',async t=>{
 const f=await createFixture(t);
 const r=await f.request('/api/elitebridge/accounts/'+owned+'/probe?symbol=../../trade',{Authorization:'Bearer owner-token'});
 assert.equal(r.status,400);assert.equal(f.healthCalls,0);
});
test('Phase 2 Android probe remains read-only and owner-scoped',()=>{
 const api=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt',import.meta.url),'utf8');
 const page=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/EliteBridgePage.kt',import.meta.url),'utf8');
 assert.match(api,/suspend fun eliteBridgeProbe/);
 assert.match(page,/Check live DEMO and XAUUSDm quote/);
 assert.match(page,/Phase 2 is read-only/);
 assert.doesNotMatch(page,/demoOrder\(|OrderSend|METAAPI_TOKEN|SUPABASE_SERVICE_ROLE_KEY/);
});
