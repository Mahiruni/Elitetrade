import {generateKeyPairSync, randomBytes, sign, verify} from 'node:crypto';

// Phase 3 SANDBOX. Signing packet != broker verification. No trade commands.
export const BRIDGE_VERSION=3;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex=/^[a-f0-9]{32}$/;
const symbol=/^[A-Za-z0-9._-]{3,30}$/;
const kinds=new Set(['terminal.heartbeat','terminal.quote','controller.ack']);
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>isObj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function requireValid(ok,message){if(!ok)throw new Error('EliteBridge: '+message)}
function sanitizedPayload(kind,p) {
  if(kind==='terminal.heartbeat'){
    requireValid(exact(p,['accountType','connected','tradeAllowed']),'invalid heartbeat fields');
    requireValid(p.accountType==='demo','REAL accounts are prohibited');
    requireValid(typeof p.connected==='boolean'&&typeof p.tradeAllowed==='boolean','invalid heartbeat flags');
    return {accountType:'demo',connected:p.connected,tradeAllowed:p.tradeAllowed};
  }
  if(kind==='terminal.quote'){
    requireValid(exact(p,['accountType','symbol','bid','ask','observedAt']),'invalid quote fields');
    requireValid(p.accountType==='demo','REAL quotes are prohibited');
    requireValid(typeof p.symbol==='string'&&symbol.test(p.symbol),'invalid symbol');
    requireValid(typeof p.bid==='number'&&Number.isFinite(p.bid)&&p.bid>0,'invalid bid');
    requireValid(typeof p.ask==='number'&&Number.isFinite(p.ask)&&p.ask>=p.bid,'invalid ask');
    requireValid(Number.isSafeInteger(p.observedAt)&&p.observedAt>0,'invalid quote timestamp');
    return {accountType:'demo',symbol:p.symbol,bid:p.bid,ask:p.ask,observedAt:p.observedAt};
  }
  if(kind==='controller.ack'){
    requireValid(exact(p,['receivedMessageId','accepted']),'invalid receipt fields');
    requireValid(hex.test(p.receivedMessageId)&&p.accepted===true,'invalid receipt');
    return {receivedMessageId:p.receivedMessageId,accepted:true};
  }
  throw new Error('EliteBridge: unsupported packet kind');
}
function signatureBytes(packet){
  requireValid(isObj(packet),'packet required');
  requireValid(packet.version===BRIDGE_VERSION,'protocol version mismatch');
  requireValid(kinds.has(packet.kind),'unsupported packet kind');
  requireValid(typeof packet.accountId==='string'&&uuid.test(packet.accountId),'invalid account ID');
  requireValid(typeof packet.deviceId==='string'&&uuid.test(packet.deviceId),'invalid device ID');
  requireValid(Number.isSafeInteger(packet.sequence)&&packet.sequence>0,'invalid sequence');
  requireValid(typeof packet.messageId==='string'&&hex.test(packet.messageId),'invalid message ID');
  requireValid(Number.isSafeInteger(packet.issuedAt)&&packet.issuedAt>0,'invalid issue time');
  requireValid(Number.isSafeInteger(packet.expiresAt)&&packet.expiresAt>packet.issuedAt&&
    packet.expiresAt-packet.issuedAt<=90000,'invalid expiry');
  const payload=sanitizedPayload(packet.kind,packet.payload);
  // Domain separator and array canonicalization bind every signed field.
  return Buffer.from('EliteBridge/v3\n'+JSON.stringify([packet.version,packet.kind,
    packet.accountId.toLowerCase(),packet.deviceId.toLowerCase(),packet.sequence,
    packet.messageId,packet.issuedAt,packet.expiresAt,payload]));
}
export function createSandboxKeys(){
  // Ephemeral tests only. Never put an enrolled private key in the Android APK.
  return generateKeyPairSync('ed25519');
}
export function signBridgePacket({privateKey,kind,accountId,deviceId,sequence,payload,
  issuedAt=Date.now(),expiresAt=issuedAt+90000,
  messageId=randomBytes(16).toString('hex')}={}){
  requireValid(privateKey,'signing key is required');
  const packet={version:BRIDGE_VERSION,kind,accountId,deviceId,sequence,messageId,
    issuedAt,expiresAt,payload};
  const signature=sign(null,signatureBytes(packet),privateKey).toString('base64url');
  return {...packet,signature};
}
export async function verifyBridgePacket({packet,publicKey,accountId,deviceId,role,
  replayStore,nowMs=Date.now()}={}){
  requireValid(publicKey,'pinned public key required');
  requireValid(replayStore&&typeof replayStore.claim==='function',
    'durable atomic replay claim required');
  requireValid(typeof accountId==='string'&&uuid.test(accountId),'expected account required');
  requireValid(typeof deviceId==='string'&&uuid.test(deviceId),'expected device required');
  requireValid(role==='terminal'||role==='controller','expected signer role required');
  requireValid(exact(packet,['version','kind','accountId','deviceId','sequence',
    'messageId','issuedAt','expiresAt','payload','signature']),'unexpected signed fields');
  const bytes=signatureBytes(packet);
  requireValid(packet.accountId.toLowerCase()===accountId.toLowerCase()&&
    packet.deviceId.toLowerCase()===deviceId.toLowerCase(),'identity scope mismatch');
  requireValid(packet.kind.startsWith(role+'.'),'signer role mismatch');
  requireValid(Number.isSafeInteger(nowMs)&&nowMs>0,'bad server clock');
  requireValid(packet.issuedAt>=nowMs-120000&&packet.issuedAt<=nowMs+30000&&
    packet.expiresAt>nowMs,'expired or future packet');
  if(packet.kind==='terminal.quote')
    requireValid(packet.payload.observedAt>=nowMs-180000&&
      packet.payload.observedAt<=nowMs+30000,'stale or future quote');
  requireValid(typeof packet.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(packet.signature),
    'invalid signature encoding');
  let authentic=false;
  try{authentic=verify(null,bytes,publicKey,Buffer.from(packet.signature,'base64url'))}catch{}
  requireValid(authentic,'signature verification failed');
  // A real server needs an atomic durable DB compare-and-update, NOT a Map.
  const accepted=await replayStore.claim({accountId:accountId.toLowerCase(),
    deviceId:deviceId.toLowerCase(),role,sequence:packet.sequence,
    messageId:packet.messageId});
  requireValid(accepted===true,'replay or out-of-order sequence');
  return {verified:true,kind:packet.kind,sequence:packet.sequence,
    // A self-reported terminal state is NOT proof of an MT5 broker connection.
    brokerVerified:false,actionsAllowed:false,demoOnly:true};
}
export function createSandboxReplayStore(){
  const entries=new Map();
  return {async claim({accountId,deviceId,role,sequence}){
    const key=role+':'+accountId+':'+deviceId;
    if(!Number.isSafeInteger(sequence)||sequence<1||
       sequence<=(entries.get(key)||0))return false;
    entries.set(key,sequence);
    return true;
  }};
}
export function eliteBridgeProtocolStatus({cloudIngestEnabled=false}={}){
  return {version:BRIDGE_VERSION,phase:cloudIngestEnabled?4:3,
    state:cloudIngestEnabled?'enrollment-ready':'sandbox-only',
    cryptography:'Ed25519 signed envelopes',demoOnly:true,
    supportedPackets:[...kinds],expiresAfterSeconds:90,
    antiReplay:cloudIngestEnabled?'durable atomic PostgreSQL replay claim':
      'requires durable atomic sequence claim in production',
    pairingEnabled:cloudIngestEnabled,independentMT5Connected:false,
    terminalCompanionConnected:false,brokerVerified:false,ordersEnabled:false,
    note:cloudIngestEnabled?'Cloud transport accepts approved terminal DEMO telemetry; no terminal or broker has been independently verified, and orders are disabled.':
      'The protocol is implemented and locally testable. No MT5 broker connection, production pairing or order transport is implemented.'};
}
