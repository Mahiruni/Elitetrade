#!/usr/bin/env node
// No-network demonstration of a restart-safe signed DEMO telemetry outbox.
// Uses only synthetic prices, ephemeral keys and a temporary local folder.
// NOT a real MT5 companion and NEVER sends trade orders.
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSandboxKeys,createSandboxReplayStore,signBridgePacket,
  verifyBridgePacket} from '../src/elitebridge-protocol.mjs';
import {createOfflineDemoOutbox} from '../src/elitebridge-offline-outbox.mjs';

const accountId=randomUUID(),deviceId=randomUUID(),now=Date.now();
const terminal=createSandboxKeys(),controller=createSandboxKeys();
const directory=await mkdtemp(join(tmpdir(),'elitebridge-demo-outbox-'));
const config={directory,accountId,deviceId,
  terminalPublicKey:terminal.publicKey,controllerPublicKey:controller.publicKey,
  clock:()=>now};
try{
  const offline=createOfflineDemoOutbox(config);
  await offline.enqueue({kind:'terminal.heartbeat',privateKey:terminal.privateKey,
    payload:{accountType:'demo',connected:true,tradeAllowed:false}});
  await offline.enqueue({kind:'terminal.quote',privateKey:terminal.privateKey,
    payload:{accountType:'demo',symbol:'XAUUSDm',bid:4000.25,
      ask:4000.49,observedAt:now}});
  console.log('OFFLINE: 2 signed DEMO packets queued (no network)');
  const afterRestart=createOfflineDemoOutbox(config);
  const packets=await afterRestart.pending();
  if(packets.length!==2)throw Error('outbox was not durable');
  console.log('RESTART: '+packets.length+' queued packets recovered');
  const receiverReplay=createSandboxReplayStore();
  let sequence=0;
  for(const packet of packets){
    const verified=await verifyBridgePacket({
      packet,publicKey:terminal.publicKey,accountId,deviceId,
      role:'terminal',replayStore:receiverReplay,nowMs:now
    });
    if(verified.brokerVerified||verified.actionsAllowed)throw Error('unexpected trade capability');
    sequence++;
    const ack=signBridgePacket({privateKey:controller.privateKey,
      accountId,deviceId,kind:'controller.ack',sequence,
      payload:{receivedMessageId:packet.messageId,accepted:true},
      issuedAt:now,expiresAt:now+60000});
    await afterRestart.acceptSignedReceipt(ack);
    console.log('SIGNED RECEIPT: '+packet.kind+' #'+packet.sequence);
  }
  const status=await afterRestart.inspect();
  if(status.pending!==0||status.acknowledged!==2||status.ordersEnabled)
    throw Error('incomplete offline recovery');
  console.log('ELITEBRIDGE PHASE 5.2 OFFLINE COMPANION PASSED');
  console.log('NO Render, Supabase, MetaApi, MT5, Vercel, or order requests made.');
}finally{
  await rm(directory,{recursive:true,force:true});
}
