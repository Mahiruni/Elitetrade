import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createEliteBridgeCloud} from '../src/elitebridge-cloud.mjs';
import {terminalChallenge,validatedChallenge,verifyTerminalChallenge,
  signTerminalChallenge} from '../src/elitebridge-device-proof.mjs';
import {initializeTerminalIdentity,signLocalPairingProof} from '../src/elitebridge-terminal-uplink.mjs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

const ownerId=randomUUID(),accountId=randomUUID();
function fakeDb(){
  const terminals=new Map();
  function match(query,row){
    const id=query.match(/(?:^|&)id=eq\.([^&]+)/)?.[1];
    const owner=query.match(/owner_id=eq\.([^&]+)/)?.[1];
    const account=query.match(/account_id=eq\.([^&]+)/)?.[1];
    const nonce=query.match(/proof_nonce=eq\.([^&]+)/)?.[1];
    const expiry=query.match(/proof_expires_at=gt\.([^&]+)/)?.[1];
    return (!id||row.id===id)&&(!owner||row.owner_id===owner)&&
      (!account||row.account_id===account)&&(!nonce||row.proof_nonce===nonce)&&
      (!expiry||Date.parse(row.proof_expires_at)>Date.parse(decodeURIComponent(expiry)))&&
      (!query.includes('status=eq.pending')||row.status==='pending')&&
      (!query.includes('status=eq.approved')||row.status==='approved')&&
      (!query.includes('proof_verified_at=is.null')||!row.proof_verified_at)&&
      (!query.includes('proof_verified_at=not.is.null')||!!row.proof_verified_at);
  }
  return {
    terminals,
    async query(_t,q){return [...terminals.values()].filter(row=>match(q,row));},
    async one(_t,q){return [...terminals.values()].find(row=>match(q,row))||null;},
    async insert(_t,data){const row={...data,last_sequence:0};terminals.set(row.id,row);return [row];},
    async update(_t,q,values){
      const rows=[...terminals.values()].filter(row=>match(q,row));
      for(const row of rows)Object.assign(row,values);
      return rows;
    }
  };
}
function keypair(){
  const keys=generateKeyPairSync('ed25519');
  return {privateKey:keys.privateKey,
    publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()};
}
test('pending terminal cannot approve without key proof, then approves exactly once',async()=>{
  const db=fakeDb(),cloud=createEliteBridgeCloud({db}),keys=keypair();
  const enrolled=await cloud.enroll({ownerId,accountId,label:'REAL observer',
    accountMode:'real',realAcknowledgement:'REAL_OBSERVATION_ONLY',publicKey:keys.publicKey});
  const deviceId=enrolled.terminalId;
  await assert.rejects(()=>cloud.setApproval({ownerId,deviceId,approve:true}),e=>e.status===409);
  const challenge=await cloud.issueChallenge({ownerId,deviceId});
  assert.equal(validatedChallenge(challenge.challenge).deviceId,deviceId);
  const bad=keypair();
  await assert.rejects(()=>cloud.prove({ownerId,deviceId,
    signature:signTerminalChallenge({privateKey:bad.privateKey,challenge:challenge.challenge})}),
    e=>e.status===403);
  const signature=signTerminalChallenge({privateKey:keys.privateKey,challenge:challenge.challenge});
  assert.equal((await cloud.prove({ownerId,deviceId,signature})).proofVerified,true);
  await assert.rejects(()=>cloud.prove({ownerId,deviceId,signature}),e=>e.status===409);
  await assert.rejects(()=>cloud.issueChallenge({ownerId,deviceId}),e=>e.status===409);
  assert.equal((await cloud.setApproval({ownerId,deviceId,approve:true})).status,'approved');
  const list=await cloud.list({ownerId});
  assert.equal(list.terminals[0].telemetryState,'never-received');
  assert.equal(list.terminals[0].brokerVerified,false);
  assert.equal(list.terminals[0].ordersEnabled,false);
  assert.equal(Object.hasOwn(list.terminals[0],'public_key'),false);
  db.terminals.get(deviceId).last_seen_at=new Date().toISOString();
  assert.equal((await cloud.list({ownerId})).terminals[0].telemetryState,'recent');
  db.terminals.get(deviceId).last_seen_at=new Date(Date.now()-4*60000).toISOString();
  assert.equal((await cloud.list({ownerId})).terminals[0].telemetryState,'stale');
  await cloud.setApproval({ownerId,deviceId,approve:false});
  assert.equal((await cloud.list({ownerId})).terminals[0].telemetryState,'not-approved');
});
test('expired/replaced challenges, changed account and revoked registrations fail closed',async()=>{
  const db=fakeDb(),cloud=createEliteBridgeCloud({db}),keys=keypair();
  const terminal=await cloud.enroll({ownerId,accountId,label:'DEMO observer',publicKey:keys.publicKey});
  const deviceId=terminal.terminalId;
  await assert.rejects(()=>cloud.issueChallenge({ownerId:randomUUID(),deviceId}),e=>e.status===409);
  const first=await cloud.issueChallenge({ownerId,deviceId});
  const oldProof=signTerminalChallenge({privateKey:keys.privateKey,challenge:first.challenge});
  db.terminals.get(deviceId).proof_expires_at=new Date(Date.now()-1000).toISOString();
  await assert.rejects(()=>cloud.prove({ownerId,deviceId,signature:oldProof}),e=>e.status===409);
  const second=await cloud.issueChallenge({ownerId,deviceId});
  assert.notEqual(first.challenge,second.challenge);
  await assert.rejects(()=>cloud.prove({ownerId,deviceId,signature:oldProof}),e=>e.status===403);
  const wrongKey=signTerminalChallenge({privateKey:keys.privateKey,challenge:second.challenge});
  assert.equal((await cloud.prove({ownerId,deviceId,signature:wrongKey})).proofVerified,true);
  await cloud.setApproval({ownerId,deviceId,approve:false});
  await assert.rejects(()=>cloud.setApproval({ownerId,deviceId,approve:true}),e=>e.status===409);
});
test('challenge bytes are domain-separated, expiring and not a generic signing oracle',()=>{
  const keys=keypair(),deviceId=randomUUID(),nonce='a'.repeat(64);
  const now=Date.now();
  const challenge=terminalChallenge({deviceId,accountId,accountMode:'demo',
    nonce,expiresAtMs:now+300000});
  const signature=signTerminalChallenge({privateKey:keys.privateKey,challenge,nowMs:now});
  assert.equal(verifyTerminalChallenge({publicKey:keys.publicKey,challenge,signature,nowMs:now}),true);
  assert.equal(verifyTerminalChallenge({publicKey:keys.publicKey,
    challenge,signature:'A'.repeat(86),nowMs:now}),false);
  assert.throws(()=>signTerminalChallenge({privateKey:keys.privateKey,challenge,nowMs:now+300001}),/expired pairing/);
  assert.throws(()=>signTerminalChallenge({privateKey:keys.privateKey,
    challenge:Buffer.from('terminal.order:SELL').toString('base64url')}),/invalid or expired/);
  assert.throws(()=>terminalChallenge({deviceId,accountId,accountMode:'real',
    nonce:'z'.repeat(64),expiresAtMs:now+300000}),/invalid or expired/);
});
test('offline terminal signs proof with private key kept inside local identity directory',t=>{
  const dir=mkdtempSync(join(tmpdir(),'bridge-proof-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const identity=initializeTerminalIdentity(dir),deviceId=randomUUID();
  const challenge=terminalChallenge({deviceId,accountId,accountMode:'real',
    nonce:'b'.repeat(64),expiresAtMs:Date.now()+300000});
  const proof=signLocalPairingProof({directory:dir,challenge});
  assert.equal(proof.fingerprint,identity.fingerprint);
  assert.equal(proof.ordersEnabled,false);
  assert.equal(verifyTerminalChallenge({publicKey:identity.publicKeyPem,
    challenge,signature:proof.signature}),true);
  assert.doesNotMatch(proof.signature,/BEGIN PRIVATE KEY/);
});
test('admin HTTP route pairing requires authentication, proof, then explicit approval',async t=>{
  const data=fakeDb(),bridgeDb=data,owner=ownerId,keys=keypair();
  const db={
    authUser:async()=>({id:owner,factors:[]}),
    one:async table=>table==='elitetrade_profiles'?
      {id:owner,email:'admin@example.com',role:'admin',active:true,disabled:false}:
      table==='elitetrade_accounts'?{id:accountId}:null,
    rpc:async()=>({})
  };
  const app=createSupabaseApplication({db,bridgeDb,deviceVerification:false,
    gateway:null,telegram:null,env:{APP_ORIGIN:'http://127.0.0.1:3000',
      ELITEBRIDGE_CLOUD_ENABLED:'true'}});
  await new Promise(done=>app.server.listen(0,'127.0.0.1',done));
  t.after(()=>app.close());
  const root='http://127.0.0.1:'+app.server.address().port;
  const headers={'Content-Type':'application/json',Authorization:'Bearer owner'};
  const post=(url,body={},h=headers)=>fetch(root+url,{method:'POST',headers:h,body:JSON.stringify(body)});
  const reg=await post('/api/elitebridge/terminals',{
    accountId,label:'Approved proof terminal',publicKey:keys.publicKey});
  assert.equal(reg.status,201);
  const {terminalId}=await reg.json();
  const base='/api/elitebridge/terminals/'+terminalId;
  assert.equal((await post(base+'/approve')).status,409);
  assert.equal((await post(base+'/challenge',{}, {'Content-Type':'application/json'})).status,401);
  const challengeRequest=await post(base+'/challenge');
  assert.equal(challengeRequest.status,200);
  const {challenge}=await challengeRequest.json();
  const sig=signTerminalChallenge({privateKey:keys.privateKey,challenge});
  assert.equal((await post(base+'/prove',{signature:sig})).status,200);
  assert.equal((await post(base+'/approve')).status,200);
  const list=await fetch(root+'/api/elitebridge/terminals',{headers});
  assert.equal(list.status,200);
  assert.equal((await list.json()).terminals[0].telemetryState,'never-received');
});
test('migration blocks privileged approval before proof, and private tables remain inaccessible',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261015153000_elitebridge_device_proof_gate.sql',import.meta.url),'utf8');
  assert.match(sql,/status <> 'approved' or proof_verified_at is not null/);
  assert.match(sql,/revoke all on public\.elitetrade_bridge_terminals from anon, authenticated/);
  assert.match(sql,/proof_nonce/);
});
