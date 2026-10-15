import {sign,verify,createPublicKey,createPrivateKey} from 'node:crypto';

// Terminal possession proofs are AUTHENTICATION only; they grant neither
// broker connection attestation nor any order-execution authority.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE=/^[a-f0-9]{64}$/;
const SIGNATURE=/^[A-Za-z0-9_-]{86}$/;
const DOMAIN='EliteBridge/device-possession/v1';
function invalid(){throw Error('EliteBridge device proof: invalid or expired pairing challenge');}
export function terminalChallenge({deviceId,accountId,accountMode,nonce,expiresAtMs}={}){
  if(!UUID.test(deviceId||'')||!UUID.test(accountId||'')||
     !['demo','real'].includes(accountMode)||!NONCE.test(nonce||'')||
     !Number.isSafeInteger(expiresAtMs)||expiresAtMs<1)invalid();
  const message=[DOMAIN,deviceId.toLowerCase(),accountId.toLowerCase(),
    accountMode,nonce,expiresAtMs].join('\n');
  return Buffer.from(message).toString('base64url');
}
export function validatedChallenge(challenge,nowMs=Date.now()){
  if(typeof challenge!=='string'||challenge.length>700||
     !/^[A-Za-z0-9_-]{150,700}$/.test(challenge))invalid();
  let decoded;
  try{decoded=Buffer.from(challenge,'base64url').toString('utf8');}catch{invalid();}
  const lines=decoded.split('\n');
  if(lines.length!==6||lines[0]!==DOMAIN)invalid();
  const [domain,deviceId,accountId,accountMode,nonce,expiry]=lines;
  const expiresAtMs=Number(expiry);
  const canonical=terminalChallenge({deviceId,accountId,accountMode,nonce,expiresAtMs});
  if(challenge!==canonical || !Number.isSafeInteger(nowMs) ||
     expiresAtMs<=nowMs || expiresAtMs>nowMs+3600000)invalid();
  return {deviceId,accountId,accountMode,nonce,expiresAtMs,challenge:canonical};
}
export function signTerminalChallenge({privateKey,challenge,nowMs=Date.now()}={}){
  validatedChallenge(challenge,nowMs);
  if(!privateKey)invalid();
  const key=createPrivateKey(privateKey);
  if(key.asymmetricKeyType!=='ed25519')invalid();
  return sign(null,Buffer.from(challenge,'base64url'),key).toString('base64url');
}
export function verifyTerminalChallenge({publicKey,challenge,signature,nowMs=Date.now()}={}){
  validatedChallenge(challenge,nowMs);
  if(typeof signature!=='string'||!SIGNATURE.test(signature))return false;
  try{
    const key=createPublicKey(publicKey);
    return key.asymmetricKeyType==='ed25519'&&
      verify(null,Buffer.from(challenge,'base64url'),key,Buffer.from(signature,'base64url'));
  }catch{return false;}
}
