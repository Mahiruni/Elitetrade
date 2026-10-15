// EliteBridge Phase 6: isolated, read-only Windows terminal telemetry sender.
// No order API, account login, broker credentials or provider fallback exists here.
import {
  generateKeyPairSync,createPrivateKey,createPublicKey,createHash,randomUUID
} from 'node:crypto';
import {
  mkdirSync,lstatSync,readFileSync,writeFileSync,openSync,closeSync,
  fsyncSync,renameSync,unlinkSync,chmodSync,existsSync
} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {signBridgePacket} from './elitebridge-protocol.mjs';
import {signLiveObservation} from './elitebridge-live-observation.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYMBOL=/^[A-Za-z0-9._-]{3,30}$/;
const OBS_KEYS=['source','accountType','terminalConnectedClaim',
  'terminalTradeAllowedClaim','symbol','bid','ask','observedAt',
  'collectedAt','brokerVerified','ordersEnabled'];
const err=message=>new Error('EliteBridge terminal uplink: '+message);
const validUUID=(v,name)=>{
  if(typeof v!=='string'||!UUID.test(v))throw err('invalid '+name);
  return v.toLowerCase();
};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const matchKeys=(o,keys)=>plain(o)&&Object.keys(o).sort().join('|')===keys.slice().sort().join('|');
function checkedHome(path){
  if(typeof path!=='string'||!isAbsolute(path))throw err('absolute local identity directory required');
  mkdirSync(path,{recursive:true,mode:0o700});
  if(lstatSync(path).isSymbolicLink())throw err('identity directory cannot be a symlink');
  return path;
}
function safeReadFile(path){
  if(lstatSync(path).isSymbolicLink())throw err('identity file cannot be a symlink');
  const stat=lstatSync(path);
  if(!stat.isFile())throw err('identity path must be a file');
  if(process.platform!=='win32'&&(stat.mode&0o077)!==0)
    throw err('identity permissions are too broad');
  return readFileSync(path,'utf8');
}
function pemPublic(privateKey){
  const key=createPrivateKey(privateKey);
  if(key.asymmetricKeyType!=='ed25519')throw err('Ed25519 identity required');
  return createPublicKey(key).export({type:'spki',format:'pem'}).toString();
}
export function terminalFingerprint(publicKeyPem){
  return createHash('sha256').update(
    createPublicKey(publicKeyPem).export({type:'spki',format:'der'})
  ).digest('hex');
}
export function initializeTerminalIdentity(directory){
  const home=checkedHome(directory),privateFile=join(home,'private.pem');
  if(!existsSync(privateFile)){
    const {privateKey}=generateKeyPairSync('ed25519');
    const pem=privateKey.export({type:'pkcs8',format:'pem'}).toString();
    // Exclusive creation prevents accidentally replacing a registered key.
    writeFileSync(privateFile,pem,{flag:'wx',mode:0o600});
  }
  // The private key NEVER leaves local process memory or identity directory.
  const privatePem=safeReadFile(privateFile);
  const publicKeyPem=pemPublic(privatePem);
  const fp=terminalFingerprint(publicKeyPem);
  return {publicKeyPem,fingerprint:fp};
}
function loadedIdentity(directory){
  const home=checkedHome(directory);
  const pem=safeReadFile(join(home,'private.pem'));
  return {privateKey:createPrivateKey(pem),fingerprint:terminalFingerprint(pemPublic(pem))};
}
export function reserveTerminalSequences({directory,accountId,deviceId,count=2}){
  const home=checkedHome(directory);
  const identity=loadedIdentity(home);
  const account=validUUID(accountId,'account'),device=validUUID(deviceId,'approved device');
  if(count!==2)throw err('exactly two read-only messages required');
  const lockPath=join(home,'sequence.lock'),ledger=join(home,'sequence.json');
  let lock;
  try{
    lock=openSync(lockPath,'wx',0o600);
  }catch{throw err('sequence is locked; inspect local lock before retrying');}
  try{
    let state={version:1,accountId:account,deviceId:device,
      fingerprint:identity.fingerprint,lastSequence:0};
    if(existsSync(ledger)){
      let old;
      try{old=JSON.parse(safeReadFile(ledger));}
      catch{throw err('sequence ledger is corrupt; do not reset an enrolled identity');}
      if(old.version!==1||old.accountId!==account||old.deviceId!==device||
         old.fingerprint!==identity.fingerprint||
         !Number.isSafeInteger(old.lastSequence)||old.lastSequence<0)
        throw err('sequence identity changed or ledger invalid; reenroll with a new key');
      state=old;
    }
    if(state.lastSequence>Number.MAX_SAFE_INTEGER-count)
      throw err('sequence exhausted; reenroll with a new key');
    const from=state.lastSequence+1;
    const next={...state,lastSequence:state.lastSequence+count};
    const temporary=join(home,'sequence-'+randomUUID()+'.tmp');
    let fd;
    try {
      fd=openSync(temporary,'wx',0o600);
      writeFileSync(fd,JSON.stringify(next)+'\n');
      fsyncSync(fd);
    } finally {if(fd!==undefined)closeSync(fd);}
    try{renameSync(temporary,ledger);}
    catch(e){try{unlinkSync(temporary);}catch{}throw e;}
    // Never send any packet until the sequence reservation reaches durable storage.
    return {sequences:[from,from+1],privateKey:identity.privateKey,fingerprint:identity.fingerprint};
  } finally {
    closeSync(lock);
    unlinkSync(lockPath);
  }
}
export function validateTerminalObservation(observation,{mode,nowMs=Date.now()}={}){
  if(!['demo','real'].includes(mode))throw err('explicit DEMO or REAL mode required');
  if(!matchKeys(observation,OBS_KEYS)||
     observation.source!=='mt5-python-terminal'||
     observation.accountType!==mode||
     observation.terminalConnectedClaim!==true||
     observation.terminalTradeAllowedClaim!==false||
     observation.brokerVerified!==false||observation.ordersEnabled!==false)
    throw err('invalid read-only broker observation or mode mismatch');
  if(typeof observation.symbol!=='string'||!SYMBOL.test(observation.symbol)||
     typeof observation.bid!=='number'||!Number.isFinite(observation.bid)||
     typeof observation.ask!=='number'||!Number.isFinite(observation.ask)||
     observation.bid<=0||observation.ask<observation.bid)
    throw err('invalid quote or symbol');
  if(!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(observation.observedAt)||
     !Number.isSafeInteger(observation.collectedAt)||
     observation.observedAt<nowMs-180000||observation.observedAt>nowMs+30000||
     observation.collectedAt<nowMs-120000||observation.collectedAt>nowMs+30000)
    throw err('stale or future terminal observation');
  return observation;
}
export function createTerminalPackets({
  observation,accountId,deviceId,mode,privateKey,sequences,
  nowMs=Date.now()
}={}){
  validateTerminalObservation(observation,{mode,nowMs});
  const account=validUUID(accountId,'account'),device=validUUID(deviceId,'approved device');
  if(!Array.isArray(sequences)||sequences.length!==2||
     !Number.isSafeInteger(sequences[0])||sequences[0]<1||
     sequences[1]!==sequences[0]+1)throw err('non-monotonic sequence pair');
  const signer=mode==='real'?signLiveObservation:signBridgePacket;
  const fields={privateKey,accountId:account,deviceId:device,issuedAt:nowMs};
  const heartbeat=signer({...fields,kind:'terminal.heartbeat',sequence:sequences[0],
    payload:{accountType:mode,connected:true,tradeAllowed:false}});
  const quote=signer({...fields,kind:'terminal.quote',sequence:sequences[1],
    payload:{accountType:mode,symbol:observation.symbol,bid:observation.bid,
      ask:observation.ask,observedAt:observation.observedAt}});
  return [heartbeat,quote];
}
export function checkedTelemetryEndpoint(value,{expectedHost='elitetradee.vercel.app'}={}){
  let url;
  try{url=new URL(value);}catch{throw err('invalid HTTPS endpoint');}
  if(url.protocol!=='https:'||url.hostname!==expectedHost||url.port||
     url.pathname!=='/api/elitebridge/telemetry'||url.search||url.hash||
     url.username||url.password)
    throw err('endpoint must be the exact authorized HTTPS telemetry route');
  return url.toString();
}
export async function sendTerminalPackets({packets,endpoint,fetcher=fetch,expectedHost='elitetradee.vercel.app'}={}){
  const url=checkedTelemetryEndpoint(endpoint,{expectedHost});
  if(!Array.isArray(packets)||packets.length!==2||
     packets[0]?.kind!=='terminal.heartbeat'||packets[1]?.kind!=='terminal.quote'||
     packets[0]?.accountId!==packets[1]?.accountId||
     packets[0]?.deviceId!==packets[1]?.deviceId||
     packets[1]?.sequence!==packets[0]?.sequence+1)
    throw err('invalid signed observation batch');
  const accepted=[];
  for(const packet of packets){
    let response;
    try {
      response=await fetcher(url,{method:'POST',
        redirect:'error',cache:'no-store',credentials:'omit',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({packet}),signal:AbortSignal.timeout(10000)});
    }catch{throw err('HTTPS delivery unavailable; do not reuse reserved sequences');}
    if(!response?.ok)throw err('cloud rejected telemetry; confirm terminal approval, feature flags and availability');
    let ack;
    try{ack=await response.json();}catch{throw err('invalid cloud acknowledgment');}
    if(ack?.accepted!==true||ack?.kind!==packet.kind||
       ack?.sequence!==packet.sequence||ack?.accountMode!==packet.payload.accountType||
       ack?.brokerVerified!==false||ack?.ordersEnabled!==false||ack?.readOnly!==true)
      throw err('untrusted cloud acknowledgment');
    accepted.push(packet.sequence);
  }
  return {accepted,readOnly:true,brokerVerified:false,ordersEnabled:false};
}
