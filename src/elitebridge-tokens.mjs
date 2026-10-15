import {createHash,randomBytes} from 'node:crypto';

// This is OUR token (EliteBridge), never a MetaApi token. It only grants
// read-only gateway-status access and cannot authorize MT5 orders or telemetry.
export const ELITEBRIDGE_TOKEN_SCOPE='bridge:status';
const TOKEN_PATTERN=/^ebd_[A-Za-z0-9_-]{43}$/;
export function mintEliteBridgeToken(random=randomBytes){
  const entropy=random(32);
  if(!Buffer.isBuffer(entropy)||entropy.length!==32)
    throw new Error('A cryptographically secure 256-bit key is required.');
  return 'ebd_'+entropy.toString('base64url');
}
export function eliteBridgeTokenDigest(token){
  if(typeof token!=='string'||!TOKEN_PATTERN.test(token))
    throw new Error('Invalid EliteBridge API token format.');
  return createHash('sha256').update('EliteBridge/API/v1\n'+token).digest('hex');
}
export function validateBridgeTokenLabel(label){
  if(typeof label!=='string'||label.trim().length<3||label.trim().length>48||
    !/^[A-Za-z0-9][A-Za-z0-9 ._:-]*$/.test(label.trim()))
    throw new Error('Token label must be 3–48 letters, numbers or simple punctuation.');
  return label.trim();
}
export function validateBridgeTokenExpiry(hours){
  if(!Number.isInteger(hours)||hours<1||hours>720)
    throw new Error('Token lifetime must be 1–720 hours.');
  return hours;
}
export function extractEliteBridgeToken(header){
  if(typeof header!=='string'||!header.startsWith('EliteBridge '))return null;
  const token=header.slice('EliteBridge '.length);
  return TOKEN_PATTERN.test(token)?token:null;
}
export function publicBridgeTokenRecord(row){
  if(!row || typeof row!=='object')throw new Error('Invalid token record');
  return {
    id:row.id??row.token_id??null,
    label:String(row.label??'').slice(0,48),
    scope:ELITEBRIDGE_TOKEN_SCOPE,
    createdAt:row.created_at??null,
    expiresAt:row.expires_at??null,
    revokedAt:row.revoked_at??null
  };
}
