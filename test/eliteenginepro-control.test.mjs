import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
import {createEngineProLedger,executionSignalKey,validateIntentCommand,assertIndependentDemoAdapter} from '../src/eliteenginepro-ledger.mjs';
import {createCloudMt5Observer} from '../src/elitebridge-cloud-mt5-observer.mjs';
const account='11111111-2222-4333-8444-555555555555',bot='22222222-2222-4333-8444-555555555555';
const owner='33333333-2222-4333-8444-555555555555';
const command={symbol:'XAUUSDm',side:'buy',volume:'0.01',stopLoss:'2000.00',takeProfit:'2010.00'};
test('signal identity is stable across restart and independent of config version',()=>{
 const signal={accountId:account,botId:bot,timeframe:'M1',candleTime:1760000000,side:'buy',signalFamily:'ema-pullback'};
 assert.equal(executionSignalKey(signal),executionSignalKey({...signal,strategyVersion:'changed'}));
 assert.notEqual(executionSignalKey(signal),executionSignalKey({...signal,candleTime:1760000060}));
 assert.throws(()=>executionSignalKey({...signal,candleTime:NaN}));
 assert.throws(()=>validateIntentCommand({...command,password:'forbidden-fixture'}));
 assert.throws(()=>validateIntentCommand({...command,volume:0.01}));
 assert.throws(()=>validateIntentCommand({...command,volume:'NaN'}));
});
test('actual read-only gateway cannot satisfy the execution adapter contract',()=>{
 const observer=createCloudMt5Observer({endpoint:'https://private.example.test',token:'fixture-token'});
 assert.throws(()=>assertIndependentDemoAdapter(observer),/not commissioned/);
 assert.throws(()=>assertIndependentDemoAdapter({schema:'elitebridge-demo-execution-v1',provider:'metaapi'}));
});
test('worker client preserves bigint epoch strings and has no broker fallback',async()=>{
 const calls=[],db={rpc:async(...args)=>{calls.push(args);return null;}};
 const client=createEngineProLedger({db,ownerId:owner});
 await client.claim(account);
 await client.prepare({accountId:account,botId:bot,generation:'9007199254740993',strategyVersion:'a'.repeat(64),signalKey:'b'.repeat(64),command});
 await client.load(bot,'9007199254740993');
 assert.equal(calls[1][1].p_epoch,'9007199254740993');
 assert.equal(calls[2][0],'elitetrade_enginepro_load');
 assert.equal(calls.every(([name])=>name.startsWith('elitetrade_enginepro_')),true);
 assert.throws(()=>client.advance(bot,1,'submitting'),/fence/);
});
test('account controls preserve owner permissions, empty stop request and safe failure states',async t=>{
 const calls=[];let unavailable=false;
 const db={authUser:async()=>({id:'owner',factors:[]}),one:async(table,where)=>{
  if(table==='elitetrade_profiles')return {id:'owner',role:'user',active:true,disabled:false};
  if(table==='elitetrade_accounts')return where.includes('id=eq.'+account)&&where.includes('user_id=eq.owner')?{id:account}:null;
 },rpc:async(name,args,token)=>{
  calls.push({name,args,token});if(unavailable)throw Error('private runtime address and password');
  return {accountId:account,killSwitch:true,positionsClosed:false,executionEnabled:false};
 }};
 const app=createSupabaseApplication({db,deviceVerification:false,env:{APP_ORIGIN:'http://localhost:3000'},gateway:null,telegram:null});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const request=async({id=account,stop=false,auth=true,body={},origin}={})=>{
  const r=await fetch('http://127.0.0.1:'+app.server.address().port+'/api/engine/pro/accounts/'+id+(stop?'/stop':''),{
   method:stop?'POST':'GET',headers:{...(auth?{Authorization:'Bearer owner-token'}:{}),...(stop?{'Content-Type':'application/json'}:{}),...(origin?{Origin:origin}:{})},
   ...(stop?{body:JSON.stringify(body)}:{})});return {status:r.status,headers:r.headers,data:await r.json()};
 };
 assert.equal((await request({auth:false})).status,401);
 assert.equal((await request({id:bot,stop:true})).status,404);
 assert.equal((await request({stop:true,body:{resume:true}})).status,400);
 assert.equal((await request({stop:true,origin:'https://other.example.test'})).status,403);
 assert.equal(calls.length,0);
 const r=await request();assert.equal(r.status,200);assert.equal(calls[0].args.p_stop,false);
 assert.equal(r.headers.get('cache-control'),'private, no-store');
 const stopped=await request({stop:true});assert.equal(stopped.data.killSwitch,true);
 assert.equal(stopped.data.positionsClosed,false);assert.equal(calls[1].token,'owner-token');
 assert.equal(calls[1].args.p_stop,true);
 unavailable=true;const error=await request({stop:true});
 assert.equal(error.status,503);assert.match(error.data.error,/not confirmed/);
 assert.doesNotMatch(JSON.stringify(error.data),/private runtime|password/);
});
