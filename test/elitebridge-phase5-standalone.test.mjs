import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createStandaloneBridgeStore} from '../src/elitebridge-standalone-store.mjs';
import {createEliteBridgeRegistry} from '../src/elitebridge-registry.mjs';
import {createSandboxKeys,signBridgePacket} from '../src/elitebridge-protocol.mjs';

const ownerId=randomUUID(),accountId=randomUUID(),deviceId=randomUUID(),adminId=randomUUID(),strangerId=randomUUID();
function makeState() {
  const state={devices:new Map(),accepted:new Set(),log:[],authorizeCalls:0};
  let active=[ownerId,adminId],adminAllowed=true,ownershipAllowed=true;
  const run=async (sql,params=[],view=state)=>{
    view.log.push({sql,params});
    const id=params[0],existing=view.devices.get(id);
    if(sql.startsWith('insert into elitebridge.devices ')){
      if(view.devices.has(id))throw Error('duplicate device');
      view.devices.set(id,{id,owner_id:params[1],account_id:params[2],
        display_name:params[3],public_key_spki:params[4],fingerprint:params[5],
        state:'pending',last_sequence:0,approved_by:null});
      return {rowCount:1,rows:[{id}]};
    }
    if(sql.startsWith('select owner_id,account_id from elitebridge.devices'))
      return {rows:existing?.state==='pending'?[{owner_id:existing.owner_id,account_id:existing.account_id}]:[]};
    if(sql.startsWith('select owner_id from elitebridge.devices'))
      return {rows:existing?.state!=='revoked'&&existing?[{owner_id:existing.owner_id}]:[]};
    if(sql.startsWith('update elitebridge.devices set state=')){
      if(!existing || (sql.includes('approved_by')?existing.state!=='pending':existing.state==='revoked'))
        return {rowCount:0,rows:[]};
      if(sql.includes('approved_by')){existing.state='approved';existing.approved_by=params[2]}
      else existing.state='revoked';
      return {rowCount:1,rows:[{id}]};
    }
    if(sql.startsWith('select public_key_spki from elitebridge.devices')){
      const x=view.devices.get(id);
      return {rows:x&&x.owner_id===params[1]&&x.account_id===params[2]&&x.state==='approved'
        ?[{public_key_spki:x.public_key_spki}]:[]};
    }
    if(sql.startsWith('select last_sequence from elitebridge.devices')){
      const x=view.devices.get(id);
      return {rows:x&&x.owner_id===params[1]&&x.account_id===params[2]&&x.state==='approved'
        ?[{last_sequence:String(x.last_sequence)}]:[]};
    }
    if(sql.startsWith('insert into elitebridge.accepted_messages')){
      if(view.accepted.has(params[0])||
        [...view.devices.values()].some(d=>d._last_message_sequence===params[4]&&d.id===params[1]))
        return {rowCount:0,rows:[]};
      view.accepted.add(params[0]);
      const x=view.devices.get(params[1]); if(x)x._last_message_sequence=params[4];
      return {rowCount:1,rows:[{message_id:params[0]}]};
    }
    if(sql.startsWith('update elitebridge.devices set last_sequence=')){
      const x=view.devices.get(id);
      if(!x || x.state!=='approved')return {rowCount:0,rows:[]};
      x.last_sequence=params[1];return {rowCount:1,rows:[{id}]};
    }
    if(sql.startsWith('select id as device_id')){
      return {rows:[...view.devices.values()].filter(x=>
        !sql.includes('where owner_id=') || x.owner_id===params[0]).map(x=>({
          device_id:x.id,owner_id:x.owner_id,account_id:x.account_id,
          display_name:x.display_name,fingerprint:x.fingerprint,state:x.state,
          last_sequence:x.last_sequence,created_at:'2026-10-15T00:00:00Z',
          approved_at:null,revoked_at:null
        }))};
    }
    throw Error('Unexpected SQL '+sql);
  };
  const pool={
    query:(sql,args)=>run(sql,args),
    async connect(){
      let working=null;
      return {
        async query(sql,args){
          if(sql==='begin'){
            working={devices:new Map([...state.devices.entries()].map(([key,v])=>[key,{...v}])),
              accepted:new Set(state.accepted),log:state.log};
            return {rowCount:0};
          }
          if(sql==='commit'){state.devices=working.devices;state.accepted=working.accepted;working=null;return {rowCount:0}}
          if(sql==='rollback'){working=null;return {rowCount:0}}
          return run(sql,args,working);
        },
        release(){}
      };
    }
  };
  const policy={
    isActiveUser:async id=>active.includes(id),
    ownsAccount:async(id,acct)=>ownershipAllowed&&id===ownerId&&acct===accountId,
    isAdmin:async id=>adminAllowed&&id===adminId
  };
  const store=createStandaloneBridgeStore({pool,...policy});
  return {state,store,pool,policy,setOwnership:x=>ownershipAllowed=x,setAdmin:x=>adminAllowed=x,
    setActive:x=>active=x};
}
const keys=createSandboxKeys();
const spki=keys.publicKey.export({type:'spki',format:'der'}).toString('base64url');
async function enroll(f){
 const registry=createEliteBridgeRegistry({db:f.store});
 await registry.stage({ownerId,accountId,deviceId,displayName:'Personal Android',publicKeySpki:spki});
 return registry;
}
const fixturePacket=(seq,now)=>signBridgePacket({privateKey:keys.privateKey,
  accountId,deviceId,sequence:seq,kind:'terminal.heartbeat',
  payload:{accountType:'demo',connected:true,tradeAllowed:false},
  issuedAt:now,expiresAt:now+60000});

test('adapter refuses missing pool and missing authoritative identity policy',()=>{
 assert.throws(()=>createStandaloneBridgeStore(),/PostgreSQL pool required/);
 const f=makeState();
 assert.throws(()=>createStandaloneBridgeStore({pool:f.pool}),/authorization callbacks required/);
});

test('stage requires owner verification; public key must match its fingerprint',async()=>{
 const f=makeState();
 await assert.rejects(f.store.rpc('elitetrade_bridge_stage',{
   p_owner_id:strangerId,p_account_id:accountId,p_device_id:deviceId,
   p_display_name:'Phone',p_public_key_spki:spki,p_fingerprint:'0'.repeat(64)
 }),/ownership denied/);
 assert.equal(f.state.devices.size,0);
 const r=await enroll(f);
 assert.ok(r);
 assert.equal(f.state.devices.get(deviceId).state,'pending');
 assert.ok(f.state.log.every(x=>x.params.every(p=>!String(p).includes('DROP TABLE'))));
});

test('admin authorization, revocation, and redacted owner inventory',async()=>{
 const f=makeState(),registry=await enroll(f);
 await assert.rejects(registry.approve({actorId:ownerId,deviceId}),/administrator required/);
 await registry.approve({actorId:adminId,deviceId});
 assert.equal(f.state.devices.get(deviceId).state,'approved');
 const listed=await f.store.rpc('elitetrade_bridge_inventory',{p_actor_id:ownerId});
 assert.equal(listed.length,1);
 assert.ok(!JSON.stringify(listed).includes(spki));
 await assert.rejects(registry.revoke({actorId:strangerId,deviceId}),/account unavailable/);
 await registry.revoke({actorId:ownerId,deviceId});
 assert.equal(f.state.devices.get(deviceId).state,'revoked');
 await assert.rejects(registry.approve({actorId:adminId,deviceId}),/rejected/);
});

test('signed DEMO telemetry uses pinned key, SQL transaction and durable replay state',async()=>{
 const f=makeState(),registry=await enroll(f);
 await registry.approve({actorId:adminId,deviceId});
 const now=Date.parse('2026-10-15T01:00:00Z');
 const p1=fixturePacket(1,now);
 const accepted=await registry.verifySignedDemo({ownerId,accountId,deviceId,packet:p1,nowMs:now});
 assert.equal(accepted.verified,true);
 assert.equal(accepted.actionsAllowed,false);
 const restored=createEliteBridgeRegistry({db:f.store});
 await assert.rejects(restored.verifySignedDemo({
   ownerId,accountId,deviceId,packet:p1,nowMs:now}),/replay/);
 assert.equal(f.state.devices.get(deviceId).last_sequence,1);
 assert.equal(f.state.accepted.size,1);
 assert.equal(f.state.log.some(x=>x.sql.includes('for update')),true);
 assert.equal(f.state.log.some(x=>x.sql.includes('on conflict do nothing')),true);
});

test('revoked device and no-longer-owned account fail before accepting packets',async()=>{
 const f=makeState(),registry=await enroll(f);
 await registry.approve({actorId:adminId,deviceId});
 const now=Date.parse('2026-10-15T01:00:00Z');
 f.setOwnership(false);
 await assert.rejects(registry.verifySignedDemo({ownerId,accountId,deviceId,
   packet:fixturePacket(1,now),nowMs:now}),/ownership denied/);
 f.setOwnership(true);
 await registry.revoke({actorId:ownerId,deviceId});
 await assert.rejects(registry.verifySignedDemo({ownerId,accountId,deviceId,
   packet:fixturePacket(2,now),nowMs:now}),/not approved/);
 assert.equal(f.state.accepted.size,0);
});

test('unsupported RPC, SQL injection attempts, and invalid sequences are rejected',async()=>{
 const f=makeState(),registry=await enroll(f);
 await registry.approve({actorId:adminId,deviceId});
 await assert.rejects(f.store.rpc('elitetrade_bridge_delete_everything',{}),/unsupported RPC/);
 assert.equal(await f.store.rpc('elitetrade_bridge_claim',{
   p_owner_id:ownerId,p_account_id:accountId,p_device_id:deviceId,
   p_sequence:0,p_message_id:'a'.repeat(32),p_kind:'terminal.quote'}),false);
 await assert.rejects(f.store.rpc('elitetrade_bridge_key',{
   p_owner_id:ownerId,p_account_id:"'; DROP TABLE elitebridge.devices;--",
   p_device_id:deviceId}),/invalid account/);
 assert.equal(f.state.accepted.size,0);
});

test('standalone SQL has no Supabase dependency and keeps accepted audit transactional',()=>{
 const sql=readFileSync(new URL('../db/elitebridge-standalone.sql',import.meta.url),'utf8');
 const adapter=readFileSync(new URL('../src/elitebridge-standalone-store.mjs',import.meta.url),'utf8');
 assert.match(sql,/create schema if not exists elitebridge/);
 assert.match(sql,/unique\(device_id,sequence\)/);
 assert.match(sql,/revoke all on schema elitebridge from public/);
 const ddl=sql.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n');
 assert.doesNotMatch(ddl,/auth\.users|supabase|metaapi|order_send/i);
 assert.match(adapter,/for update/);
 assert.match(adapter,/await client\.query\('rollback'\)/);
 assert.match(adapter,/await client\.query\('commit'\)/);
 assert.doesNotMatch(adapter,/sb_secret_|service_role|METAAPI_TOKEN/);
});
