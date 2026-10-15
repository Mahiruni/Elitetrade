import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
  initializeTerminalIdentity,terminalFingerprint,reserveTerminalSequences,
  validateTerminalObservation,createTerminalPackets,checkedTelemetryEndpoint,
  sendTerminalPackets
} from '../src/elitebridge-terminal-uplink.mjs';
import {verifyBridgePacket,createSandboxReplayStore} from '../src/elitebridge-protocol.mjs';
import {verifyLiveObservation} from '../src/elitebridge-live-observation.mjs';

const now=Date.now();
const accountId=randomUUID(),deviceId=randomUUID();
const observation=(mode='real')=>({
  source:'mt5-python-terminal',accountType:mode,terminalConnectedClaim:true,
  terminalTradeAllowedClaim:false,symbol:'XAUUSDm',bid:4000.25,ask:4000.50,
  observedAt:Date.now()-1000,collectedAt:Date.now(),
  brokerVerified:false,ordersEnabled:false
});
const temp=t=>{
  const dir=mkdtempSync(join(tmpdir(),'elitebridge-uplink-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return dir;
};
test('local private identity never regenerates, and sequence ledger survives process restarts',t=>{
  const dir=temp(t);
  const initial=initializeTerminalIdentity(dir);
  assert.match(initial.publicKeyPem,/BEGIN PUBLIC KEY/);
  assert.match(initial.fingerprint,/^[a-f0-9]{64}$/);
  assert.equal(terminalFingerprint(initial.publicKeyPem),initial.fingerprint);
  assert.deepEqual(initializeTerminalIdentity(dir),initial);
  assert.equal(existsSync(join(dir,'private.pem')),true);
  const first=reserveTerminalSequences({directory:dir,accountId,deviceId});
  assert.deepEqual(first.sequences,[1,2]);
  const second=reserveTerminalSequences({directory:dir,accountId,deviceId});
  assert.deepEqual(second.sequences,[3,4]);
  const data=JSON.parse(readFileSync(join(dir,'sequence.json'),'utf8'));
  assert.equal(data.lastSequence,4);
  assert.equal(data.fingerprint,initial.fingerprint);
  assert.throws(()=>reserveTerminalSequences({directory:dir,accountId,
    deviceId:randomUUID()}),/sequence identity changed/);
  const third=reserveTerminalSequences({directory:dir,accountId,deviceId});
  assert.deepEqual(third.sequences,[5,6]);
});
test('corrupt ledger, stale lock, and private-key identity replacement fail closed',t=>{
  const dir=temp(t);
  initializeTerminalIdentity(dir);
  reserveTerminalSequences({directory:dir,accountId,deviceId});
  writeFileSync(join(dir,'sequence.lock'),'locked',{flag:'wx'});
  assert.throws(()=>reserveTerminalSequences({directory:dir,accountId,deviceId}),/sequence is locked/);
  rmSync(join(dir,'sequence.lock'));
  writeFileSync(join(dir,'sequence.json'),'invalid-json');
  assert.throws(()=>reserveTerminalSequences({directory:dir,accountId,deviceId}),/sequence ledger is corrupt/);
  assert.equal(existsSync(join(dir,'sequence.lock')),false);
});
test('REAL and DEMO packets are signed independently, accepted only by matching protocol',async t=>{
  const dir=temp(t);initializeTerminalIdentity(dir);
  for(const mode of ['real','demo']){
    const {sequences,privateKey}=reserveTerminalSequences({directory:dir,accountId,deviceId});
    const obs=observation(mode);
    const packets=createTerminalPackets({observation:obs,accountId,deviceId,
      privateKey,sequences,mode,nowMs:Date.now()});
    assert.deepEqual(packets.map(p=>p.kind),['terminal.heartbeat','terminal.quote']);
    assert.equal(packets[0].payload.tradeAllowed,false);
    assert.deepEqual(packets.map(p=>p.version),mode==='demo'?[3,3]:[4,4]);
    for(const packet of packets){
      const key=initializeTerminalIdentity(dir).publicKeyPem;
      const opts={packet,publicKey:key,accountId,deviceId,
        nowMs:Date.now(),replayStore:createSandboxReplayStore()};
      const verified=mode==='real'?await verifyLiveObservation(opts):
        await verifyBridgePacket({...opts,role:'terminal'});
      assert.equal(verified.brokerVerified,false);
      assert.equal(mode==='real'?verified.ordersEnabled:verified.actionsAllowed,false);
    }
  }
});
test('rejects mismatched REAL/DEMO, stale, trade-enabled, forged and unauthenticated observations',()=>{
  const valid=observation();
  assert.throws(()=>validateTerminalObservation(valid,{mode:'demo'}),/mode mismatch/);
  assert.throws(()=>validateTerminalObservation({...valid,terminalConnectedClaim:false},{mode:'real'}),/invalid read-only/);
  assert.throws(()=>validateTerminalObservation({...valid,terminalTradeAllowedClaim:true},{mode:'real'}),/invalid read-only/);
  assert.throws(()=>validateTerminalObservation({...valid,brokerVerified:true},{mode:'real'}),/invalid read-only/);
  assert.throws(()=>validateTerminalObservation({...valid,ordersEnabled:true},{mode:'real'}),/invalid read-only/);
  assert.throws(()=>validateTerminalObservation({...valid,symbol:'XAUUSDm;DROP'},{mode:'real'}),/invalid quote/);
  assert.throws(()=>validateTerminalObservation({...valid,observedAt:Date.now()-300000},{mode:'real'}),/stale or future/);
  assert.throws(()=>validateTerminalObservation({...valid,ask:NaN},{mode:'real'}),/invalid quote/);
  assert.throws(()=>validateTerminalObservation({...valid,extra:'order'},{mode:'real'}),/invalid read-only/);
});
test('uplink refuses domain changes, redirects, duplicate requests and non-read-only acknowledgments',async t=>{
  const dir=temp(t);initializeTerminalIdentity(dir);
  const reserved=reserveTerminalSequences({directory:dir,accountId,deviceId});
  const packets=createTerminalPackets({observation:observation(),mode:'real',
    accountId,deviceId,privateKey:reserved.privateKey,sequences:reserved.sequences});
  const target='https://elitetradee.vercel.app/api/elitebridge/telemetry';
  assert.equal(checkedTelemetryEndpoint(target),target);
  for(const url of [
    'http://elitetradee.vercel.app/api/elitebridge/telemetry',
    'https://evil.example/api/elitebridge/telemetry',
    'https://elitetradee.vercel.app.evil.example/api/elitebridge/telemetry',
    'https://elitetradee.vercel.app/api/orders',
    'https://elitetradee.vercel.app/api/elitebridge/telemetry?token=abc'
  ])assert.throws(()=>checkedTelemetryEndpoint(url),/exact authorized HTTPS/);
  const accepted=[];
  const success=async (_url,options)=>{
    assert.equal(options.redirect,'error');
    assert.equal(options.credentials,'omit');
    const packet=JSON.parse(options.body).packet;
    accepted.push(packet.sequence);
    return {ok:true,json:async()=>({accepted:true,kind:packet.kind,
      sequence:packet.sequence,accountMode:packet.payload.accountType,readOnly:true,
      brokerVerified:false,ordersEnabled:false})};
  };
  const sent=await sendTerminalPackets({endpoint:target,packets,fetcher:success});
  assert.deepEqual(sent.accepted,reserved.sequences);
  assert.deepEqual(accepted,reserved.sequences);
  await assert.rejects(()=>sendTerminalPackets({endpoint:target,packets,fetcher:async()=>({
    ok:true,json:async()=>({accepted:true,kind:'terminal.quote',sequence:1,
      accountMode:'real',readOnly:true,brokerVerified:true,ordersEnabled:false})
  })}),/untrusted cloud acknowledgment/);
  await assert.rejects(()=>sendTerminalPackets({endpoint:target,packets,fetcher:async()=>({
    ok:false,status:403
  })}),/cloud rejected telemetry/);
  await assert.rejects(()=>sendTerminalPackets({endpoint:target,packets,fetcher:async()=>{throw Error('timeout');}}),
    /HTTPS delivery unavailable/);
});
test('Windows-only publisher cannot place REAL trades or publish from Android',()=>{
  const script=readFileSync(new URL('../scripts/elitebridge-terminal-uplink.mjs',import.meta.url),'utf8');
  const module=readFileSync(new URL('../src/elitebridge-terminal-uplink.mjs',import.meta.url),'utf8');
  const py=readFileSync(new URL('../companion/mt5_readonly_probe.py',import.meta.url),'utf8');
  assert.doesNotMatch(script+module,/order_send\s*\(|demoOrder\s*\(|realOrder\s*\(/);
  assert.doesNotMatch(py,/^\s*mt5\.order_send\s*\(/m);
  assert.match(script,/process\.platform!=='win32'/);
  const env={...process.env,ELITEBRIDGE_LOCAL_HOME:join(tmpdir(),'unused-temp-test')};
  const result=spawnSync(process.execPath,['scripts/elitebridge-terminal-uplink.mjs','publish'],
    {encoding:'utf8',env,timeout:10000});
  if(process.platform!=='win32'){
    assert.equal(result.status,1);
    assert.match(result.stderr,/64-bit Windows/);
  }
  assert.doesNotMatch(module,/MetaApi|MT5_GATEWAY_TOKEN|SUPABASE_SECRET_KEY/);
});
