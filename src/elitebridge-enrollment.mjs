import {createPublicKey, verify, randomBytes, randomUUID} from 'node:crypto';
import {verifyBridgePacket} from './elitebridge-protocol.mjs';

// Own-broker research transport: a Windows terminal is required, no proxying
// MetaApi orders or reading MT5 passwords. All private keys stay on host.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const q=value=>encodeURIComponent(String(value));
const ensure=(condition,message)=>{if(!condition)throw new Error(message)};
const base64url=/^[A-Za-z0-9_-]{86}$/;
export const enrollmentMessage=({terminalId,nonce})=>
  Buffer.from('EliteBridge/terminal-enrollment/v1\n'+terminalId.toLowerCase()+'\n'+nonce);
export function checkTerminalPublicKey(value) {
  ensure(typeof value==='string'&&value.length>=85&&value.length<=300,'Invalid Ed25519 public key.');
  let key;
  try {key=createPublicKey(value);}catch{throw new Error('Invalid Ed25519 public key.')}
  ensure(key.asymmetricKeyType==='ed25519','Only Ed25519 terminal identities are supported.');
  return key.export({type:'spki',format:'pem'}).trim()+'\n';
}
export function createTerminalEnrollment({ownerId,accountId,label,publicKey,nowMs=Date.now()}){
  ensure(uuid.test(ownerId)&&uuid.test(accountId),'Invalid owner or account ID.');
  ensure(typeof label==='string'&&label.trim().length>=3&&label.trim().length<=64,'Terminal name must be 3-64 characters.');
  const key=checkTerminalPublicKey(publicKey);
  const id=randomUUID(),nonce=randomBytes(32).toString('hex');
  return {
    id,owner_id:ownerId,account_id:accountId,label:label.trim(),
    public_key:key,account_mode:'demo',status:'pending',
    proof_nonce:nonce,proof_expires_at:new Date(nowMs+10*60000).toISOString()
  };
}
export function verifyEnrollmentProof({terminal,signature,nowMs=Date.now()}) {
  ensure(terminal&&uuid.test(terminal.id)&&terminal.status==='pending','Terminal registration is unavailable.');
  ensure(!terminal.proof_verified_at,'Terminal proof was already accepted.');
  ensure(typeof terminal.proof_nonce==='string'&&/^[a-f0-9]{64}$/.test(terminal.proof_nonce) &&
    nowMs<Date.parse(terminal.proof_expires_at),'Enrollment challenge expired.');
  ensure(typeof signature==='string'&&base64url.test(signature),'Invalid proof signature.');
  const key=checkTerminalPublicKey(terminal.public_key);
  let valid=false;
  try {valid=verify(null,enrollmentMessage({terminalId:terminal.id,nonce:terminal.proof_nonce}),
    key,Buffer.from(signature,'base64url'));}catch{}
  ensure(valid,'Invalid terminal proof.');
  return true;
}
export function publicTerminalSummary(row,nowMs=Date.now()) {
  const seen=Date.parse(row?.last_seen_at||'');
  return {
    id:row.id,label:row.label,accountId:row.account_id,
    mode:row.account_mode,status:row.status,
    identityProofVerified:!!row.proof_verified_at,
    enrollmentExpiresAt:row.proof_verified_at?null:row.proof_expires_at||null,
    lastPacketAt:row.last_seen_at||null,
    signedTransportFresh:row.status==='approved'&&Number.isFinite(seen)&&seen<=nowMs+5000&&nowMs-seen<120000,
    brokerVerified:false,ordersEnabled:false
  };
}
export async function ingestSignedTerminalPacket({packet,terminal,db,nowMs=Date.now()}) {
  ensure(terminal?.status==='approved'&&terminal.proof_verified_at&&terminal.account_mode==='demo'&&!terminal.revoked_at,
    'Terminal is not an approved demo-only identity.');
  ensure(packet?.deviceId===terminal.id&&packet.accountId===terminal.account_id,
    'Terminal identity is not authorized for this account.');
  const result=await verifyBridgePacket({
    packet,publicKey:checkTerminalPublicKey(terminal.public_key),
    accountId:terminal.account_id,deviceId:terminal.id,role:'terminal',
    nowMs,replayStore:{
      claim:async({sequence,messageId})=>{
        const accepted=await db.rpc('elitetrade_bridge_claim',{
          p_terminal_id:terminal.id,p_account_id:terminal.account_id,
          p_sequence:sequence,p_message_id:messageId,
          p_kind:packet.kind,p_payload:packet.payload
        });
        return accepted===true;
      }
    }
  });
  return {accepted:result.verified===true,kind:result.kind,sequence:result.sequence,
    independentBrokerVerified:false,ordersEnabled:false};
}
