#!/usr/bin/env node
// Run this ON a Windows 64-bit PC that has MT5 running in a DEMO account.
// Reads a REAL MT5 quote through MetaQuotes' Python SDK, then signs it with
// a throwaway local test key. NO Supabase/API transmission or orders.
import {spawnSync} from 'node:child_process';
import {createSandboxKeys} from '../src/elitebridge-protocol.mjs';
import {signLocalMt5DemoPackets} from '../src/elitebridge-mt5-terminal-companion.mjs';
import {fileURLToPath} from 'node:url';

async function main(){
  if(process.platform!=='win32'||process.arch!=='x64')
    throw Error('WINDOWS_64BIT_MT5_TERMINAL_REQUIRED');
  const accountId=process.env.ELITEBRIDGE_ACCOUNT_ID;
  const deviceId=process.env.ELITEBRIDGE_DEVICE_ID;
  const expectedLogin=process.env.ELITEBRIDGE_MT5_EXPECT_LOGIN;
  const expectedServer=process.env.ELITEBRIDGE_MT5_EXPECT_SERVER;
  if(!accountId||!deviceId||!expectedLogin||!expectedServer)
    throw Error('MISSING_LOCAL_DEMO_CONFIGURATION');
  const script=fileURLToPath(new URL('../companion/mt5_readonly_probe.py',import.meta.url));
  const result=spawnSync('python',['-I',script],{
    env:{...process.env,PYTHONNOUSERSITE:'1'},encoding:'utf8',
    timeout:20000,maxBuffer:16384,windowsHide:true
  });
  if(result.status!==0){
    // Do not reflect raw stderr: it may contain broker/account or path details.
    const safe=(result.stderr||'').trim();
    const allowed=new Set(['WINDOWS_64BIT_MT5_TERMINAL_REQUIRED','INVALID_EXPECTED_LOGIN',
      'INVALID_EXPECTED_SERVER','INVALID_SYMBOL','INVALID_CLOCK',
      'TERMINAL_UNAVAILABLE','TERMINAL_OR_ACCOUNT_MISSING','TERMINAL_DISCONNECTED',
      'REAL_OR_NONDEMO_ACCOUNT_BLOCKED','ACCOUNT_IDENTITY_MISMATCH',
      'BROKER_SERVER_MISMATCH','QUOTE_UNAVAILABLE','QUOTE_INVALID',
      'QUOTE_STALE_OR_FUTURE','METATRADER5_PYTHON_PACKAGE_REQUIRED','TERMINAL_PROBE_FAILED']);
    throw Error(allowed.has(safe)?safe:'PYTHON_MT5_PROBE_FAILED');
  }
  let observation;
  try{observation=JSON.parse(result.stdout)}catch{throw Error('INVALID_MT5_PROBE_OUTPUT')}
  const {privateKey,publicKey}=createSandboxKeys();
  const signed=await signLocalMt5DemoPackets({
    observation,accountId,deviceId,privateKey,publicKey
  });
  console.log('REAL WINDOWS MT5 DEMO TERMINAL: read-only observation collected');
  console.log('SYMBOL: '+observation.symbol+' | BID: '+observation.bid+' | ASK: '+observation.ask);
  console.log('LOCAL Ed25519 PACKETS VERIFIED: '+signed.packets.length);
  console.log('BROKER VERIFIED BY SERVER: NO (terminal-reported only)');
  console.log('DEVICE ENROLLED: NO | NETWORK REQUESTS: 0 | ORDERS: 0');
  console.log('Next: secure device enrollment + authenticated, replay-safe delivery.');
}
main().catch(e=>{console.error('EliteBridge Phase 7: '+e.message);process.exitCode=1});
