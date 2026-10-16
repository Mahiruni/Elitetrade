import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
import {createEliteEngineProWorkspace} from '../public/eliteenginepro.js';

async function fixture(t,{heartbeatError=false}={}){
  let operations=0;const queries=[];
  const db={authUser:async()=>({id:'owner',email:'owner@example.test',factors:[]}),
    one:async(table)=>{
      if(table==='elitetrade_profiles')return {id:'owner',role:'user',active:true,disabled:false};
      if(table==='elitetrade_engine_heartbeat'){
        if(heartbeatError)throw Error('private database diagnostic');
        return {updated_at:new Date().toISOString()};
      }
    },query:async(table,where,token)=>{
      queries.push({table,where,token});return [{id:'account',status:'pending'}];
    }};
  const gateway={mode:'account-data',connectionHealth:async()=>{operations++;},demoOrder:async()=>{operations++;}};
  const app=createSupabaseApplication({env:{APP_ORIGIN:'http://localhost:3000'},db,gateway,
    cloudObserver:{snapshot:async()=>{operations++;}},deviceVerification:false,telegram:null});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const get=async(auth=true,path='/api/engine/pro/status')=>{
    const res=await fetch('http://127.0.0.1:'+app.server.address().port+path,
      {headers:auth?{Authorization:'Bearer owner-token'}:{}});
    return {status:res.status,headers:res.headers,text:await res.text()};
  };
  return {get,queries,operations:()=>operations};
}
test('integrated engine status is authenticated, owner scoped and never executes or probes',async t=>{
  const f=await fixture(t);
  assert.equal((await f.get(false)).status,401);assert.equal(f.queries.length,0);
  const r=await f.get(),s=JSON.parse(r.text);
  assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');
  assert.match(f.queries[0].where,/user_id=eq.owner/);assert.equal(f.queries[0].token,'owner-token');
  assert.deepEqual(s.accounts,{registered:1,pending:1,items:[{id:'account'}]});
  assert.equal(s.legacy.heartbeat,'fresh');assert.equal(s.independent.gatewayConfigured,true);
  assert.equal(s.independent.state,'blocked');assert.equal(s.independent.executionEnabled,false);
  assert.equal(s.independent.brokerVerification,'not-checked');assert.equal(s.independent.persistenceVerified,false);
  assert.equal(s.controls.canManageNativeDemo,false);assert.equal(f.operations(),0);
  assert.equal((await f.get(true,'/api/engine/mobile/status')).status,403);
  assert.equal((await f.get(true,'/eliteenginepro')).status,200);
  const asset=await f.get(true,'/eliteenginepro.js');assert.equal(asset.status,200);
  assert.match(asset.text,/createEliteEngineProWorkspace/);
});
test('failed heartbeat check stays unknown and cannot expose private diagnostics',async t=>{
  const f=await fixture(t,{heartbeatError:true}),r=await f.get();
  assert.equal(JSON.parse(r.text).legacy.heartbeat,'unknown');assert.doesNotMatch(r.text,/private database diagnostic/);
});
test('workspace renders a recent legacy heartbeat without enabling independent trading',async()=>{
  const calls=[];
  const ui=createEliteEngineProWorkspace({state:{user:{id:'owner'}},esc:s=>String(s).replaceAll('<','&lt;'),
    api:async(...args)=>{calls.push(args);return {checkedAt:new Date().toISOString(),
      independent:{gatewayConfigured:true,blocker:'<private-host>'},
      accounts:{registered:1,pending:1},legacy:{provider:'metaapi',heartbeat:'fresh',mobileEnabled:true}};}});
  const html=await ui.page();
  assert.deepEqual(calls,[['/engine/pro/status']]);assert.match(html,/Recent heartbeat · broker session not verified/);
  assert.match(html,/Independent execution blocked/);assert.match(html,/Configured · unverified/);
  assert.doesNotMatch(html,/<private-host>/);assert.doesNotMatch(html,/onrender\.com|Start engine|ENGINE ONLINE/);
  ui.dispose();
});
