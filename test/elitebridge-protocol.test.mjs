import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSandboxKeys,createSandboxReplayStore,signBridgePacket,verifyBridgePacket,
 eliteBridgeProtocolStatus} from '../src/elitebridge-protocol.mjs';
function fixture(){
 const accountId=randomUUID(),deviceId=randomUUID(),now=Date.parse('2026-10-14T20:30:00Z');
 const {privateKey,publicKey}=createSandboxKeys(),replayStore=createSandboxReplayStore();
 const source={privateKey,accountId,deviceId,sequence:1,issuedAt:now,expiresAt:now+60000,
   kind:'terminal.heartbeat',payload:{accountType:'demo',connected:true,tradeAllowed:true}};
 const check=(packet,rest={})=>verifyBridgePacket({packet,publicKey,accountId,deviceId,role:'terminal',
   replayStore,nowMs:now,...rest});
 return {accountId,deviceId,now,privateKey,publicKey,replayStore,source,check};
}
test('signed heartbeat verifies, but duplicate and lower sequence fail',async()=>{
 const x=fixture(),p=signBridgePacket(x.source);
 assert.deepEqual(await x.check(p),{verified:true,kind:'terminal.heartbeat',sequence:1,
   brokerVerified:false,actionsAllowed:false,demoOnly:true});
 await assert.rejects(x.check(p),/replay/);
 const old=signBridgePacket({...x.source,sequence:1});
 await assert.rejects(x.check(old),/replay/);
});
test('tampering fields, payload, timestamp, message ID fails authentication',async()=>{
 for(const edit of [
  p=>({...p,payload:{...p.payload,connected:false}}),
  p=>({...p,issuedAt:p.issuedAt+1000}),
  p=>({...p,messageId:'abcdefabcdefabcdefabcdefabcdefab'}),
 ]){
  const x=fixture(),p=signBridgePacket(x.source);
  await assert.rejects(x.check(edit(p)),/signature/);
 }
});
test('wrong device/account/public key/role fails before replay record',async()=>{
 const x=fixture(),p=signBridgePacket(x.source);
 await assert.rejects(x.check(p,{deviceId:randomUUID()}),/scope/);
 await assert.rejects(x.check(p,{accountId:randomUUID()}),/scope/);
 await assert.rejects(x.check(p,{role:'controller'}),/role/);
 await assert.rejects(x.check(p,{publicKey:createSandboxKeys().publicKey}),/signature/);
});
test('REAL account, unsafe fields, and trade commands are never signable',()=>{
 const x=fixture();
 for(const payload of [
  {accountType:'real',connected:true,tradeAllowed:true},
  {accountType:'demo',connected:true,tradeAllowed:true,password:'leak'}
 ])assert.throws(()=>signBridgePacket({...x.source,payload}),/REAL|fields/);
 assert.throws(()=>signBridgePacket({...x.source,kind:'terminal.trade',payload:{}}),/kind/);
 assert.throws(()=>signBridgePacket({...x.source,sequence:0}),/sequence/);
});
test('missing durable anti-replay store and extra packet properties fail closed',async()=>{
 const x=fixture(),p=signBridgePacket(x.source);
 await assert.rejects(x.check(p,{replayStore:null}),/atomic/);
 await assert.rejects(x.check({...p,trade:true}),/unexpected signed fields/);
});
test('expires, excessive future skew and stale quote block validation',async()=>{
 const x=fixture(),p=signBridgePacket(x.source);
 await assert.rejects(x.check(p,{nowMs:x.now+120000}),/expired/);
 const future=signBridgePacket({...x.source,issuedAt:x.now+40000,expiresAt:x.now+100000});
 await assert.rejects(x.check(future),/future/);
 const q=signBridgePacket({...x.source,kind:'terminal.quote',
   payload:{accountType:'demo',symbol:'XAUUSDm',bid:4000,ask:4001,observedAt:x.now-200000}});
 await assert.rejects(x.check(q),/quote/);
});
test('signed safe ACK does not authorize broker orders',async()=>{
 const x=fixture(),p=signBridgePacket({...x.source,kind:'controller.ack',
  payload:{receivedMessageId:'abcdefabcdefabcdefabcdefabcdefab',accepted:true}});
 const data=await x.check(p,{role:'controller'});
 assert.equal(data.actionsAllowed,false);
 assert.throws(()=>signBridgePacket({...x.source,kind:'controller.ack',
  payload:{receivedMessageId:'abcdefabcdefabcdefabcdefabcdefab',accepted:true,trade:true}}),/fields/);
});
test('Phase 3 capabilities declare unpaired, never broker-connected',()=>{
 const x=eliteBridgeProtocolStatus();
 assert.equal(x.version,3);assert.equal(x.state,'sandbox-only');
 assert.equal(x.pairingEnabled,false);assert.equal(x.brokerVerified,false);
 assert.equal(x.independentMT5Connected,false);assert.equal(x.ordersEnabled,false);
});
