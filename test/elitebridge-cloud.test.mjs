import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createEliteBridgeCloud,validateTerminalPublicKey} from '../src/elitebridge-cloud.mjs';
import {signBridgePacket,eliteBridgeProtocolStatus} from '../src/elitebridge-protocol.mjs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

const ids=()=>({ownerId:randomUUID(),accountId:randomUUID(),deviceId:randomUUID()});
function makeDb(){
  const terminals=new Map(),packets=new Set();
  return {
    terminals,packets,
    async query(_,search){
      const owner=decodeURIComponent(search.match(/owner_id=eq\.([^&]+)/)?.[1]||'');
      const account=decodeURIComponent(search.match(/account_id=eq\.([^&]+)/)?.[1]||'');
      return [...terminals.values()].filter(r=>r.owner_id===owner&&(!account||r.account_id===account))
        .map(({public_key,...safe})=>safe);
    },
    async insert(_,row){terminals.set(row.id,{...row,last_sequence:0});return [row]},
    async update(_,search,change){
      const id=search.match(/id=eq\.([^&]+)/)?.[1];
      const owner=search.match(/owner_id=eq\.([^&]+)/)?.[1];
      const x=terminals.get(id);
      if(!x||x.owner_id!==owner||x.status==='revoked'||(change.status==='approved'&&x.status!=='pending'))return [];
      Object.assign(x,change);return [x];
    },
    async one(_,search){
      const id=search.match(/id=eq\.([^&]+)/)?.[1];
      const x=terminals.get(id);
      return x?.status==='approved'?x:null;
    },
    async rpc(_,p){
      const x=terminals.get(p.p_terminal_id);
      const key=p.p_terminal_id+':'+p.p_message_id;
      if(!x||x.status!=='approved'||x.account_id!==p.p_account_id||
         p.p_sequence<=x.last_sequence||packets.has(key))return false;
      packets.add(key);x.last_sequence=p.p_sequence;return true;
    }
  };
}
test('Ed25519 only; enrollment pending until explicitly approved; packets are demo-only and replay-safe',async()=>{
  const {ownerId,accountId}=ids(),{privateKey,publicKey}=generateKeyPairSync('ed25519'),db=makeDb();
  const bridge=createEliteBridgeCloud({db});
  assert.throws(()=>validateTerminalPublicKey('not a PEM'),/Ed25519/);
  assert.throws(()=>validateTerminalPublicKey(generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'pem',type:'spki'}).toString()),/Ed25519/);
  const enrolled=await bridge.enroll({ownerId,accountId,label:'DEMO Windows VPS',
    publicKey:publicKey.export({type:'spki',format:'pem'}).toString()});
  const packet=(sequence,payload={accountType:'demo',connected:true,tradeAllowed:false})=>
    signBridgePacket({privateKey,kind:'terminal.heartbeat',accountId,deviceId:enrolled.terminalId,
      sequence,payload});
  assert.equal(enrolled.status,'pending');
  await assert.rejects(()=>bridge.receive(packet(1)),e=>e.status===403);
  assert.equal((await bridge.setApproval({ownerId,deviceId:enrolled.terminalId,approve:true})).status,'approved');
  const first=packet(1);
  const ack=await bridge.receive(first);
  assert.deepEqual([ack.accepted,ack.brokerVerified,ack.ordersEnabled,ack.demoOnly],[true,false,false,true]);
  await assert.rejects(()=>bridge.receive(first),e=>e.status===409);
  await assert.rejects(()=>bridge.receive(packet(1)),e=>e.status===409);
  await assert.rejects(()=>bridge.receive(packet(2,{accountType:'real',connected:true,tradeAllowed:true})),e=>e.status===403);
  const second=packet(2);second.payload.tradeAllowed=true; // tampered after signing
  await assert.rejects(()=>bridge.receive(second),e=>e.status===403);
  assert.equal((await bridge.receive(packet(2))).sequence,2);
  assert.equal(db.packets.size,2);
  await bridge.setApproval({ownerId,deviceId:enrolled.terminalId,approve:false});
  await assert.rejects(()=>bridge.receive(packet(3)),e=>e.status===403);
  await assert.rejects(()=>bridge.setApproval({ownerId,deviceId:enrolled.terminalId,approve:true}),e=>e.status===409);
});
test('cross-account packet, unsupported kind, forged signature and missing cloud key fail closed',async()=>{
  const {ownerId,accountId}=ids(),keys=generateKeyPairSync('ed25519'),db=makeDb();
  const bridge=createEliteBridgeCloud({db});
  await assert.rejects(()=>createEliteBridgeCloud().list({ownerId}),e=>e.status===503);
  const enrolled=await bridge.enroll({ownerId,accountId,label:'DEMO VPS',
    publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()});
  await bridge.setApproval({ownerId,deviceId:enrolled.terminalId,approve:true});
  const payload={accountType:'demo',symbol:'XAUUSDm',bid:4000,ask:4000.2,observedAt:Date.now()};
  const quoted=signBridgePacket({privateKey:keys.privateKey,kind:'terminal.quote',accountId,
    deviceId:enrolled.terminalId,sequence:1,payload});
  const bad={...quoted,accountId:randomUUID()};
  await assert.rejects(()=>bridge.receive(bad),e=>e.status===403);
  const forged={...quoted,signature:'A'.repeat(86)};
  await assert.rejects(()=>bridge.receive(forged),e=>e.status===403);
  await assert.rejects(()=>bridge.receive({...quoted,kind:'controller.ack'}),e=>e.status===403);
  assert.equal((await bridge.receive(quoted)).accepted,true);
});
test('database migration holds private RLS tables and an atomic service-only claim',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261015130000_elitebridge_phase4_cloud.sql',import.meta.url),'utf8');
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on table public\.elitetrade_bridge_terminals from public, anon, authenticated/);
  assert.match(sql,/revoke all on function public\.elitetrade_bridge_claim[\s\S]*from public, anon, authenticated/);
  assert.match(sql,/last_sequence<p_sequence/);
  assert.match(sql,/status='approved'/);
  assert.match(sql,/on conflict do nothing returning id/);
  assert.equal(eliteBridgeProtocolStatus({cloudIngestEnabled:true}).brokerVerified,false);
});
test('cloud routes cannot enroll anonymous/non-admins; show no broker authorization',async t=>{
  const {ownerId,accountId}=ids(),bridgeDb=makeDb();
  const db={
    authUser:async()=>({id:ownerId,factors:[]}),
    one:async table=>table==='elitetrade_profiles'?
      {id:ownerId,email:'admin@example.com',disabled:false,active:true,role:'user'}:
      table==='elitetrade_accounts'?{id:accountId}:null,
    rpc:async()=>({})
  };
  const env={APP_ORIGIN:'http://127.0.0.1:3000',ELITEBRIDGE_CLOUD_ENABLED:'true'};
  const app=createSupabaseApplication({db,bridgeDb,deviceVerification:false,gateway:null,telegram:null,env});
  await new Promise(ok=>app.server.listen(0,'127.0.0.1',ok));
  t.after(()=>app.close());
  const origin='http://127.0.0.1:'+app.server.address().port;
  const a=await fetch(origin+'/api/elitebridge/terminals',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(a.status,401);
  const u=await fetch(origin+'/api/elitebridge/terminals',{headers:{Authorization:'Bearer sample'}});
  assert.equal(u.status,403);
  const protocol=await fetch(origin+'/api/elitebridge/protocol',{headers:{Authorization:'Bearer sample'}});
  assert.equal(protocol.status,200);
  const p=await protocol.json();
  assert.equal(p.phase,4);
  assert.equal(p.independentMT5Connected,false);
  assert.equal(p.ordersEnabled,false);
});
