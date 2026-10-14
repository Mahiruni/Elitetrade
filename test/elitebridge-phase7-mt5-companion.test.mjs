import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createSandboxKeys,verifyBridgePacket,createSandboxReplayStore} from '../src/elitebridge-protocol.mjs';
import {signLocalMt5DemoPackets,validateMt5ReadOnlyObservation} from '../src/elitebridge-mt5-terminal-companion.mjs';
import {readFileSync} from 'node:fs';

const now=Date.parse('2026-10-15T12:00:00Z');
const accountId=randomUUID(),deviceId=randomUUID();
const observation={
 source:'mt5-python-terminal',accountType:'demo',
 terminalConnectedClaim:true,terminalTradeAllowedClaim:false,
 symbol:'XAUUSDm',bid:4000.25,ask:4000.50,
 observedAt:now-1000,collectedAt:now,
 brokerVerified:false,ordersEnabled:false
};
const keys=createSandboxKeys();

test('signed packets from real-terminal observation match EliteBridge v3 cryptographic verification',async()=>{
 const result=await signLocalMt5DemoPackets({observation,accountId,deviceId,
   privateKey:keys.privateKey,publicKey:keys.publicKey,nowMs:now});
 assert.deepEqual(result.packets.map(p=>p.kind),['terminal.heartbeat','terminal.quote']);
 assert.deepEqual(result.packets.map(p=>p.sequence),[1,2]);
 assert.equal(result.transmitted,false);
 assert.equal(result.deviceEnrolled,false);
 assert.equal(result.ordersEnabled,false);
 const replayStore=createSandboxReplayStore();
 for(const packet of result.packets){
   const verified=await verifyBridgePacket({packet,publicKey:keys.publicKey,
     accountId,deviceId,role:'terminal',nowMs:now,replayStore});
   assert.equal(verified.verified,true);
   assert.equal(verified.brokerVerified,false);
   assert.equal(verified.actionsAllowed,false);
   await assert.rejects(verifyBridgePacket({packet,publicKey:keys.publicKey,
     accountId,deviceId,role:'terminal',nowMs:now,replayStore}),/replay or out-of-order sequence/);
 }
});

test('reject REAL accounts, fake broker verified flags and trade-enabled observations',()=>{
 for(const changes of [
  {accountType:'real'}, {terminalConnectedClaim:false},
  {terminalTradeAllowedClaim:true},{brokerVerified:true},
  {ordersEnabled:true}, {source:'metaapi'},
  {danger:'untrusted'}, {symbol:';DROP'},
  {bid:0},{bid:NaN},{ask:Infinity},{ask:4000.00},
  {observedAt:now-500000}, {observedAt:now+90000},
  {collectedAt:now-190000},{collectedAt:now+90000}
 ]){
   assert.throws(()=>validateMt5ReadOnlyObservation({...observation,...changes},{nowMs:now}));
 }
});

test('wrong expected device, missing signer or malformed keys fail closed',async()=>{
 await assert.rejects(signLocalMt5DemoPackets({observation,accountId,
   deviceId:'not-uuid',privateKey:keys.privateKey,publicKey:keys.publicKey,nowMs:now}),
   /valid local account and device scope/);
 await assert.rejects(signLocalMt5DemoPackets({observation,accountId,
   deviceId,privateKey:keys.privateKey,publicKey:createSandboxKeys().publicKey,nowMs:now}),
   /signature verification failed/);
});

test('Windows companion cannot transmit to broker or Supabase in Phase 7',()=>{
 const script=readFileSync(new URL('../scripts/elitebridge-mt5-probe.mjs',import.meta.url),'utf8');
 const node=readFileSync(new URL('../src/elitebridge-mt5-terminal-companion.mjs',import.meta.url),'utf8');
 const py=readFileSync(new URL('../companion/mt5_readonly_probe.py',import.meta.url),'utf8');
 assert.doesNotMatch(script,/fetch\(|https\.request|http\.request|demoOrder\(|order_send\(/);
 assert.doesNotMatch(node,/fetch\(|https\.request|http\.request|demoOrder\(|order_send\(/);
 assert.doesNotMatch(py,/^\s*mt5\.(?:order_send|login)\(/m);
 assert.match(script,/createSandboxKeys\(\)/);
});
