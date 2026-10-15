import {createPublicKey, randomUUID} from 'node:crypto';
import {verifyBridgePacket} from './elitebridge-protocol.mjs';

// Phase 4 transport is READ-ONLY. A signature is device identity, not broker
// attestation or trading authorization. Only a server-held Supabase secret may
// access the terminal registry and its atomic PostgreSQL replay RPC.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const noControl=/^[^\u0000-\u001f\u007f]+$/;
function error(status,message){const e=new Error(message);e.status=status;return e}
function requireUuid(value,label){
  if(typeof value!=='string'||!uuid.test(value))throw error(400,'Invalid '+label+'.');
  return value.toLowerCase();
}
export function validateTerminalPublicKey(pem){
  if(typeof pem!=='string'||pem.length<80||pem.length>600||!pem.includes('BEGIN PUBLIC KEY'))
    throw error(400,'An Ed25519 public key in PEM format is required.');
  try{
    const key=createPublicKey(pem);
    if(key.asymmetricKeyType!=='ed25519')throw Error('not Ed25519');
    return key.export({format:'pem',type:'spki'}).toString();
  }catch{throw error(400,'Invalid Ed25519 public key.');}
}
export function createEliteBridgeCloud({db}={}){
  const ready=()=>{if(!db)throw error(503,'EliteBridge cloud enrollment is not configured.');};
  return {
    async list({ownerId}){
      ready();requireUuid(ownerId,'owner');
      const rows=await db.query('elitetrade_bridge_terminals',
        'owner_id=eq.'+encodeURIComponent(ownerId)+'&select=id,account_id,label,status,created_at,approved_at,revoked_at,last_sequence,last_seen_at&order=created_at.desc&limit=30');
      return {terminals:rows||[],brokerVerified:false,ordersEnabled:false};
    },
    async enroll({ownerId,accountId,label,publicKey}){
      ready();requireUuid(ownerId,'owner');requireUuid(accountId,'MT5 account');
      if(typeof label!=='string'||label.trim().length<3||label.trim().length>64||
         !noControl.test(label))throw error(400,'Terminal name must be 3–64 printable characters.');
      const canonicalKey=validateTerminalPublicKey(publicKey);
      const prior=await db.query('elitetrade_bridge_terminals',
        'owner_id=eq.'+encodeURIComponent(ownerId)+'&account_id=eq.'+
          encodeURIComponent(accountId)+'&status=in.(pending,approved)&select=id&limit=4');
      if((prior||[]).length>=3)throw error(409,'Revoke an existing terminal before enrolling another.');
      const rows=await db.insert('elitetrade_bridge_terminals',{
        id:randomUUID(),owner_id:ownerId,account_id:accountId,
        label:label.trim(),public_key:canonicalKey,status:'pending'
      });
      if(!rows?.[0]?.id)throw error(503,'Terminal enrollment was not saved.');
      return {terminalId:rows[0].id,status:'pending',
        message:'Pending manual administrator approval. No broker connection or orders enabled.'};
    },
    async setApproval({ownerId,deviceId,approve}){
      ready();requireUuid(ownerId,'owner');requireUuid(deviceId,'terminal');
      const state=approve?'approved':'revoked';
      const rows=await db.update('elitetrade_bridge_terminals',
        'id=eq.'+encodeURIComponent(deviceId)+'&owner_id=eq.'+encodeURIComponent(ownerId)+
        (approve?'&status=eq.pending':'&status=in.(pending,approved)'),
        approve?{status:state,approved_at:new Date().toISOString()}:
          {status:state,revoked_at:new Date().toISOString()});
      if(!rows?.length)throw error(409,'Terminal not found or state transition not allowed.');
      return {terminalId:deviceId,status:state,ordersEnabled:false};
    },
    async receive(packet){
      ready();
      // Reject malformed or unsupported messages before any database read.
      if(!packet||typeof packet!=='object'||Array.isArray(packet)||
         !['terminal.heartbeat','terminal.quote'].includes(packet.kind)||
         !uuid.test(packet.deviceId||'')||!uuid.test(packet.accountId||'')||
         typeof packet.signature!=='string'||packet.signature.length!==86)
        throw error(403,'Signed DEMO telemetry rejected.');
      const record=await db.one('elitetrade_bridge_terminals',
        'id=eq.'+encodeURIComponent(packet.deviceId)+'&status=eq.approved'+
        '&select=id,account_id,public_key,status');
      if(!record||record.account_id?.toLowerCase()!==packet.accountId.toLowerCase())
        throw error(403,'Signed DEMO telemetry rejected.');
      try{
        const result=await verifyBridgePacket({
          packet,publicKey:createPublicKey(record.public_key),
          accountId:record.account_id,deviceId:record.id,role:'terminal',
          replayStore:{claim:({sequence,messageId})=>db.rpc('elitetrade_bridge_claim',{
            p_terminal_id:record.id,p_account_id:record.account_id,p_sequence:sequence,
            p_message_id:messageId,p_kind:packet.kind,p_payload:packet.payload
          })}
        });
        return {accepted:true,kind:result.kind,sequence:result.sequence,
          demoOnly:true,brokerVerified:false,ordersEnabled:false,
          message:'Signed telemetry stored. This is not proof of a broker connection.'};
      }catch(err){
        if(err?.status===503)throw err;
        if(err?.message?.includes('replay or out-of-order'))throw error(409,'Duplicate or out-of-order packet.');
        if(err?.message?.startsWith('EliteBridge:'))throw error(403,'Signed DEMO telemetry rejected.');
        // Unknown database failure is not a protocol rejection; fail closed,
        // report temporary outage, and do not leak database details to callers.
        throw error(503,'Secure telemetry storage unavailable.');
      }
    }
  };
}
