#!/usr/bin/env node
// A one-shot, explicit Windows MT5 read-only publisher. No MT5 login/orders.
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {
  initializeTerminalIdentity,reserveTerminalSequences,validateTerminalObservation,
  createTerminalPackets,sendTerminalPackets,signLocalPairingProof
} from '../src/elitebridge-terminal-uplink.mjs';

function abort(message){
  console.error('ELITEBRIDGE: '+message);
  process.exitCode=1;
}
async function main(){
  const op=process.argv[2];
  const directory=process.env.ELITEBRIDGE_LOCAL_HOME ||
    join(homedir(),'.elitetrade','bridge-terminal');
  if(op==='init'){
    const publicIdentity=initializeTerminalIdentity(directory);
    // Only the public key is printed for manual server-side enrollment.
    console.log('PUBLIC KEY FINGERPRINT SHA256: '+publicIdentity.fingerprint);
    console.log(publicIdentity.publicKeyPem.trim());
    console.log('Local private key remains in your user profile; never upload it.');
    console.log('Register this public key on the trusted admin page, approve it,');
    console.log('then set ELITEBRIDGE_ACCOUNT_ID and ELITEBRIDGE_TERMINAL_ID.');
    return;
  }
  if(op==='prove'){
    const challenge=process.argv[3];
    if(!challenge)throw Error('Pairing challenge argument required');
    const proof=signLocalPairingProof({directory,challenge});
    console.log('PAIRING KEY FINGERPRINT SHA256: '+proof.fingerprint);
    console.log('PAIRING PROOF SIGNATURE: '+proof.signature);
    console.log('Submit only the signature to the administrator prove endpoint.');
    console.log('BROKER VERIFIED: NO | ORDERS ENABLED: NO');
    return;
  }
  if(op!=='publish'){
    console.log('Commands: init | prove <challenge> | publish (Windows MT5 only)');
    return;
  }
  if(process.platform!=='win32' || process.arch!=='x64')
    throw Error('64-bit Windows and a locally running MT5 terminal are required');
  const mode=process.env.ELITEBRIDGE_MT5_EXPECT_MODE;
  const accountId=process.env.ELITEBRIDGE_ACCOUNT_ID;
  const deviceId=process.env.ELITEBRIDGE_TERMINAL_ID;
  if(!['demo','real'].includes(mode))
    throw Error('Explicit ELITEBRIDGE_MT5_EXPECT_MODE=demo or real required');
  if(!process.env.ELITEBRIDGE_MT5_EXPECT_LOGIN ||
     !process.env.ELITEBRIDGE_MT5_EXPECT_SERVER)
    throw Error('Expected MT5 account login and broker server required');
  if(!accountId||!deviceId)
    throw Error('Approved local account and terminal IDs required');
  const script=fileURLToPath(new URL('../companion/mt5_readonly_probe.py',import.meta.url));
  const child=spawnSync('python',[script],{
    encoding:'utf8',timeout:20000,maxBuffer:4096,shell:false,
    windowsHide:true,env:process.env
  });
  if(child.error||child.status!==0)
    throw Error('Read-only Windows MT5 terminal probe refused this session');
  let observation;
  try{observation=JSON.parse(child.stdout);}
  catch{throw Error('MT5 terminal observation was not valid JSON');}
  validateTerminalObservation(observation,{mode});
  // Persist fresh monotonic sequence numbers BEFORE creating any signatures.
  const reserved=reserveTerminalSequences({directory,accountId,deviceId});
  const packets=createTerminalPackets({
    observation,accountId,deviceId,mode,privateKey:reserved.privateKey,
    sequences:reserved.sequences
  });
  const response=await sendTerminalPackets({
    packets,endpoint:process.env.ELITEBRIDGE_TELEMETRY_URL ||
      'https://elitetradee.vercel.app/api/elitebridge/telemetry'
  });
  console.log('SIGNED TERMINAL TELEMETRY ACCEPTED: '+response.accepted.join(', '));
  console.log('MODE: '+mode.toUpperCase()+' | BROKER VERIFIED BY CLOUD: NO | ORDERS: DISABLED');
}
main().catch(e=>abort(e?.message?.startsWith('EliteBridge terminal uplink:')?
  e.message:'Terminal uplink unavailable: '+String(e.message||'Unknown error').slice(0,160)));
