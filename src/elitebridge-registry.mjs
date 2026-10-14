import {createPublicKey, createHash} from 'node:crypto';
import {verifyBridgePacket} from './elitebridge-protocol.mjs';

// Phase 4 adapter: backend-only, no HTTP endpoint, broker adapter or trade commands.
// Production calls require a privileged Supabase client kept on the server.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireUuid(value,name){
  if(typeof value!=='string'||!uuid.test(value))throw new Error('EliteBridge: invalid '+name);
  return value.toLowerCase();
}
function requireRegistryResult(value){
  if(value!==true)throw new Error('EliteBridge: device state change rejected');
}
export function bridgePublicKeyIdentity(spki){
  if(typeof spki!=='string'||!/^[A-Za-z0-9_-]{58,100}$/.test(spki))
    throw new Error('EliteBridge: invalid public key encoding');
  const bytes=Buffer.from(spki,'base64url');
  if(bytes.toString('base64url')!==spki)throw new Error('EliteBridge: noncanonical public key');
  let key;
  try{key=createPublicKey({key:bytes,format:'der',type:'spki'});}
  catch{throw new Error('EliteBridge: invalid public key');}
  if(key.asymmetricKeyType!=='ed25519'||
      key.export({format:'der',type:'spki'}).toString('base64url')!==spki)
    throw new Error('EliteBridge: expected an Ed25519 public key');
  return {key,spki,fingerprint:createHash('sha256').update(bytes).digest('hex')};
}
export function createEliteBridgeRegistry({db}={}){
  if(!db||typeof db.rpc!=='function')throw new Error('EliteBridge: trusted persistent store required');
  return {
    async stage({ownerId,accountId,deviceId,displayName,publicKeySpki}={}){
      const owner=requireUuid(ownerId,'owner ID'),account=requireUuid(accountId,'account ID'),
        device=requireUuid(deviceId,'device ID');
      if(typeof displayName!=='string'||displayName.trim().length<1||displayName.trim().length>64)
        throw new Error('EliteBridge: invalid device name');
      const {spki,fingerprint}=bridgePublicKeyIdentity(publicKeySpki);
      requireRegistryResult(await db.rpc('elitetrade_bridge_stage',{
        p_owner_id:owner,p_account_id:account,p_device_id:device,
        p_display_name:displayName.trim(),p_public_key_spki:spki,p_fingerprint:fingerprint
      }));
      return {deviceId:device,state:'pending',fingerprint,demoOnly:true,ordersEnabled:false};
    },
    async approve({actorId,deviceId}={}){
      requireRegistryResult(await db.rpc('elitetrade_bridge_approve',{
        p_actor_id:requireUuid(actorId,'approver ID'),p_device_id:requireUuid(deviceId,'device ID')
      }));
      return {deviceId:deviceId.toLowerCase(),state:'approved',ordersEnabled:false};
    },
    async revoke({actorId,deviceId}={}){
      requireRegistryResult(await db.rpc('elitetrade_bridge_revoke',{
        p_actor_id:requireUuid(actorId,'revoker ID'),p_device_id:requireUuid(deviceId,'device ID')
      }));
      return {deviceId:deviceId.toLowerCase(),state:'revoked',ordersEnabled:false};
    },
    async verifySignedDemo({ownerId,accountId,deviceId,packet,nowMs=Date.now(),persistSnapshot=false}={}){
      const owner=requireUuid(ownerId,'owner ID'),account=requireUuid(accountId,'account ID'),
        device=requireUuid(deviceId,'device ID');
      // Read key for an approved, scoped enrollment; no client-supplied keys.
      const stored=await db.rpc('elitetrade_bridge_key',{
        p_owner_id:owner,p_account_id:account,p_device_id:device
      });
      if(!stored)throw new Error('EliteBridge: device is not approved');
      const {key}=bridgePublicKeyIdentity(stored);
      return verifyBridgePacket({packet,publicKey:key,accountId:account,deviceId:device,
        role:'terminal',nowMs,replayStore:{claim:({sequence,messageId})=>
          persistSnapshot
            ? db.rpc('elitetrade_bridge_record_packet',{p_owner_id:owner,p_account_id:account,
              p_device_id:device,p_sequence:sequence,p_message_id:messageId,
              p_kind:packet.kind,p_payload:packet.payload})
            : db.rpc('elitetrade_bridge_claim',{p_owner_id:owner,p_account_id:account,
              p_device_id:device,p_sequence:sequence,p_message_id:messageId,p_kind:packet.kind})
        }});
    }
  };
}
