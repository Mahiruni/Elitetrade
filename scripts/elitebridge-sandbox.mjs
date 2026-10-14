#!/usr/bin/env node
// Safe no-network protocol simulator for Termux. No .env, credentials or orders.
import {randomUUID} from 'node:crypto';
import {createSandboxKeys,createSandboxReplayStore,signBridgePacket,
  verifyBridgePacket,eliteBridgeProtocolStatus} from '../src/elitebridge-protocol.mjs';
const accountId=randomUUID(),deviceId=randomUUID(),now=Date.now();
const {publicKey,privateKey}=createSandboxKeys(),replayStore=createSandboxReplayStore();
async function check(kind,payload,sequence){
  const packet=signBridgePacket({privateKey,accountId,deviceId,kind,payload,sequence,
    issuedAt:now,expiresAt:now+60000});
  const args={packet,publicKey,accountId,deviceId,role:'terminal',replayStore,nowMs:now};
  const result=await verifyBridgePacket(args);
  console.log('SIGNATURE OK: '+result.kind+' #'+result.sequence+' · trading disabled');
  try{
    await verifyBridgePacket(args);
    throw new Error('FATAL: replay accepted');
  }catch(e){
    if(e.message.startsWith('FATAL'))throw e;
    console.log('REPLAY REJECTED: #'+sequence);
  }
}
await check('terminal.heartbeat',{accountType:'demo',connected:true,tradeAllowed:true},1);
await check('terminal.quote',{accountType:'demo',symbol:'XAUUSDm',
  bid:4050.25,ask:4050.54,observedAt:now},2);
console.log('ELITEBRIDGE PHASE 3 SANDBOX PASSED');
console.log('Independent MT5: '+eliteBridgeProtocolStatus().state+' · not connected');
console.log('No broker, MetaApi, Supabase, or Vercel requests made.');
