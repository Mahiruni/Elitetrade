import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSandboxKeys} from '../src/elitebridge-protocol.mjs';
import {createDeviceEnrollmentProof,verifyDeviceEnrollmentProof} from '../src/elitebridge-enrollment.mjs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

const ownerId=randomUUID(),adminId=randomUUID(),foreignId=randomUUID();
const accountId=randomUUID(),deviceId=randomUUID(),now=Date.now();
const keys=createSandboxKeys();
const publicKeySpki=keys.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const payload={accountId,deviceId,displayName:'Termux verified phone',publicKeySpki,
  proof:createDeviceEnrollmentProof({privateKey:keys.privateKey,ownerId,accountId,deviceId,issuedAt:now})};
function tokenFor(name,aal='aal2'){
 return 'header.'+Buffer.from(JSON.stringify({aal})).toString('base64url')+'.signature-'+name;
}
const tokens={
 owner:tokenFor('owner'),admin:tokenFor('admin'),
 ownerNoMfa:tokenFor('owner-no-mfa'),ownerAal1:tokenFor('owner-aal1','aal1'),
 foreign:tokenFor('foreign')
};
async function fixture(t,{enabled=true,connected=true}={}){
 const state={staged:false,approved:false,revoked:false,sequence:0,calls:[],audit:[],key:publicKeySpki};
 const identities={
  [tokens.owner]:{id:ownerId,role:'user',mfa:true},
  [tokens.admin]:{id:adminId,role:'admin',mfa:true},
  [tokens.ownerNoMfa]:{id:ownerId,role:'user',mfa:false},
  [tokens.ownerAal1]:{id:ownerId,role:'user',mfa:true},
  [tokens.foreign]:{id:foreignId,role:'user',mfa:true}
 };
 const db={
  async authUser(token){const x=identities[token];if(!x)throw Error('unknown');
    return {id:x.id,email:'test@example.com',factors:x.mfa?[{status:'verified'}]:[]};},
  async one(table,search,token){
   if(table==='elitetrade_profiles'){
    const x=identities[token];
    return x?{id:x.id,role:x.role,active:true,disabled:false,
      email:'test@example.com'}:null;
   }
   if(table==='elitetrade_accounts')return search.includes('id=eq.'+accountId)
     &&search.includes('user_id=eq.'+ownerId)?{id:accountId}:null;
   return null;
  },
  async rpc(name,data){if(name==='elitetrade_audit'){state.audit.push(data);return true;}
    throw Error('Unexpected unprivileged RPC '+name);}
 };
 const bridgeDb={async rpc(name,data){
   state.calls.push({name,data});
   if(name==='elitetrade_bridge_stage'){if(state.staged)return false;state.staged=true;return true;}
   if(name==='elitetrade_bridge_approve'){if(!state.staged||state.approved||data.p_actor_id!==adminId)return false;
     state.approved=true;return true;}
   if(name==='elitetrade_bridge_revoke'){if(!state.staged||state.revoked)return false;
     state.revoked=true;return true;}
   if(name==='elitetrade_bridge_inventory')return state.staged?[{
     device_id:deviceId,owner_id:ownerId,account_id:accountId,display_name:payload.displayName,
     fingerprint:'a'.repeat(64),state:state.revoked?'revoked':state.approved?'approved':'pending',
     last_sequence:state.sequence,created_at:new Date(now).toISOString(),
     public_key_spki:'SECRET_MUST_NOT_ESCAPE'
   }]:[];
   throw Error('Unknown registry function: '+name);
 }};
 const app=createSupabaseApplication({db,bridgeDb,gateway:null,telegram:null,deviceVerification:false,
   env:{APP_ORIGIN:'http://localhost:3000',ELITEBRIDGE_ENROLLMENT_ENABLED:enabled?'true':'false'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 async function request(path,who='',data,method=data?'POST':'GET'){
  const res=await fetch('http://127.0.0.1:'+app.server.address().port+path,{
    method,headers:{...(who?{Authorization:'Bearer '+tokens[who]}:{}),
      ...(method!=='GET'?{'Content-Type':'application/json'}:{})},
    ...(method!=='GET'?{body:JSON.stringify(data??{})}:{})
  });
  return {status:res.status,body:await res.json(),headers:res.headers};
 }
 return {state,request};
}
test('signed enrollment proof validates possession, identity and freshness',()=>{
 assert.equal(verifyDeviceEnrollmentProof({proof:payload.proof,publicKeySpki,
  ownerId,accountId,deviceId,nowMs:now}).verified,true);
 for(const altered of [
  {...payload.proof,ownerId:foreignId},
  {...payload.proof,issuedAt:now-150000},
  {...payload.proof,nonce:randomBytes(16).toString('hex')},
  {...payload.proof,signature:payload.proof.signature.slice(0,-2)+'ab'},
  {...payload.proof,unexpected:true}
 ])assert.throws(()=>verifyDeviceEnrollmentProof({proof:altered,publicKeySpki,
   ownerId,accountId,deviceId,nowMs:now}),/enrollment:/);
});
test('enrollment is disabled by default, with no fallback to unprivileged credentials',async t=>{
 const f=await fixture(t,{enabled:false});
 assert.equal((await f.request('/api/elitebridge/devices','owner')).status,503);
 assert.equal(f.state.calls.length,0);
});
test('enrollment requires authentication and completed MFA, rejecting unknown owner',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('/api/elitebridge/devices')).status,401);
 assert.equal((await f.request('/api/elitebridge/devices','ownerNoMfa',payload)).status,403);
 assert.equal((await f.request('/api/elitebridge/devices','ownerAal1',payload)).status,401);
 assert.equal((await f.request('/api/elitebridge/devices','foreign',payload)).status,404);
 assert.equal(f.state.calls.length,0);
});
test('valid ownership and signed key possession can stage pending only',async t=>{
 const f=await fixture(t);
 const res=await f.request('/api/elitebridge/devices','owner',payload);
 assert.equal(res.status,201);
 assert.equal(res.body.state,'pending');assert.equal(res.body.ordersEnabled,false);
 assert.ok(!JSON.stringify(res.body).includes(publicKeySpki));
 assert.equal(f.state.calls[0].name,'elitetrade_bridge_stage');
 assert.equal((await f.request('/api/elitebridge/devices','owner',{
   ...payload,proof:{...payload.proof,ownerId:foreignId}
 })).status,400);
 assert.equal(f.state.calls.length,1);
 const inv=await f.request('/api/elitebridge/devices','owner');
 assert.equal(inv.status,200);
 assert.equal(inv.headers.get('cache-control'),'no-store');
 assert.equal(inv.body.devices.length,1);
 assert.ok(!JSON.stringify(inv.body).includes('SECRET_MUST_NOT_ESCAPE'));
});
test('only admin with completed MFA approves, owner may revoke; never place orders',async t=>{
 const f=await fixture(t);
 await f.request('/api/elitebridge/devices','owner',payload);
 const endpoint='/api/elitebridge/devices/'+deviceId+'/approve';
 assert.equal((await f.request(endpoint,'owner',{},'POST')).status,403);
 assert.equal((await f.request(endpoint,'admin',{},'POST')).status,200);
 const done=await f.request('/api/elitebridge/devices/'+deviceId+'/revoke','owner',{},'POST');
 assert.equal(done.status,200);assert.equal(done.body.state,'revoked');
 assert.equal(f.state.audit.length,3);
 assert.ok(f.state.calls.every(x=>x.name.startsWith('elitetrade_bridge_')));
});
test('Phase 4.1 inventory and SQL RPC are server-only, redacted and do not grant order privileges',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015000200_elitebridge_phase41_inventory.sql',import.meta.url),'utf8');
 const backend=readFileSync(new URL('../src/supabase-app.mjs',import.meta.url),'utf8');
 assert.match(sql,/current_user <> 'service_role'/);
 assert.match(sql,/from public,anon,authenticated/);
 assert.match(sql,/to service_role/);
 assert.doesNotMatch(sql,/public_key_spki|demoOrder|order_send/);
 assert.match(backend,/ELITEBRIDGE_ENROLLMENT_ENABLED/);
 assert.match(backend,/needAdmin\(req\)/);
 assert.doesNotMatch(backend.slice(backend.indexOf('const bridgeDeviceMatch='),backend.indexOf("if (path === '/api/elitebridge/status'")),/\.demoOrder\(|\.market\(/);
});
