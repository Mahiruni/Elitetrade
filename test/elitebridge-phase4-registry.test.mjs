import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {bridgePublicKeyIdentity,createEliteBridgeRegistry} from '../src/elitebridge-registry.mjs';
import {createSandboxKeys,signBridgePacket} from '../src/elitebridge-protocol.mjs';

const ownerId=randomUUID(),accountId=randomUUID(),deviceId=randomUUID(),adminId=randomUUID();
function fixture(){
 const keys=createSandboxKeys();
 const publicKeySpki=keys.publicKey.export({format:'der',type:'spki'}).toString('base64url');
 const state={status:null,seq:0,seen:new Set(),calls:[],key:publicKeySpki};
 const db={async rpc(name,p){
   state.calls.push(name);
   if(name==='elitetrade_bridge_stage'){state.status='pending';return true;}
   if(name==='elitetrade_bridge_approve'){if(state.status!=='pending')return false;state.status='approved';return true;}
   if(name==='elitetrade_bridge_revoke'){if(state.status==='revoked')return false;state.status='revoked';return true;}
   if(name==='elitetrade_bridge_key')return state.status==='approved'&&
     p.p_owner_id===ownerId&&p.p_account_id===accountId&&p.p_device_id===deviceId?state.key:null;
   if(name==='elitetrade_bridge_claim'){
     if(state.status!=='approved'||p.p_sequence<=state.seq||state.seen.has(p.p_message_id))return false;
     state.seen.add(p.p_message_id);state.seq=p.p_sequence;return true;
   }
   throw new Error('Unexpected RPC '+name);
 }};
 const registry=createEliteBridgeRegistry({db});
 const now=Date.parse('2026-10-15T01:00:00Z');
 const signPacket=(sequence=1,extra={})=>signBridgePacket({
   privateKey:keys.privateKey,accountId,deviceId,sequence,
   kind:'terminal.heartbeat',payload:{accountType:'demo',connected:true,tradeAllowed:false},
   issuedAt:now,expiresAt:now+60000,...extra
 });
 return {state,db,registry,now,publicKeySpki,signPacket};
}
test('requires a persistent trusted RPC and accepts only canonical Ed25519 public keys',()=>{
 assert.throws(()=>createEliteBridgeRegistry({}),/persistent store/);
 const x=fixture();
 assert.match(bridgePublicKeyIdentity(x.publicKeySpki).fingerprint,/^[a-f0-9]{64}$/);
 assert.throws(()=>bridgePublicKeyIdentity('abc'),/encoding/);
 const p=createSandboxKeys().publicKey.export({format:'pem',type:'spki'});
 assert.throws(()=>bridgePublicKeyIdentity(p),/encoding/);
});
test('stage is pending, approval is explicit and cannot be repeated',async()=>{
 const x=fixture(),{registry}=x;
 const stage=await registry.stage({ownerId,accountId,deviceId,displayName:'Termux Companion',publicKeySpki:x.publicKeySpki});
 assert.equal(stage.state,'pending');assert.equal(stage.ordersEnabled,false);
 await assert.rejects(registry.verifySignedDemo({ownerId,accountId,deviceId,
   packet:x.signPacket(),nowMs:x.now}),/not approved/);
 const a=await registry.approve({actorId:adminId,deviceId});
 assert.equal(a.state,'approved');
 await assert.rejects(registry.approve({actorId:adminId,deviceId}),/rejected/);
});
test('approved verification uses DB-pinned key, durable sequence and survives adapter restart',async()=>{
 const x=fixture(),{registry}=x;
 await registry.stage({ownerId,accountId,deviceId,displayName:'Phone',publicKeySpki:x.publicKeySpki});
 await registry.approve({actorId:adminId,deviceId});
 const p=x.signPacket();
 const good=await registry.verifySignedDemo({ownerId,accountId,deviceId,packet:p,nowMs:x.now});
 assert.equal(good.verified,true);assert.equal(good.actionsAllowed,false);assert.equal(good.brokerVerified,false);
 const restarted=createEliteBridgeRegistry({db:x.db});
 await assert.rejects(restarted.verifySignedDemo({ownerId,accountId,deviceId,packet:p,nowMs:x.now}),/replay/);
 assert.equal(x.state.seq,1);
});
test('tampered signature and REAL account claims do not reach durable claim RPC',async()=>{
 const x=fixture();
 await x.registry.stage({ownerId,accountId,deviceId,displayName:'Phone',publicKeySpki:x.publicKeySpki});
 await x.registry.approve({actorId:adminId,deviceId});
 await assert.rejects(x.registry.verifySignedDemo({ownerId,accountId,deviceId,packet:{
   ...x.signPacket(),payload:{accountType:'demo',connected:false,tradeAllowed:false}
 },nowMs:x.now}),/signature/);
 assert.throws(()=>x.signPacket(1,{payload:{accountType:'real',connected:true,tradeAllowed:false}}),/REAL/);
 assert.throws(()=>x.signPacket(1,{kind:'terminal.order',payload:{}}),/kind/);
 assert.equal(x.state.calls.filter(n=>n==='elitetrade_bridge_claim').length,0);
});
test('revocation blocks all new claims and wrong scope cannot look up keys',async()=>{
 const x=fixture();
 await x.registry.stage({ownerId,accountId,deviceId,displayName:'Phone',publicKeySpki:x.publicKeySpki});
 await x.registry.approve({actorId:adminId,deviceId});
 await assert.rejects(x.registry.verifySignedDemo({ownerId:randomUUID(),accountId,deviceId,
   packet:x.signPacket(),nowMs:x.now}),/not approved/);
 await x.registry.revoke({actorId:ownerId,deviceId});
 await assert.rejects(x.registry.verifySignedDemo({ownerId,accountId,deviceId,
   packet:x.signPacket(2),nowMs:x.now}),/not approved/);
});
test('migration restricts RPC access and explicitly disallows orders',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015000100_elitebridge_phase4_secure_state.sql',import.meta.url),'utf8');
 assert.match(sql,/enable row level security/g);
 assert.match(sql,/from public,anon,authenticated/);
 assert.match(sql,/to service_role/);
 assert.match(sql,/for update/);
 assert.match(sql,/on conflict do nothing/);
 assert.match(sql,/terminal\.heartbeat/);
 assert.doesNotMatch(sql,/demoOrder|OrderSend|place_trade/);
});
