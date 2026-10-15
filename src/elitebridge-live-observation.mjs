import {randomBytes, sign, verify} from 'node:crypto';

// REAL-account observability protocol. VERSION 4 CAN NEVER AUTHORIZE ORDERS.
// This separate signing domain cannot be confused with Phase 3 DEMO packets.
// Account mode is terminal-reported, not independent broker attestation.
export const LIVE_OBSERVATION_VERSION=4;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX=/^[a-f0-9]{32}$/;
const SYMBOL=/^[A-Za-z0-9._-]{3,30}$/;
const KINDS=new Set(['terminal.heartbeat','terminal.quote']);
const isObject=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>isObject(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const requireValid=(ok,message)=>{if(!ok)throw new Error('EliteBridge live observation: '+message);};

function canonicalPayload(kind,value){
  if(kind==='terminal.heartbeat'){
    requireValid(exact(value,['accountType','connected','tradeAllowed']),'invalid heartbeat fields');
    requireValid(value.accountType==='real','only explicit REAL observation packets use v4');
    requireValid(typeof value.connected==='boolean'&&typeof value.tradeAllowed==='boolean','invalid heartbeat flags');
    return {accountType:'real',connected:value.connected,tradeAllowed:value.tradeAllowed};
  }
  if(kind==='terminal.quote'){
    requireValid(exact(value,['accountType','symbol','bid','ask','observedAt']),'invalid quote fields');
    requireValid(value.accountType==='real','only explicit REAL observation packets use v4');
    requireValid(typeof value.symbol==='string'&&SYMBOL.test(value.symbol),'invalid instrument');
    requireValid(typeof value.bid==='number'&&Number.isFinite(value.bid)&&value.bid>0,'invalid bid');
    requireValid(typeof value.ask==='number'&&Number.isFinite(value.ask)&&value.ask>=value.bid,'invalid ask');
    requireValid(Number.isSafeInteger(value.observedAt)&&value.observedAt>0,'invalid quote time');
    return {accountType:'real',symbol:value.symbol,bid:value.bid,ask:value.ask,observedAt:value.observedAt};
  }
  throw new Error('EliteBridge live observation: unsupported message kind');
}
function signedBytes(packet){
  requireValid(isObject(packet),'packet required');
  requireValid(packet.version===LIVE_OBSERVATION_VERSION,'invalid protocol version');
  requireValid(KINDS.has(packet.kind),'order/command messages forbidden');
  requireValid(typeof packet.accountId==='string'&&UUID.test(packet.accountId),'invalid account ID');
  requireValid(typeof packet.deviceId==='string'&&UUID.test(packet.deviceId),'invalid device ID');
  requireValid(Number.isSafeInteger(packet.sequence)&&packet.sequence>0,'invalid sequence');
  requireValid(typeof packet.messageId==='string'&&HEX.test(packet.messageId),'invalid message ID');
  requireValid(Number.isSafeInteger(packet.issuedAt)&&packet.issuedAt>0,'invalid issue time');
  requireValid(Number.isSafeInteger(packet.expiresAt)&&
    packet.expiresAt>packet.issuedAt&&packet.expiresAt-packet.issuedAt<=90000,'invalid expiry');
  const payload=canonicalPayload(packet.kind,packet.payload);
  return Buffer.from('EliteBridge/live-observation/v4\n'+JSON.stringify([
    packet.version,packet.kind,packet.accountId.toLowerCase(),packet.deviceId.toLowerCase(),
    packet.sequence,packet.messageId,packet.issuedAt,packet.expiresAt,payload
  ]));
}
export function signLiveObservation({privateKey,kind,accountId,deviceId,sequence,payload,
  issuedAt=Date.now(),expiresAt=issuedAt+90000,
  messageId=randomBytes(16).toString('hex')}={}){
  requireValid(privateKey,'private signing key required');
  const packet={version:LIVE_OBSERVATION_VERSION,kind,accountId,deviceId,
    sequence,messageId,issuedAt,expiresAt,payload};
  return {...packet,signature:sign(null,signedBytes(packet),privateKey).toString('base64url')};
}
export async function verifyLiveObservation({packet,publicKey,accountId,deviceId,
  replayStore,nowMs=Date.now()}={}){
  requireValid(publicKey,'approved pinned key required');
  requireValid(replayStore&&typeof replayStore.claim==='function','atomic durable replay store required');
  requireValid(typeof accountId==='string'&&UUID.test(accountId),'approved account required');
  requireValid(typeof deviceId==='string'&&UUID.test(deviceId),'approved device required');
  requireValid(exact(packet,['version','kind','accountId','deviceId','sequence',
    'messageId','issuedAt','expiresAt','payload','signature']),'unexpected fields');
  const bytes=signedBytes(packet);
  requireValid(packet.accountId.toLowerCase()===accountId.toLowerCase()&&
    packet.deviceId.toLowerCase()===deviceId.toLowerCase(),'account/device scope mismatch');
  requireValid(Number.isSafeInteger(nowMs)&&nowMs>0,'server clock unavailable');
  requireValid(packet.issuedAt>=nowMs-120000&&packet.issuedAt<=nowMs+30000&&
    packet.expiresAt>nowMs,'expired or future packet');
  if(packet.kind==='terminal.quote')
    requireValid(packet.payload.observedAt>=nowMs-180000&&
      packet.payload.observedAt<=nowMs+30000,'stale or future quote');
  requireValid(typeof packet.signature==='string'&&/^[A-Za-z0-9_-]{86}$/.test(packet.signature),
    'invalid signature encoding');
  let authentic=false;
  try{authentic=verify(null,bytes,publicKey,Buffer.from(packet.signature,'base64url'));}catch{}
  requireValid(authentic,'signature verification failed');
  const claimed=await replayStore.claim({accountId:accountId.toLowerCase(),
    deviceId:deviceId.toLowerCase(),role:'terminal',sequence:packet.sequence,
    messageId:packet.messageId});
  requireValid(claimed===true,'duplicate or out-of-order message');
  return {verified:true,kind:packet.kind,sequence:packet.sequence,
    accountType:'real',brokerVerified:false,ordersEnabled:false,readOnly:true};
}
