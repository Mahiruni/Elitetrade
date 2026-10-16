import test from 'node:test';
import assert from 'node:assert/strict';
import {createEliteEngineProRuntime,probeSdkCompatibility,validateSdkCompatibility} from '../src/eliteenginepro-runtime.mjs';
const metadata={platform:'win32',pointerBits:64,pythonVersion:'3.12.10',sdkVersion:'5.0.6231',
  numpyVersion:'2.5.4',sdkImportable:true,terminalPresent:false,brokerAuthenticated:false,executionEnabled:false};
test('SDK compatibility evidence cannot assert terminal/broker/execution readiness',()=>{
  assert.deepEqual(validateSdkCompatibility({...metadata,password:'not-forwarded'}),metadata);
  for(const change of [{platform:'linux'},{pointerBits:32},{sdkImportable:false},
    {terminalPresent:true},{brokerAuthenticated:true},{executionEnabled:true},{sdkVersion:'arbitrary secret'}])
    assert.throws(()=>validateSdkCompatibility({...metadata,...change}));
});
test('actual child probe allowlists output and sanitizes stderr/nonzero failures',async()=>{
  const result=await probeSdkCompatibility({executable:process.execPath,
    args:['-e',`console.log(JSON.stringify(${JSON.stringify(metadata)}))`]});
  assert.deepEqual(result,metadata);
  await assert.rejects(probeSdkCompatibility({executable:process.execPath,
    args:['-e','console.error("private-detail");process.exitCode=7']}),/SDK_COMPATIBILITY_FAILED/);
  await assert.rejects(probeSdkCompatibility({executable:process.execPath,
    args:['-e','setTimeout(()=>{},10000)'],timeoutMs:100}),/SDK_COMPATIBILITY_FAILED/);
});
test('free compatibility service health separates SDK evidence from broker and persistence',async t=>{
  let release;const app=createEliteEngineProRuntime({probe:()=>new Promise(r=>{release=r;})});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const get=async path=>{const r=await fetch(base+path);return {status:r.status,data:await r.json(),cache:r.headers.get('cache-control')};};
  const running=app.start();const pending=await get('/health');
  assert.equal(pending.data.state,'checking-sdk');assert.equal(pending.data.brokerAuthenticated,false);
  release(metadata);await running;
  const ready=await get('/health');assert.equal(ready.status,200);assert.equal(ready.cache,'no-store');
  assert.equal(ready.data.service,'EliteEnginePro');assert.equal(ready.data.sdkCompatibility,'passed');
  assert.equal(ready.data.persistenceVerified,false);assert.equal(ready.data.executionEnabled,false);
  assert.equal((await get('/snapshot')).status,404);assert.equal((await get('/orders')).status,404);
});
test('failed compatibility check stays blocked and late completion cannot revive a stopped service',async()=>{
  const errors=[];const failed=createEliteEngineProRuntime({probe:async()=>{throw Error('private');},audit:x=>errors.push(x)});
  await failed.start();assert.equal(failed.status().state,'blocked');assert.ok(!JSON.stringify(errors).includes('private'));
  await failed.close();
  let finish;const app=createEliteEngineProRuntime({probe:()=>new Promise(r=>{finish=r;})});
  app.start();const stopped=app.close();finish(metadata);await stopped;
  assert.equal(app.status().state,'stopped');assert.equal(app.status().brokerAuthenticated,false);
});
