// Optional, READ-ONLY connectivity check for our own self-issued EliteBridge
// token. This does not talk to a broker, upload MT5 data or issue an order.
import {extractEliteBridgeToken,ELITEBRIDGE_TOKEN_SCOPE} from './elitebridge-tokens.mjs';

export const ELITEBRIDGE_OWN_STATUS_PATH='/api/elitebridge/token/status';
const block=(name)=>{throw new Error('EliteBridge token check: '+name)};
export function eliteBridgeSafeStatusEndpoint(origin){
  if(typeof origin!=='string'||origin.length>2048)block('INVALID_SERVER_URL');
  let parsed;
  try{parsed=new URL(origin)}catch{block('INVALID_SERVER_URL')}
  if(parsed.protocol!=='https:'||parsed.hostname!=='elitetradee.vercel.app'||parsed.username||parsed.password||
     parsed.search||parsed.hash||parsed.pathname!=='/'||parsed.port && parsed.port!=='443')
    block('HTTPS_BASE_URL_REQUIRED');
  return new URL(ELITEBRIDGE_OWN_STATUS_PATH,parsed).toString();
}
export async function checkOwnEliteBridgeToken({token,serverUrl,fetcher=fetch}={}){
  if(typeof token!=='string'||extractEliteBridgeToken('EliteBridge '+token)!==token)
    block('INVALID_OWN_TOKEN');
  if(typeof fetcher!=='function')block('INVALID_TRANSPORT');
  const endpoint=eliteBridgeSafeStatusEndpoint(serverUrl);
  let response;
  try{
    response=await fetcher(endpoint,{
      method:'GET',
      headers:{Authorization:'EliteBridge '+token,Accept:'application/json'},
      cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)
    });
  }catch{block('STATUS_NETWORK_UNAVAILABLE')}
  if(response?.status===401)block('TOKEN_UNAUTHORIZED_OR_REVOKED');
  if(!response?.ok)block('STATUS_BACKEND_NOT_READY');
  let data;
  try{data=await response.json()}catch{block('INVALID_STATUS_RESPONSE')}
  // Fail closed: no opaque status key can claim MT5 or broker authority.
  if(!data||data.provider!=='elitebridge'||data.authenticated!==true||
     data.scope!==ELITEBRIDGE_TOKEN_SCOPE||data.bridgeBackendReady!==true||
     data.mt5TerminalConnected!==false||data.brokerVerified!==false||
     data.tradeExecutionEnabled!==false||data.metaapiFallbackPreserved!==true)
    block('UNTRUSTED_STATUS_RESPONSE');
  return Object.freeze({tokenAuthenticated:true,scope:ELITEBRIDGE_TOKEN_SCOPE,
    terminalConnected:false,brokerVerified:false,ordersEnabled:false,
    metaapiFallbackPreserved:true});
}
