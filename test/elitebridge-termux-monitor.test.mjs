import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  BRIDGE_HEALTH_URL,MIN_WATCH_INTERVAL_MS,DEFAULT_WATCH_INTERVAL_MS,
  checkEliteBridgeCloud,formatTermuxCloudHealth,termuxMonitorReadiness
} from '../src/elitebridge-termux-monitor.mjs';

const valid={
  ok:true,status:200,redirected:false,url:BRIDGE_HEALTH_URL,
  headers:{get(name){return name==='content-type'?'application/json; charset=utf-8':null;}},
  async json(){return {ok:true,database:'supabase'};}
};
test('read-only cloud check uses only fixed public route, no auth or mutable verbs',async()=>{
  let seen=0;
  const r=await checkEliteBridgeCloud({fetcher:async (url,opts)=>{
    seen++;
    assert.equal(url,'https://elitetradee.vercel.app/health');
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.credentials,'omit');
    assert.equal(opts.cache,'no-store');
    assert.deepEqual(opts.headers,{Accept:'application/json'});
    assert.equal(Object.keys(opts.headers).length,1);
    return valid;
  }});
  assert.equal(seen,1);
  assert.equal(r.cloudState,'reachable');
  assert.equal(r.httpOk,true);
  assert.equal(r.brokerVerified,false);
  assert.equal(r.positionsVerified,false);
  assert.equal(r.ordersEnabled,false);
  assert.ok(r.latencyMs>=0);
  assert.match(formatTermuxCloudHealth(r),/Independent MT5: NOT CONNECTED/);
});
test('network errors, unauthenticated or redirected responses never assert health',async()=>{
  const cases=[
    ()=>{throw Error('secret=do-not-log-me');},
    ()=>({...valid,ok:false,status:401}),
    ()=>({...valid,ok:false,status:503}),
    ()=>({...valid,status:302,redirected:true,url:'https://evil.example'}),
    ()=>({...valid,url:'https://evil.example'}),
    ()=>({...valid,headers:{get(){return 'text/html'}}}),
    ()=>({...valid,json:async()=>({ok:false})}),
    ()=>({...valid,json:async()=>({database:'supabase'})}),
    ()=>({...valid,json:async()=>{throw Error('private detail') }})
  ];
  for(const scenario of cases){
    const result=await checkEliteBridgeCloud({fetcher:async()=>scenario()});
    assert.equal(result.httpOk,false);
    assert.equal(result.cloudState,'unavailable');
    assert.equal(result.ordersEnabled,false);
    assert.doesNotMatch(JSON.stringify(result),/do-not-log-me|private detail/);
  }
});
test('Termux readiness never equates Android runtime with MT5 broker access',()=>{
  const state=termuxMonitorReadiness({platform:'android',nodeVersion:'24.12.0'});
  assert.equal(state.runtimeReady,true);
  assert.equal(state.canMonitorCloud,true);
  assert.equal(state.canRunWindowsMT5,false);
  assert.equal(state.hasBrokerSession,false);
  assert.equal(state.ordersEnabled,false);
  assert.equal(termuxMonitorReadiness({platform:'android',nodeVersion:'18.12.0'}).runtimeReady,false);
  assert.equal(DEFAULT_WATCH_INTERVAL_MS,60000);
  assert.ok(MIN_WATCH_INTERVAL_MS>=30000);
});
test('Termux sidecar cannot import broker/Supabase clients or read credential files',()=>{
  const script=readFileSync(new URL('../scripts/elitebridge-termux-monitor.mjs',import.meta.url),'utf8');
  const source=readFileSync(new URL('../src/elitebridge-termux-monitor.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(script+source,/SUPABASE_SECRET_KEY|METAAPI_TOKEN|service_role|process\.env|--env-file|order_send|demoOrder\(|fetch\([^)]*\/api\/|new WebSocket/);
  assert.match(script,/mode==='once'/);
  assert.match(script,/\['once','watch'\]\.includes\(mode\)/);
  assert.match(script,/SIGINT/);
  assert.match(source,/brokerVerified:false/);
});
