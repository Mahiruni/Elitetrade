import {randomBytes,sign,verify} from 'node:crypto';
import {bridgePublicKeyIdentity,createEliteBridgeRegistry} from './elitebridge-registry.mjs';

// Device enrollment proof is distinct from signed Phase 3 DEMO telemetry.
// This is proof-of-key-possession only, NEVER broker verification or authorization.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex=/^[a-f0-9]{32}$/;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function assert(ok,msg){if(!ok)throw new Error('EliteBridge enrollment: '+msg);}
function normalizeId(v,label){assert(typeof v==='string'&&uuid.test(v),'invalid '+label);return v.toLowerCase();}
function material({ownerId,accountId,deviceId,issuedAt,nonce}){
  return Buffer.from('EliteBridge/v4/device-enrollment\n'+JSON.stringify([
    normalizeId(ownerId,'owner'),normalizeId(accountId,'account'),normalizeId(deviceId,'device'),
    issuedAt,nonce]));
}
export function createDeviceEnrollmentProof({privateKey,ownerId,accountId,deviceId,
  issuedAt=Date.now(),nonce=randomBytes(16).toString('hex')}={}){
  assert(privateKey,'private key is required');
  assert(Number.isSafeInteger(issuedAt)&&issuedAt>0,'invalid issue time');
  assert(typeof nonce==='string'&&hex.test(nonce),'invalid nonce');
  const packet={ownerId:normalizeId(ownerId,'owner'),
    accountId:normalizeId(accountId,'account'),deviceId:normalizeId(deviceId,'device'),
    issuedAt,nonce};
  return {...packet,signature:sign(null,material(packet),privateKey).toString('base64url')};
}
export function verifyDeviceEnrollmentProof({proof,publicKeySpki,ownerId,accountId,deviceId,
  nowMs=Date.now()}={}){
  assert(exact(proof,['ownerId','accountId','deviceId','issuedAt','nonce','signature']),'invalid proof fields');
  assert(proof.ownerId===normalizeId(ownerId,'owner')&&
    proof.accountId===normalizeId(accountId,'account')&&
    proof.deviceId===normalizeId(deviceId,'device'),'scope mismatch');
  assert(Number.isSafeInteger(nowMs)&&nowMs>0,'invalid clock');
  assert(Number.isSafeInteger(proof.issuedAt)&&proof.issuedAt>=nowMs-90000&&
    proof.issuedAt<=nowMs+15000,'stale or future proof');
  assert(typeof proof.nonce==='string'&&hex.test(proof.nonce),'invalid nonce');
  assert(typeof proof.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(proof.signature),
    'invalid proof signature');
  const {key,fingerprint}=bridgePublicKeyIdentity(publicKeySpki);
  let valid=false;
  try{valid=verify(null,material(proof),key,Buffer.from(proof.signature,'base64url'))}catch{}
  assert(valid,'signature verification failed');
  return {verified:true,fingerprint,demoOnly:true,ordersEnabled:false};
}
export function createBridgeEnrollmentService({db,clock=()=>Date.now()}={}){
  const registry=createEliteBridgeRegistry({db});
  return {
    async stage({ownerId,accountId,deviceId,displayName,publicKeySpki,proof}={}){
      verifyDeviceEnrollmentProof({proof,publicKeySpki,ownerId,accountId,deviceId,nowMs:clock()});
      return registry.stage({ownerId,accountId,deviceId,displayName,publicKeySpki});
    },
    approve:params=>registry.approve(params),
    revoke:params=>registry.revoke(params),
    async inventory({actorId}={}){
      const actor=normalizeId(actorId,'actor');
      const data=await db.rpc('elitetrade_bridge_inventory',{p_actor_id:actor});
      assert(Array.isArray(data)&&data.length<=100,'invalid inventory response');
      return data.map(row=>({
        deviceId:row.device_id,ownerId:row.owner_id,accountId:row.account_id,
        displayName:row.display_name,fingerprint:row.fingerprint,
        state:row.state,lastSequence:row.last_sequence,
        createdAt:row.created_at,approvedAt:row.approved_at,revokedAt:row.revoked_at,
        brokerVerified:false,ordersEnabled:false
      }));
    }
  };
}
