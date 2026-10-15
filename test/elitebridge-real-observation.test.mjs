import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {signLiveObservation,verifyLiveObservation} from '../src/elitebridge-live-observation.mjs';
import {createSandboxReplayStore,signBridgePacket,verifyBridgePacket,eliteBridgeProtocolStatus} from '../src/elitebridge-protocol.mjs';
import {createEliteBridgeCloud} from '../src/elitebridge-cloud.mjs';
import {signTerminalChallenge} from '../src/elitebridge-device-proof.mjs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

function fakeBridgeDb(){
  const registrations=new Map(),history=[];
  return {
    registrations,history,
    async query(table,query){
      if(table!=='elitetrade_bridge_terminals')throw Error('unexpected table');
      const owner=query.match(/owner_id=eq\.([^&]+)/)?.[1];
      const account=query.match(/account_id=eq\.([^&]+)/)?.[1];
      return [...registrations.values()].filter(t=>t.owner_id===owner&&(!account||t.account_id===account))
        .map(({public_key,...safe})=>safe);
    },
    async insert(table,item){
      if(table!=='elitetrade_bridge_terminals')throw Error('unexpected insert');
      const row={...item,last_sequence:0};registrations.set(item.id,row);return [row];
    },
    async one(table,query){
      if(table!=='elitetrade_bridge_terminals')throw Error('unexpected table');
      const id=query.match(/id=eq\.([^&]+)/)?.[1],row=registrations.get(id);
      if(query.includes('status=eq.pending'))return row?.status==='pending'?row:null;
      return row?.status==='approved'?row:null;
    },
    async update(table,query,updates){
      if(table!=='elitetrade_bridge_terminals')throw Error('unexpected update');
      const id=query.match(/id=eq\.([^&]+)/)?.[1];
      const owner=query.match(/owner_id=eq\.([^&]+)/)?.[1];
      const row=registrations.get(id);
      if(!row||row.owner_id!==owner||row.status==='revoked'||
         (updates.status==='approved'&&row.status!=='pending')||
         (query.includes('status=eq.pending')&&row.status!=='pending')||
         (query.includes('proof_verified_at=not.is.null')&&!row.proof_verified_at)||
         (query.includes('proof_verified_at=is.null')&&row.proof_verified_at))return [];
      const nonce=query.match(/proof_nonce=eq\.([^&]+)/)?.[1];
      if(nonce&&row.proof_nonce!==nonce)return [];
      Object.assign(row,updates);return [row];
    },
    async rpc(name,p){
      assert.equal(name,'elitetrade_bridge_claim');
      const row=registrations.get(p.p_terminal_id);
      if(!row||row.status!=='approved'||row.account_id!==p.p_account_id||
         row.account_mode!==p.p_payload?.accountType||
         row.last_sequence>=p.p_sequence||
         history.some(x=>x.p_terminal_id===p.p_terminal_id&&x.p_message_id===p.p_message_id))
        return false;
      row.last_sequence=p.p_sequence;history.push(p);return true;
    }
  };
}
test('signed REAL v4 quotes are read-only, mode-specific and replay-protected',async()=>{
  const accountId=randomUUID(),deviceId=randomUUID(),now=Date.now();
  const key=generateKeyPairSync('ed25519'),store=createSandboxReplayStore();
  const packet=signLiveObservation({privateKey:key.privateKey,accountId,deviceId,
    kind:'terminal.quote',sequence:1,issuedAt:now,
    payload:{accountType:'real',symbol:'XAUUSDm',bid:3998,ask:3998.3,observedAt:now}});
  const opt={packet,publicKey:key.publicKey,accountId,deviceId,replayStore:store,nowMs:now};
  const ok=await verifyLiveObservation(opt);
  assert.equal(ok.accountType,'real');
  assert.equal(ok.ordersEnabled,false);assert.equal(ok.brokerVerified,false);
  await assert.rejects(()=>verifyLiveObservation(opt),/out-of-order/);
  await assert.rejects(()=>verifyBridgePacket({...opt,role:'terminal'}),/protocol version mismatch/);
  const wrongScope={...packet,accountId:randomUUID()};
  await assert.rejects(()=>verifyLiveObservation({...opt,packet:wrongScope,
    replayStore:createSandboxReplayStore()}),/scope mismatch/);
  await assert.rejects(()=>verifyLiveObservation({...opt,packet:{...packet,signature:'A'.repeat(86)},
    replayStore:createSandboxReplayStore()}),/signature verification failed/);
});
test('REAL packets reject expired, fake mode, stale, future and order payloads',async()=>{
  const accountId=randomUUID(),deviceId=randomUUID(),k=generateKeyPairSync('ed25519'),now=Date.now();
  const sign=(kind,payload,options={})=>signLiveObservation({
    privateKey:k.privateKey,accountId,deviceId,kind,sequence:1,issuedAt:now,...options,payload
  });
  assert.throws(()=>sign('terminal.quote',{accountType:'demo',symbol:'XAUUSDm',bid:10,ask:11,observedAt:now}),/only explicit REAL/);
  assert.throws(()=>sign('terminal.order',{accountType:'real',symbol:'XAUUSDm'}),/order\/command messages forbidden/);
  assert.throws(()=>sign('terminal.quote',{accountType:'real',symbol:'XAUUSDm',bid:10,ask:NaN,observedAt:now}),/invalid ask/);
  const quote=(observedAt)=>sign('terminal.quote',{accountType:'real',symbol:'XAUUSDm',bid:10,ask:11,observedAt});
  const verify=packet=>verifyLiveObservation({
    packet,publicKey:k.publicKey,accountId,deviceId,replayStore:createSandboxReplayStore(),nowMs:now
  });
  await assert.rejects(()=>verify(quote(now-200000)),/stale or future quote/);
  await assert.rejects(()=>verify(quote(now+50000)),/stale or future quote/);
  await assert.rejects(()=>verify(sign('terminal.heartbeat',{accountType:'real',connected:true,tradeAllowed:true},
    {issuedAt:now-200000,expiresAt:now-110000})),/expired or future packet/);
});
test('REAL terminals must acknowledge read-only mode and cannot ingest DEMO packets',async()=>{
  const ownerId=randomUUID(),accountId=randomUUID(),db=fakeBridgeDb(),bridge=createEliteBridgeCloud({db});
  const keys=generateKeyPairSync('ed25519');
  const publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
  const req={ownerId,accountId,label:'Windows REAL observer',publicKey,accountMode:'real'};
  await assert.rejects(()=>bridge.enroll(req),e=>e.status===400);
  const enrolled=await bridge.enroll({...req,realAcknowledgement:'REAL_OBSERVATION_ONLY'});
  assert.equal(enrolled.status,'pending');assert.equal(enrolled.accountMode,'real');
  const challenge=(await bridge.issueChallenge({ownerId,deviceId:enrolled.terminalId})).challenge;
  await bridge.prove({ownerId,deviceId:enrolled.terminalId,
    signature:signTerminalChallenge({privateKey:keys.privateKey,challenge})});
  await bridge.setApproval({ownerId,deviceId:enrolled.terminalId,approve:true});
  const now=Date.now();
  const real=signLiveObservation({privateKey:keys.privateKey,kind:'terminal.heartbeat',
    accountId,deviceId:enrolled.terminalId,sequence:1,issuedAt:now,
    payload:{accountType:'real',connected:true,tradeAllowed:true}});
  await assert.rejects(()=>bridge.receive(real),e=>e.status===403); // feature off by default
  const good=await bridge.receive(real,{realObservationEnabled:true});
  assert.deepEqual([good.accountMode,good.ordersEnabled,good.brokerVerified],[ 'real',false,false]);
  await assert.rejects(()=>bridge.receive(real,{realObservationEnabled:true}),e=>e.status===409);
  const demo=signBridgePacket({privateKey:keys.privateKey,kind:'terminal.heartbeat',
    accountId,deviceId:enrolled.terminalId,sequence:2,issuedAt:now,
    payload:{accountType:'demo',connected:true,tradeAllowed:false}});
  await assert.rejects(()=>bridge.receive(demo,{realObservationEnabled:true}),e=>e.status===403);
  await bridge.setApproval({ownerId,deviceId:enrolled.terminalId,approve:false});
  const later=signLiveObservation({privateKey:keys.privateKey,kind:'terminal.heartbeat',
    accountId,deviceId:enrolled.terminalId,sequence:2,issuedAt:now,
    payload:{accountType:'real',connected:true,tradeAllowed:true}});
  await assert.rejects(()=>bridge.receive(later,{realObservationEnabled:true}),e=>e.status===403);
  assert.equal(db.history.length,1);
});
test('REAL protocol capabilities are read-only and only advertised with an explicit flag',()=>{
  const demo=eliteBridgeProtocolStatus({cloudIngestEnabled:true});
  assert.equal(demo.phase,4);assert.deepEqual(demo.supportedAccountModes,['demo']);
  const real=eliteBridgeProtocolStatus({cloudIngestEnabled:true,realObservationEnabled:true});
  assert.deepEqual(real.supportedAccountModes,['demo','real']);
  assert.equal(real.phase,5);assert.equal(real.ordersEnabled,false);
  assert.equal(real.realOrdersEnabled,false);
  assert.equal(real.independentMT5Connected,false);
});
test('authenticated admin can only enroll REAL observation when flag is on',async t=>{
  const ownerId=randomUUID(),accountId=randomUUID(),fake=fakeBridgeDb(),keys=generateKeyPairSync('ed25519');
  const db={
    authUser:async()=>({id:ownerId,factors:[]}),
    one:async(table)=>table==='elitetrade_profiles'?
      {id:ownerId,email:'admin@example.com',disabled:false,active:true,role:'admin'}:
      table==='elitetrade_accounts'?{id:accountId}:null,
    rpc:async()=>({})
  };
  async function app(env){
    const x=createSupabaseApplication({db,bridgeDb:fake,deviceVerification:false,gateway:null,
      telegram:null,env:{APP_ORIGIN:'http://localhost:3000',ELITEBRIDGE_CLOUD_ENABLED:'true',...env}});
    await new Promise(ok=>x.server.listen(0,'127.0.0.1',ok));
    t.after(()=>x.close());
    return 'http://127.0.0.1:'+x.server.address().port;
  }
  const off=await app({});
  const payload={accountId,label:'Windows REAL observer',accountMode:'real',
    realAcknowledgement:'REAL_OBSERVATION_ONLY',
    publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
  const headers={Authorization:'Bearer local-admin','Content-Type':'application/json'};
  assert.equal((await fetch(off+'/api/elitebridge/terminals',{method:'POST',headers,body:JSON.stringify(payload)})).status,503);
  const on=await app({ELITEBRIDGE_REAL_OBSERVATION_ENABLED:'true'});
  assert.equal((await fetch(on+'/api/elitebridge/terminals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})).status,401);
  const response=await fetch(on+'/api/elitebridge/terminals',{method:'POST',headers,body:JSON.stringify(payload)});
  assert.equal(response.status,201);assert.equal((await response.json()).accountMode,'real');
});
test('database migration binds mode in the same atomic claim as sequence',()=>{
  const s=readFileSync(new URL('../supabase/migrations/20261015140000_elitebridge_real_observation_only.sql',import.meta.url),'utf8');
  assert.match(s,/account_mode=p_payload->>'accountType'/);
  assert.match(s,/status='approved'/);
  assert.match(s,/security invoker/);
  assert.match(s,/revoke all on function public.elitetrade_bridge_claim/);
  assert.doesNotMatch(s,/security definer/i);
});
test('Windows companion has explicit real-mode match and no MT5 execution method',()=>{
  const py=readFileSync(new URL('../companion/mt5_readonly_probe.py',import.meta.url),'utf8');
  assert.match(py,/ACCOUNT_TRADE_MODE_REAL/);
  assert.match(py,/ELITEBRIDGE_MT5_EXPECT_MODE/);
  assert.doesNotMatch(py,/^\s*mt5\.order_send\s*\(/m);
  assert.doesNotMatch(py,/^\s*mt5\.login\s*\(/m);
  assert.match(py,/"ordersEnabled": False/);
  const command=spawnSync('python3',['-m','py_compile',
    new URL('../companion/mt5_readonly_probe.py',import.meta.url).pathname],{encoding:'utf8'});
  if(command.error?.code==='ENOENT')return; // Node-only CI also checks static safety
  assert.equal(command.status,0,command.stderr);
});

test('phone-friendly REAL observation sandbox proves signing without any broker or network',()=>{
  const run=spawnSync(process.execPath,['scripts/elitebridge-real-observation-sandbox.mjs'],{
    encoding:'utf8',timeout:10000
  });
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/REAL v4 are isolated/);
  assert.match(run.stdout,/REAL ORDERS: DISABLED/);
  assert.match(run.stdout,/BROKER VERIFIED: NO/);
});
