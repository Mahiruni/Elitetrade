#!/usr/bin/env node
// NO broker, network access, orders or persistent secrets. For Android Termux.
import {randomUUID} from 'node:crypto';
import {createSandboxKeys,createSandboxReplayStore,signBridgePacket} from '../src/elitebridge-protocol.mjs';
import {signLiveObservation,verifyLiveObservation} from '../src/elitebridge-live-observation.mjs';

const accountId=randomUUID(),deviceId=randomUUID(),now=Date.now();
const {privateKey,publicKey}=createSandboxKeys(),store=createSandboxReplayStore();
const packets=[
  signLiveObservation({privateKey,accountId,deviceId,sequence:1,
    kind:'terminal.heartbeat',issuedAt:now,
    payload:{accountType:'real',connected:true,tradeAllowed:false}}),
  signLiveObservation({privateKey,accountId,deviceId,sequence:2,
    kind:'terminal.quote',issuedAt:now,
    payload:{accountType:'real',symbol:'XAUUSDm',bid:4000.25,ask:4000.45,observedAt:now}})
];
for(const packet of packets){
  const args={packet,publicKey,accountId,deviceId,replayStore:store,nowMs:now};
  const verified=await verifyLiveObservation(args);
  if(!verified.verified||verified.ordersEnabled||verified.brokerVerified)
    throw Error('Unsafe sandbox verification state');
  try{
    await verifyLiveObservation(args);
    throw Error('FATAL: replay accepted');
  }catch(e){if(e.message.startsWith('FATAL'))throw e;}
  console.log('REAL OBSERVATION SIGNATURE VERIFIED · #'+packet.sequence+' · REPLAY REJECTED');
}
try{
  signBridgePacket({privateKey,accountId,deviceId,sequence:3,
    kind:'terminal.heartbeat',issuedAt:now,
    payload:{accountType:'real',connected:true,tradeAllowed:true}});
  throw Error('FATAL: protocol v3 accepted REAL');
}catch(e){if(e.message.startsWith('FATAL'))throw e;}
console.log('PASS: DEMO v3 and REAL v4 are isolated');
console.log('BROKER VERIFIED: NO · NETWORK: NONE · REAL ORDERS: DISABLED');
