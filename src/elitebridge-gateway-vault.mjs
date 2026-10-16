import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';

const aad=Buffer.from('EliteBridge/demo-gateway/v1');
export function sealGatewayConfig(config,key) {
  if(!Buffer.isBuffer(key)||key.length!==32)throw Error('Gateway key must be 32 bytes');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(aad);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(config),'utf8'),cipher.final()]);
  return {version:1,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64')};
}
export function openGatewayConfig(value,key) {
  try{
    if(value.version!==1||key.length!==32)throw Error();
    const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));
    decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(value.tag,'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext,'base64')),decipher.final()]).toString('utf8'));
  }catch{throw Error('Gateway vault could not be authenticated');}
}
export function privateGatewayFile(path) {
  const info=lstatSync(path);
  if(!info.isFile()||info.isSymbolicLink()||info.size>65536||
    (process.platform!=='win32'&&(info.mode&0o077)!==0))throw Error('Gateway secret file must be private and regular');
  return readFileSync(path);
}
