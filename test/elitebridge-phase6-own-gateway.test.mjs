import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createOwnMt5ReadOnlyGateway} from '../src/elitebridge-own-mt5-gateway.mjs';
import {createSupabaseBridgeTelemetry} from '../src/elitebridge-supabase-telemetry.mjs';
import {createSandboxKeys,signBridgePacket} from '../src/elitebridge-protocol.mjs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

const now=Date.parse('2026-10-15T12:00:00Z');
const ownerId=randomUUID(),accountId=randomUUID(),deviceId=randomUUID();
const keys=createSandboxKeys();
const publicKeySpki=keys.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const good={
 accountId,deviceId,lastSequence:2,
 lastReceivedAt:new Date(now-1000).toISOString(),
 heartbeatAt:new Date(now-6000).toISOString(),
 terminalConnectedClaim:true,terminalTradeAllowedClaim:false,
 quote:{symbol:'XAUUSDm',bid:4000.25,ask:4000.39,observedAt:now-2000}
};
function fixture(snapshot=good){
 const calls=[];
 const db={async rpc(name,args){calls.push({name,args});
   if(name!=='elitetrade_bridge_snapshot')throw Error('Unexpected DB call');
   return snapshot;
 }};
 return {db,calls,gateway:createOwnMt5ReadOnlyGateway({db,clock:()=>now})};
}
test('own read-only MT5 gateway gives signed-terminal quote but no broker authorization',async()=>{
 const {gateway,calls}=fixture(),result=await gateway.probe({ownerId,accountId,deviceId});
 assert.equal(result.provider,'elitebridge');
 assert.equal(result.mode,'terminal-telemetry-only');
 assert.equal(result.state,'terminal-reported');
 assert.equal(result.market.state,'terminal-reported');
 assert.equal(result.market.bid,4000.25);
 assert.equal(result.terminal.state,'reporting');
 for(const key of ['brokerVerified','executionEnabled','actionsAllowed','ordersEnabled','independentMT5Connected'])
   assert.equal(result[key],false,key);
 assert.equal(typeof gateway.demoOrder,'undefined');
 assert.equal(typeof gateway.market,'undefined');
 assert.equal(typeof gateway.margin,'undefined');
 assert.equal(typeof gateway.connect,'undefined');
 assert.deepEqual(calls.map(x=>x.name),['elitetrade_bridge_snapshot']);
 assert.deepEqual(calls[0].args,
  {p_owner_id:ownerId,p_account_id:accountId,p_device_id:deviceId});
});
test('no approved device cannot be presented as an MT5 session',async()=>{
 const x=await fixture(null).gateway.probe({ownerId,accountId,deviceId});
 assert.equal(x.state,'no-approved-terminal');
 assert.equal(x.market.state,'not-checked');
 assert.equal(x.brokerVerified,false);
});
test('expired heartbeat, disconnected report and stale quotes fail closed',async()=>{
 for(const snapshot of [
  {...good,heartbeatAt:new Date(now-190000).toISOString()},
  {...good,terminalConnectedClaim:false}
 ]){
  const x=await fixture(snapshot).gateway.probe({ownerId,accountId,deviceId});
  assert.equal(x.state,'terminal-unavailable');
  assert.notEqual(x.market.state,'terminal-reported');
 }
 for(const quote of [
  {...good.quote,observedAt:now-500000},
  {...good.quote,observedAt:now+60000},
  {...good.quote,ask:4000.01},
  {...good.quote,symbol:'EURUSD'}
 ]){
  const x=await fixture({...good,quote}).gateway.probe({ownerId,accountId,deviceId});
  assert.equal(x.market.state,'stale-or-invalid');
 }
});
test('scope validation prevents untrusted SQL probes and missing structured snapshots fail closed',async()=>{
 const f=fixture();
 await assert.rejects(f.gateway.probe({ownerId,accountId,deviceId:'x'}),/invalid identifier/);
 await assert.rejects(f.gateway.probe({ownerId,accountId,deviceId,symbol:'XAUUSD;DROP'}),/invalid symbol/);
 assert.equal(f.calls.length,0);
 await assert.rejects(fixture({...good,accountId:randomUUID()}).gateway.probe({ownerId,accountId,deviceId}),/invalid scoped/);
});
test('feature-gated telemetry invokes new atomic snapshot claim after Ed25519 verification only',async()=>{
 let applied=0;
 const db={async rpc(name,args){
   if(name==='elitetrade_bridge_key')return publicKeySpki;
   if(name==='elitetrade_bridge_record_packet'){
     applied++;
     assert.equal(args.p_payload.accountType,'demo');
     assert.equal(args.p_kind,'terminal.quote');
     return true;
   }
   throw Error('Wrong RPC '+name);
 }};
 const client=createSupabaseBridgeTelemetry({db,recordSnapshots:true,clock:()=>now});
 const msg=signBridgePacket({privateKey:keys.privateKey,accountId,deviceId,
   kind:'terminal.quote',sequence:1,issuedAt:now,expiresAt:now+60000,
   payload:{accountType:'demo',symbol:'XAUUSDm',bid:4000.25,ask:4000.39,observedAt:now}});
 const result=await client.accept({ownerId,packet:msg});
 assert.equal(result.accepted,true);
 assert.equal(result.brokerVerified,false);
 assert.equal(applied,1);
 await assert.rejects(client.accept({ownerId,packet:{...msg,signature:msg.signature.slice(0,-2)+'aa'}}),/signature verification failed/);
 assert.equal(applied,1);
});
test('read-only HTTP terminal probe is disabled until server and migration enabled',async t=>{
 const token='hdr.'+Buffer.from(JSON.stringify({aal:'aal2'})).toString('base64url')+'.sig';
 const db={
  async authUser(access){if(access!==token)throw Error('unauthorized');
    return {id:ownerId,email:'test@example.com',factors:[{status:'verified'}]};
  },
  async one(table,query){
   if(table==='elitetrade_profiles')return {id:ownerId,role:'user',email:'test@example.com',active:true,disabled:false};
   if(table==='elitetrade_accounts'&&query.includes('user_id=eq.'+ownerId))return {id:accountId};
   return null;
  },
  async rpc(){throw Error('Client DB RPC must not be used');}
 };
 const privileged={async rpc(name,args){assert.equal(name,'elitetrade_bridge_snapshot');return good;}};
 async function start(enabled){
   const app=createSupabaseApplication({db,bridgeDb:privileged,gateway:null,
     telegram:null,deviceVerification:false,
     env:{APP_ORIGIN:'http://localhost:3000',ELITEBRIDGE_SNAPSHOT_ENABLED:enabled?'true':'false'}});
   await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
   t.after(()=>app.close());
   const u='http://127.0.0.1:'+app.server.address().port+
     '/api/elitebridge/terminal-probe?accountId='+accountId+'&deviceId='+deviceId;
   return async (tkn=token,suffix='')=>{
     const response=await fetch(u+suffix,{
       headers:{...(tkn?{Authorization:'Bearer '+tkn}:{})}
     });
     return {status:response.status,body:await response.json()};
   };
 }
 const off=await start(false);
 assert.equal((await off()).status,503);
 const on=await start(true);
 assert.equal((await on('')).status,401);
 const valid=await on();
 assert.equal(valid.status,200);
 assert.equal(valid.body.brokerVerified,false);
 assert.equal(valid.body.market.state,'terminal-reported');
 assert.equal((await on(token,'&symbol=%3B')).status,400);
});
