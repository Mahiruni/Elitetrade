import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

const owner='1d8c4e4d-74a1-4a86-a48d-b7566c0e5b4f';
const accountId='b7e99855-4533-4b31-a419-59df968e3aa4';
const remoteId='66c54440-7d34-402d-a036-a455fe92591a';
const linked={id:accountId,user_id:owner,broker:'Example Demo Broker',login:'12345678',
  server:'Example-Demo',gateway_id:'metaapi-existing:'+accountId+':'+remoteId,
  status:'connected',created_at:new Date().toISOString()};
const pending={...linked,id:'a0e81111-753a-452d-84ad-bb43499fda94',
  gateway_id:null,status:'pending'};
async function fixture(t){
 const calls={health:0,snapshot:0,orders:0};
 const db={
  authUser:async()=>({id:owner,email:'user@example.test',factors:[]}),
  one:async(table,where)=>{
   if(table==='elitetrade_profiles')return {id:owner,role:'user',active:true,disabled:false};
   if(table==='elitetrade_accounts'&&where.includes('id=eq.'+accountId)&&
      where.includes('user_id=eq.'+owner))return linked;
   return null;
  },
  query:async(table)=>table==='elitetrade_accounts'?[linked,pending]:[]
 };
 const gateway={
  mode:'account-data',
  snapshot:async()=>{calls.snapshot++;return {connected:true,accountType:'demo',
    currency:'USD',balance:250,equity:251,positions:[]};},
  connectionHealth:async()=>{calls.health++;return {hostingState:'DEPLOYED',
    connectionStatus:'CONNECTED',brokerVerified:true,accountType:'demo',
    tradeAllowed:true,executionEnabled:false,
    message:'DEMO connection checked via provider.'};},
  demoOrder:async()=>{calls.orders++;throw Error('No order requests allowed')},
 };
 const app=createSupabaseApplication({db,gateway,telegram:null,deviceVerification:false,
  env:{APP_ORIGIN:'http://localhost:3000',MOBILE_DEMO_ENGINE_ENABLED:'false'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const call=async(path,authenticated=true)=>{
  const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/api'+path,
   {headers:authenticated?{Authorization:'Bearer test-account'}:{}});
  return {status:response.status,data:await response.json()};
 };
 return {call,calls};
}
test('MT5 owner sees only a safe hosted-link flag, never the MetaApi resource ID',async t=>{
 const f=await fixture(t);
 const r=await f.call('/accounts');
 assert.equal(r.status,200);
 assert.equal(r.data.accounts.length,2);
 assert.equal(r.data.accounts[0].hostedLinked,true);
 assert.equal(r.data.accounts[1].hostedLinked,false);
 assert.equal(r.data.accounts[0].status,'connected');
 assert.equal(r.data.accounts[0].snapshot.accountType,'demo');
 assert.ok(!JSON.stringify(r.data).includes(remoteId));
 assert.equal(f.calls.snapshot,1);
 assert.equal(f.calls.orders,0);
});
test('fast MT5 inventory stays responsive when upstream MetaApi is slow',async t=>{
 const f=await fixture(t);
 const r=await f.call('/accounts?fast=1');
 assert.equal(r.status,200);
 assert.equal(r.data.accounts[0].hostedLinked,true);
 assert.equal(r.data.accounts[0].status,'unknown');
 assert.equal(r.data.accounts[0].savedStatus,'connected');
 assert.match(r.data.accounts[0].note,/Check Live MT5/);
 assert.equal(f.calls.snapshot,0);
 assert.equal(f.calls.orders,0);
});
test('live account status uses existing owner-protected GET and never executes trades',async t=>{
 const f=await fixture(t);
 assert.equal((await f.call('/accounts/'+accountId+'/connection',false)).status,401);
 assert.equal(f.calls.health,0);
 const x=await f.call('/accounts/'+accountId+'/connection');
 assert.equal(x.status,200);
 assert.equal(x.data.brokerVerified,true);
 assert.equal(x.data.accountType,'demo');
 assert.equal(x.data.executionEnabled,false);
 assert.equal(f.calls.health,1);
 assert.equal(f.calls.orders,0);
});
test('MT5 UI exposes provider diagnostics and an honest demo-worker status panel',()=>{
 const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(app,/account\.hostedLinked\?btn\('Check Live MT5','account-connection-check'/);
 assert.match(app,/'account-connection-check':showLiveMt5Connection/);
 assert.match(app,/api\('\/engine\/mobile\/status'\)/);
 assert.match(app,/accounts\?fast=1/);
 assert.match(app,/DEMO worker:/);
 assert.match(app,/result\.brokerVerified===true/);
 assert.match(app,/Verified REAL · DEMO execution blocked/);
 const begin=app.indexOf('async function showLiveMt5Connection');
 const end=app.indexOf('const actions =',begin);
 const text=app.slice(begin,end);
 assert.doesNotMatch(text,/demoOrder|\/control|engine\/mobile\/tick|fetch\([^)]*method:'POST'/);
 assert.ok(begin>0&&end>begin);
});
