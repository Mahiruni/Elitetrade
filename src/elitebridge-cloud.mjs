import {createPublicKey, randomUUID, randomBytes} from 'node:crypto';
import {terminalChallenge,verifyTerminalChallenge} from './elitebridge-device-proof.mjs';
import {verifyBridgePacket} from './elitebridge-protocol.mjs';
import {verifyLiveObservation} from './elitebridge-live-observation.mjs';

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
        'owner_id=eq.'+encodeURIComponent(ownerId)+'&select=id,account_id,label,account_mode,status,created_at,approved_at,revoked_at,last_sequence,last_seen_at,proof_verified_at&order=created_at.desc&limit=30');
      const at=Date.now();
      const terminals=(rows||[]).map(t=>{
        const {id,account_id,label,account_mode,status,created_at,approved_at,
          revoked_at,last_sequence,last_seen_at,proof_verified_at}=t;
        const seen=last_seen_at?Date.parse(last_seen_at):NaN;
        const ageSeconds=Number.isFinite(seen)?Math.max(0,Math.floor((at-seen)/1000)):null;
        const telemetryState=status!=='approved'?'not-approved':
          ageSeconds===null?'never-received':ageSeconds<=90?'recent':'stale';
        // Project a strict allowlist regardless of what the DB adapter returns.
        // Never include public/private PEMs, challenge nonces or other internals.
        return {id,account_id,label,account_mode,status,created_at,approved_at,
          revoked_at,last_sequence,last_seen_at,proof_verified_at,
          telemetryState,ageSeconds,brokerVerified:false,ordersEnabled:false};
      });
      return {terminals,brokerVerified:false,ordersEnabled:false};
    },
    async enroll({ownerId,accountId,label,publicKey,
      accountMode='demo',realAcknowledgement}){
      if(!['demo','real'].includes(accountMode))throw error(400,'Choose an explicit account mode.');
      if(accountMode==='real' && realAcknowledgement!=='REAL_OBSERVATION_ONLY')
        throw error(400,'Acknowledge that REAL account telemetry cannot place orders.');
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
        label:label.trim(),public_key:canonicalKey,status:'pending',account_mode:accountMode
      });
      if(!rows?.[0]?.id)throw error(503,'Terminal enrollment was not saved.');
      return {terminalId:rows[0].id,status:'pending',accountMode,
        message:'Pending manual administrator approval. No broker connection or orders enabled.'};
    },
    async issueChallenge({ownerId,deviceId}){
      ready();requireUuid(ownerId,'owner');requireUuid(deviceId,'terminal');
      const row=await db.one('elitetrade_bridge_terminals',
        'id=eq.'+encodeURIComponent(deviceId)+'&owner_id=eq.'+
        encodeURIComponent(ownerId)+'&status=eq.pending&select=id,account_id,account_mode,proof_verified_at');
      if(!row||row.proof_verified_at)
        throw error(409,'Terminal must be pending and unverified.');
      const nonce=randomBytes(32).toString('hex');
      const expiresAtMs=Date.now()+10*60000;
      const rows=await db.update('elitetrade_bridge_terminals',
        'id=eq.'+encodeURIComponent(deviceId)+'&owner_id=eq.'+
          encodeURIComponent(ownerId)+'&status=eq.pending&proof_verified_at=is.null',
        {proof_nonce:nonce,proof_expires_at:new Date(expiresAtMs).toISOString()});
      if(!rows?.length)throw error(409,'Terminal challenge could not be created.');
      return {terminalId:deviceId,challenge:terminalChallenge({
        deviceId,accountId:row.account_id,accountMode:row.account_mode,nonce,expiresAtMs
      }),expiresAt:new Date(expiresAtMs).toISOString(),ordersEnabled:false,
        message:'Sign this one-time challenge ONLY on the intended terminal using its local private key.'};
    },
    async prove({ownerId,deviceId,signature}){
      ready();requireUuid(ownerId,'owner');requireUuid(deviceId,'terminal');
      const row=await db.one('elitetrade_bridge_terminals',
        'id=eq.'+encodeURIComponent(deviceId)+'&owner_id=eq.'+
        encodeURIComponent(ownerId)+'&status=eq.pending&select=id,account_id,account_mode,public_key,proof_nonce,proof_expires_at,proof_verified_at');
      if(!row||row.proof_verified_at||!row.proof_nonce||!row.proof_expires_at)
        throw error(409,'Request a new terminal challenge.');
      const expiresAtMs=Date.parse(row.proof_expires_at);
      if(!Number.isSafeInteger(expiresAtMs)||expiresAtMs<=Date.now())
        throw error(409,'Pairing challenge expired; issue a new one.');
      let verified=false;
      try {
        verified=verifyTerminalChallenge({
          publicKey:row.public_key,
          challenge:terminalChallenge({deviceId,accountId:row.account_id,
            accountMode:row.account_mode,nonce:row.proof_nonce,expiresAtMs}),
          signature
        });
      } catch {}
      if(!verified)throw error(403,'Terminal possession proof failed.');
      const rows=await db.update('elitetrade_bridge_terminals',
        'id=eq.'+encodeURIComponent(deviceId)+'&owner_id=eq.'+
        encodeURIComponent(ownerId)+'&status=eq.pending&proof_verified_at=is.null'+
        '&proof_nonce=eq.'+encodeURIComponent(row.proof_nonce)+
        '&proof_expires_at=gt.'+encodeURIComponent(new Date().toISOString()),
        {proof_verified_at:new Date().toISOString(),proof_nonce:null,proof_expires_at:null});
      if(!rows?.length)throw error(409,'Pairing challenge was consumed or expired.');
      return {terminalId:deviceId,proofVerified:true,status:'pending',
        message:'Device key possession verified. Administrator approval is still required.',
        ordersEnabled:false};
    },
    async setApproval({ownerId,deviceId,approve}){
      ready();requireUuid(ownerId,'owner');requireUuid(deviceId,'terminal');
      const state=approve?'approved':'revoked';
      const rows=await db.update('elitetrade_bridge_terminals',
        'id=eq.'+encodeURIComponent(deviceId)+'&owner_id=eq.'+encodeURIComponent(ownerId)+
        (approve?'&status=eq.pending&proof_verified_at=not.is.null':'&status=in.(pending,approved)'),
        approve?{status:state,approved_at:new Date().toISOString()}:
          {status:state,revoked_at:new Date().toISOString()});
      if(!rows?.length)throw error(409,'Device must prove key ownership before approval, or the state transition is invalid.');
      return {terminalId:deviceId,status:state,ordersEnabled:false};
    },
    async receive(packet,{realObservationEnabled=false}={}){
      ready();
      // Reject malformed or unsupported messages before any database read.
      if(!packet||typeof packet!=='object'||Array.isArray(packet)||
         !['terminal.heartbeat','terminal.quote'].includes(packet.kind)||
         ![3,4].includes(packet.version)||
         (packet.version===4&&!realObservationEnabled)||
         !uuid.test(packet.deviceId||'')||!uuid.test(packet.accountId||'')||
         typeof packet.signature!=='string'||packet.signature.length!==86)
        throw error(403,'Signed DEMO telemetry rejected.');
      const record=await db.one('elitetrade_bridge_terminals',
        'id=eq.'+encodeURIComponent(packet.deviceId)+'&status=eq.approved'+
        '&select=id,account_id,account_mode,public_key,status');
      if(!record||record.account_id?.toLowerCase()!==packet.accountId.toLowerCase()||
         (packet.version===3 && record.account_mode!=='demo')||
         (packet.version===4 && record.account_mode!=='real')||
         packet.payload?.accountType!==record.account_mode)
        throw error(403,'Signed DEMO telemetry rejected.');
      try{
        const identity={
          packet,publicKey:createPublicKey(record.public_key),
          accountId:record.account_id,deviceId:record.id,
          replayStore:{claim:({sequence,messageId})=>db.rpc('elitetrade_bridge_claim',{
            p_terminal_id:record.id,p_account_id:record.account_id,p_sequence:sequence,
            p_message_id:messageId,p_kind:packet.kind,p_payload:packet.payload
          })}
        };
        const result=packet.version===3?
          await verifyBridgePacket({...identity,role:'terminal'}):
          await verifyLiveObservation(identity);
        return {accepted:true,kind:result.kind,sequence:result.sequence,
          accountMode:record.account_mode,demoOnly:record.account_mode==='demo',
          readOnly:true,brokerVerified:false,ordersEnabled:false,
          message:'Signed read-only telemetry stored; independent broker verification and trading remain disabled.'};
      }catch(err){
        if(err?.status===503)throw err;
        if(/replay or out-of-order|duplicate or out-of-order/.test(err?.message||''))
          throw error(409,'Duplicate or out-of-order packet.');
        if(err?.message?.startsWith('EliteBridge:')||
           err?.message?.startsWith('EliteBridge live observation:'))
          throw error(403,'Signed telemetry rejected.');
        // Unknown database failure is not a protocol rejection; fail closed,
        // report temporary outage, and do not leak database details to callers.
        throw error(503,'Secure telemetry storage unavailable.');
      }
    }
  };
}
