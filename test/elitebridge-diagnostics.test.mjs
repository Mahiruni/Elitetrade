import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {diagnoseBridgeTerminals} from '../src/elitebridge-diagnostics.mjs';
import {createEliteBridgeCloud} from '../src/elitebridge-cloud.mjs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

const NOW=Date.parse('2026-10-15T13:00:00.000Z');
const stamp=seconds=>new Date(NOW-seconds*1000).toISOString();
const base=(overrides={})=>({
  id:randomUUID(),label:'Windows MT5 observer',status:'approved',
  account_mode:'real',proof_verified_at:stamp(3600),
  last_heartbeat_at:stamp(10),heartbeat_connected_claim:'true',
  last_quote_at:stamp(15),
  ...overrides
});
const one=(override={})=>diagnoseBridgeTerminals([base(override)],{nowMs:NOW}).terminals[0];
test('fresh independently signed heartbeat and quote produce observation-only state',()=>{
  const response=diagnoseBridgeTerminals([base()],{nowMs:NOW});
  const device=response.terminals[0];
  assert.equal(device.state,'receiving');
  assert.deepEqual([device.heartbeatAgeSeconds,device.quoteAgeSeconds],[10,15]);
  assert.equal(device.terminalReportedConnected,true);
  assert.equal(device.brokerVerified,false);
  assert.equal(device.ordersEnabled,false);
  assert.equal(device.accountTradingAuthorized,false);
  assert.equal(response.counts.receiving,1);
  assert.equal(response.observationOnly,true);
  assert.equal(response.message.includes('not an independently verified broker connection'),true);
});
test('real and demo receive identical secure classification without order authority',()=>{
  for(const mode of ['real','demo']){
    const device=one({account_mode:mode});
    assert.equal(device.state,'receiving');
    assert.equal(device.accountMode,mode);
    assert.equal(device.ordersEnabled,false);
    assert.equal(device.brokerVerified,false);
  }
});
test('read-only recovery state machine reports missing, stale and disconnected cases',()=>{
  const states=[
    [{status:'pending'},'awaiting-approval'],
    [{status:'revoked'},'revoked'],
    [{last_heartbeat_at:null,last_quote_at:null},'awaiting-telemetry'],
    [{last_heartbeat_at:null},'incomplete-telemetry'],
    [{last_heartbeat_at:stamp(91)},'stale'],
    [{last_heartbeat_at:stamp(0),heartbeat_connected_claim:'false'},'terminal-reports-disconnected'],
    [{last_heartbeat_at:stamp(0),heartbeat_connected_claim:null},'incomplete-telemetry'],
    [{last_quote_at:null},'awaiting-quote'],
    [{last_heartbeat_at:stamp(10),last_quote_at:stamp(121)},'recovering'],
    [{last_heartbeat_at:stamp(90),last_quote_at:stamp(120)},'receiving']
  ];
  for(const [change,state] of states){
    const report=one(change);
    assert.equal(report.state,state,JSON.stringify(change));
    assert.equal(report.ordersEnabled,false);
    assert.equal(report.brokerVerified,false);
    assert.ok(report.recovery.length>18);
  }
});
test('future server timestamps and malicious DB rows are rejected or fail closed',()=>{
  const futur=one({last_heartbeat_at:new Date(NOW+60000).toISOString()});
  assert.equal(futur.state,'incomplete-telemetry');
  const missing=one({last_heartbeat_at:'not-a-date'});
  assert.equal(missing.state,'incomplete-telemetry');
  const row={...base(),secret:'never-return',public_key:'super-secret',
    proof_nonce:'secret',payload:{accountType:'real'}};
  const device=diagnoseBridgeTerminals([row],{nowMs:NOW}).terminals[0];
  for(const key of ['secret','public_key','proof_nonce','payload','account_id']){
    assert.equal(Object.hasOwn(device,key),false);
  }
  assert.throws(()=>diagnoseBridgeTerminals([base({account_mode:'contest'})]),/malformed/);
  assert.throws(()=>diagnoseBridgeTerminals(Array.from({length:31},()=>base())),/invalid privileged/);
});
test('owner-scoped private RPC handles failure as 503 without exposing database details',async()=>{
  const ownerId=randomUUID();
  const called=[];
  const bridge=createEliteBridgeCloud({db:{rpc:async(name,args)=>{
    called.push({name,args});return [base()];
  }}});
  const r=await bridge.diagnostics({ownerId,nowMs:NOW});
  assert.equal(r.terminals[0].state,'receiving');
  assert.deepEqual(called,[{name:'elitetrade_bridge_health',args:{p_owner_id:ownerId}}]);
  const failing=createEliteBridgeCloud({db:{rpc:async()=>{throw Error('secret database password');}}});
  await assert.rejects(()=>failing.diagnostics({ownerId}),e=>e.status===503&&!e.message.includes('password'));
  await assert.rejects(()=>bridge.diagnostics({ownerId:'not-valid'}),e=>e.status===400);
});
test('authenticated admin-only diagnostics HTTP route returns safe result; unauthenticated rejected',async t=>{
  const owner=randomUUID(),row=base({last_heartbeat_at:new Date(Date.now()-140000).toISOString(),last_quote_at:new Date(Date.now()-5000).toISOString()});
  const db={
    authUser:async()=>({id:owner,factors:[]}),
    one:async(table)=>table==='elitetrade_profiles'?
      {id:owner,email:'admin@example.com',disabled:false,active:true,role:'admin'}:null,
    rpc:async()=>({})
  };
  const bridgeDb={rpc:async(name,args)=>{
    assert.equal(name,'elitetrade_bridge_health');
    assert.equal(args.p_owner_id,owner);
    return [row];
  }};
  const app=createSupabaseApplication({db,bridgeDb,deviceVerification:false,
    gateway:null,telegram:null,
    env:{APP_ORIGIN:'http://127.0.0.1:3000',ELITEBRIDGE_CLOUD_ENABLED:'true'}});
  await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
  t.after(()=>app.close());
  const endpoint='http://127.0.0.1:'+app.server.address().port+'/api/elitebridge/diagnostics';
  const unauthorized=await fetch(endpoint);
  assert.equal(unauthorized.status,401);
  const response=await fetch(endpoint,{headers:{Authorization:'Bearer admin-session'}});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();
  assert.equal(data.terminals[0].state,'stale'); // Static sample date is older than real wall clock.
  assert.equal(data.ordersEnabled,false);
  assert.equal(JSON.stringify(data).includes('secret'),false);
});
test('SQL diagnostics function is service-role-only and fetches last heartbeat separately from quotes',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261015170000_elitebridge_diagnostics.sql',import.meta.url),'utf8');
  assert.match(sql,/security invoker/);
  assert.match(sql,/where a.owner_id=p_owner_id/);
  assert.match(sql,/p.kind='terminal.heartbeat'/);
  assert.match(sql,/p.kind='terminal.quote'/);
  assert.match(sql,/order by p.received_at desc,p.id desc/);
  assert.match(sql,/revoke all on function public.elitetrade_bridge_health\(uuid\)[\s\S]*from public, anon, authenticated/);
  assert.match(sql,/grant execute on function public.elitetrade_bridge_health\(uuid\) to service_role/);
});
