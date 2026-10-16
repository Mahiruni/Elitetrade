import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
const owned='11111111-2222-4333-8444-555555555555';
const foreign='99999999-2222-4333-8444-555555555555';
async function fixture(t,{real=false,configured=true,failed=false}={}){
  let calls=0,legacyCalls=0,audits=0;
  const db={authUser:async()=>({id:'owner',email:'owner@example.test',factors:[]}),
    one:async(table,where)=>{
      if(table==='elitetrade_profiles')return {id:'owner',role:'user',active:true,disabled:false};
      if(table==='elitetrade_accounts')return where.includes('id=eq.'+owned)&&where.includes('user_id=eq.owner')?
        {id:owned,broker:'Exness',login:'123456',server:real?'Exness-MT5Real9':'Exness-MT5Trial9'}:null;
      return null;
    },rpc:async()=>{audits++;}};
  const observer={snapshot:async args=>{calls++;assert.equal(args.login,'123456');assert.equal(args.accountId,owned);
    if(failed)throw Error('secret exception');
    return {brokerAuthenticated:true,readOnly:true,tradingEnabled:false};}};
  const app=createSupabaseApplication({env:{APP_ORIGIN:'http://localhost:3000'},db,
    cloudObserver:configured?observer:undefined,deviceVerification:false,telegram:null,
    gateway:{connectionHealth:async()=>{legacyCalls++;}}});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const get=async(id=owned,auth=true)=>{
    const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/elitebridge/accounts/'+id+'/cloud-probe',
      {headers:auth?{Authorization:'Bearer owner-token'}:{}});
    return {status:r.status,headers:r.headers,data:await r.json()};
  };
  return {get,counts:()=>({calls,legacyCalls,audits})};
}
test('independent snapshot requires owner auth and does not use MetaApi',async t=>{
  const f=await fixture(t);assert.equal((await f.get(owned,false)).status,401);
  assert.equal((await f.get(foreign)).status,404);assert.equal(f.counts().calls,0);
  const r=await f.get();assert.equal(r.status,200);assert.equal(r.data.provider,'elitebridge');
  assert.equal(r.headers.get('cache-control'),'private, no-store');
  assert.equal(r.data.executedOrder,false);assert.equal(f.counts().legacyCalls,0);assert.equal(f.counts().audits,1);
});
test('real account is locked before gateway access',async t=>{
  const f=await fixture(t,{real:true});assert.equal((await f.get()).status,409);assert.equal(f.counts().calls,0);
});
test('missing runtime is an explicit blocker, no MetaApi fallback',async t=>{
  const f=await fixture(t,{configured:false});const r=await f.get();
  assert.equal(r.status,503);assert.match(JSON.stringify(r.data),/not configured/);assert.equal(f.counts().legacyCalls,0);
});
test('gateway failure never exposes private exception or changes saved state',async t=>{
  const f=await fixture(t,{failed:true});const r=await f.get();
  assert.equal(r.status,503);assert.ok(!JSON.stringify(r.data).includes('secret exception'));
  assert.equal(f.counts().audits,0);
});
