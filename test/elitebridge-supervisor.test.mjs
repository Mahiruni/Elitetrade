import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {acquireTerminalWatchLock,superviseTerminalTelemetry,telemetryRetryDelay,retryableProbeFailure} from '../src/elitebridge-supervisor.mjs';
import {initializeTerminalIdentity,reserveTerminalSequences,createTerminalPackets,sendTerminalPackets} from '../src/elitebridge-terminal-uplink.mjs';

test('lost quote acknowledgment triggers fresh collection and durable new sequences, never packet replay',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'bridge-watch-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  initializeTerminalIdentity(directory);
  const accountId=randomUUID(),deviceId=randomUUID(),sent=[],statuses=[],delays=[];
  let collections=0,lastAccepted=0;
  const result=await superviseTerminalTelemetry({maxCycles:2,random:()=>.5,
    wait:async ms=>{delays.push(ms);},onStatus:s=>statuses.push(s),
    publish:async()=>{
      collections++;
      const now=Date.now(),reserved=reserveTerminalSequences({directory,accountId,deviceId});
      const observation={source:'mt5-python-terminal',accountType:'demo',terminalConnectedClaim:true,
        terminalTradeAllowedClaim:false,symbol:'XAUUSDm',bid:4000+collections,ask:4001+collections,
        observedAt:now,collectedAt:now,brokerVerified:false,ordersEnabled:false};
      const packets=createTerminalPackets({observation,accountId,deviceId,mode:'demo',
        privateKey:reserved.privateKey,sequences:reserved.sequences,nowMs:now});
      await sendTerminalPackets({packets,endpoint:'https://elitetradee.vercel.app/api/elitebridge/telemetry',
        fetcher:async(_,options)=>{
          const packet=JSON.parse(options.body).packet;
          sent.push(packet);
          assert.ok(packet.sequence>lastAccepted);
          lastAccepted=packet.sequence; // Accepted by server BEFORE response is lost.
          if(packet.sequence===2)throw Error('Secret transport details must stay private');
          return {ok:true,json:async()=>({accepted:true,kind:packet.kind,sequence:packet.sequence,
            accountMode:'demo',brokerVerified:false,ordersEnabled:false,readOnly:true})};
        }});
      return {accepted:true};
    }});
  assert.deepEqual(sent.map(p=>p.sequence),[1,2,3,4]);
  assert.equal(new Set(sent.map(p=>p.messageId)).size,4);
  assert.equal(sent[1].payload.bid,4001);
  assert.equal(sent[3].payload.bid,4002);
  assert.equal(collections,2);
  assert.equal(result.acceptedCycles,1);
  assert.deepEqual(statuses.map(s=>s.state),['backoff','receipts-confirmed','stopped']);
  assert.deepEqual(delays,[15000]);
  assert.doesNotMatch(JSON.stringify(statuses),/Secret transport|4001|privateKey/);
});

test('retry budget is bounded, resets on success, and permanent failures halt immediately',async()=>{
  const transient=()=>Object.assign(Error('private detail'),{retryable:true});
  let calls=0;
  const budget=await superviseTerminalTelemetry({publish:async()=>{calls++;throw transient();},
    maxFailures:3,wait:async()=>{},random:()=>.5});
  assert.equal(calls,3);assert.equal(budget.state,'blocked');
  assert.equal(budget.consecutiveFailures,3);
  const states=[];
  calls=0;
  const permanent=await superviseTerminalTelemetry({publish:async()=>{calls++;throw Error('identity mismatch');},
    wait:async()=>assert.fail('Must not retry'),onStatus:s=>states.push(s)});
  assert.equal(calls,1);assert.equal(permanent.state,'blocked');
  assert.equal(states[0].reason,'operator-action-required');
  calls=0;
  const recovered=await superviseTerminalTelemetry({maxCycles:4,maxFailures:2,
    publish:async()=>{calls++;if(calls%2)throw transient();return {accepted:true};},wait:async()=>{}});
  assert.equal(recovered.acceptedCycles,2);assert.equal(recovered.consecutiveFailures,0);
});

test('supervisor serializes work, aborts waiting promptly and emits no success for interrupted delivery',async()=>{
  const stop=new AbortController();let active=0,peak=0,calls=0;
  const r=await superviseTerminalTelemetry({signal:stop.signal,publish:async()=>{
    calls++;active++;peak=Math.max(peak,active);await Promise.resolve();active--;return {accepted:true};
  },wait:async()=>{stop.abort();throw Error('Aborted');}});
  assert.equal(peak,1);assert.equal(calls,1);assert.equal(r.state,'stopped');
  const stopDuring=new AbortController(),states=[];
  const interrupted=await superviseTerminalTelemetry({signal:stopDuring.signal,
    publish:async()=>{stopDuring.abort();return {accepted:true};},onStatus:s=>states.push(s)});
  assert.equal(interrupted.acceptedCycles,0);
  assert.deepEqual(states.map(s=>s.state),['stopped']);
});

test('watch lock excludes concurrent supervisors and never automatically steals an existing lock',t=>{
  const directory=mkdtempSync(join(tmpdir(),'bridge-lock-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const release=acquireTerminalWatchLock(directory);
  assert.throws(()=>acquireTerminalWatchLock(directory),/locked/);
  assert.equal(existsSync(join(directory,'watch.lock')),true);
  release();release();
  const next=acquireTerminalWatchLock(directory);next();
  assert.equal(existsSync(join(directory,'watch.lock')),false);
});

test('network availability errors retry; identity mismatch and ambiguous probe failures stop',()=>{
  for(const code of ['TERMINAL_DISCONNECTED','QUOTE_UNAVAILABLE','QUOTE_STALE_OR_FUTURE'])
    assert.equal(retryableProbeFailure({status:2,stderr:code+'\n'}),true);
  for(const code of ['ACCOUNT_IDENTITY_MISMATCH','BROKER_SERVER_MISMATCH','METATRADER5_PYTHON_PACKAGE_REQUIRED',
    'QUOTE_INVALID','TERMINAL_PROBE_FAILED','TERMINAL_DISCONNECTED\nprivate data'])
    assert.equal(retryableProbeFailure({status:2,stderr:code}),false);
  assert.equal(retryableProbeFailure({status:2,stderr:'TERMINAL_DISCONNECTED',error:Error()}),false);
  for(const n of [1,2,4,8,20])for(const random of [()=>0,()=>.999]){
    const delay=telemetryRetryDelay(n,{random});assert.ok(delay>=12000&&delay<=300000);
  }
});

test('cloud revocation/protocol rejection halt; rate limiting and server outage allow bounded recovery',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'bridge-http-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  initializeTerminalIdentity(directory);
  const now=Date.now(),accountId=randomUUID(),deviceId=randomUUID();
  const reserved=reserveTerminalSequences({directory,accountId,deviceId});
  const packets=createTerminalPackets({accountId,deviceId,mode:'demo',...reserved,
    observation:{source:'mt5-python-terminal',accountType:'demo',terminalConnectedClaim:true,
      terminalTradeAllowedClaim:false,symbol:'EURUSD',bid:1,ask:1.1,observedAt:now,
      collectedAt:now,brokerVerified:false,ordersEnabled:false}});
  for(const status of [401,403,409,429,500,503])
    await assert.rejects(sendTerminalPackets({packets,endpoint:'https://elitetradee.vercel.app/api/elitebridge/telemetry',
      fetcher:async()=>({ok:false,status})}),e=>e.retryable===(status===429||status>=500));
});

test('invalid supervisor settings and non-Windows CLI fail before publishing',async()=>{
  for(const intervalMs of [0,9999,300001,NaN])
    await assert.rejects(superviseTerminalTelemetry({intervalMs,publish:()=>assert.fail()}),/configuration/);
  if(process.platform!=='win32'){
    const child=spawnSync(process.execPath,['scripts/elitebridge-terminal-watch.mjs'],{encoding:'utf8'});
    assert.equal(child.status,2);assert.match(child.stderr,/watch unavailable/);
    assert.equal(child.stdout,'');
  }
});
