#!/usr/bin/env node
// EliteBridge Windows companion: authenticated DEMO-only telemetry from MT5.
// User-owned Ed25519 private keys never leave Windows. NO order commands.
import {generateKeyPairSync,createPrivateKey,createPublicKey,sign,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {enrollmentMessage} from '../src/elitebridge-enrollment.mjs';
import {signBridgePacket} from '../src/elitebridge-protocol.mjs';

const root=process.env.APPDATA||join(homedir(),'.elitetrade');
const directory=join(root,'EliteTrade','EliteBridge');
const privatePath=join(directory,'terminal-private.pem');
const seqPath=join(directory,'sequence.json');
const publicPath=join(directory,'terminal-public.pem');
const defaultOrigin='https://elitetradee.vercel.app';
const server=process.env.ELITEBRIDGE_ORIGIN||defaultOrigin;
if(!/^https:\/\/[A-Za-z0-9.-]+(?::[0-9]{2,5})?$/.test(server)&&
   !/^http:\/\/127\.0\.0\.1(?::[0-9]{2,5})?$/.test(server))
  throw Error('Use an HTTPS EliteBridge server. HTTP is for local 127.0.0.1 tests only.');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const pause=ms=>new Promise(ok=>setTimeout(ok,ms));
async function connect(path,body) {
  const response=await fetch(server+path,{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Bridge server rejected the request (HTTP '+response.status+'). Check pairing and connectivity.');
  return response.json();
}
async function readPrivateKey() {
  const pem=await readFile(privatePath,'utf8').catch(()=>{throw Error('Initialize companion identity first.');});
  const key=createPrivateKey(pem);
  if(key.asymmetricKeyType!=='ed25519')throw Error('Invalid private key type.');
  return key;
}
function parseDemoQuote(csv,{nowMs=Date.now()}={}) {
  if(typeof csv!=='string'||csv.length>1000)throw Error('Invalid quote file.');
  const line=csv.trim().split(/\r?\n/).filter(Boolean).at(-1);
  const parts=line?.split('|')||[];
  if(parts.length!==7||parts[0]!=='demo'||parts[1]!=='true')throw Error('No verified DEMO MT5 quote file.');
  const [,,allowed,symbol,bidText,askText,timeText]=parts;
  const bid=Number(bidText),ask=Number(askText),observedAt=Number(timeText);
  if(!/^[A-Za-z0-9._-]{3,30}$/.test(symbol)||
     allowed!=='true'&&allowed!=='false'||
     !Number.isFinite(bid)||bid<=0||!Number.isFinite(ask)||ask<bid||
     !Number.isSafeInteger(observedAt)||observedAt<nowMs-120000||observedAt>nowMs+30000)
    throw Error('MT5 quote is stale, malformed or incompatible.');
  return {accountType:'demo',connected:true,tradeAllowed:allowed==='true',
    symbol,bid,ask,observedAt};
}
async function nextSequence() {
  await mkdir(directory,{recursive:true,mode:0o700});
  let entry={sequence:0};
  try{entry=JSON.parse(await readFile(seqPath,'utf8'));}catch{}
  if(!Number.isSafeInteger(entry.sequence)||entry.sequence<0)throw Error('Local sequence record is invalid.');
  const sequence=entry.sequence+1;
  await writeFile(seqPath+'.tmp',JSON.stringify({sequence}),{mode:0o600});
  await rename(seqPath+'.tmp',seqPath);
  return sequence;
}
async function initial() {
  await mkdir(directory,{recursive:true,mode:0o700});
  const existing=await readFile(privatePath,'utf8').catch(()=>null);
  if(existing)throw Error('Identity already exists. Reuse existing key; never overwrite a registered identity.');
  const {privateKey,publicKey}=generateKeyPairSync('ed25519');
  await writeFile(privatePath,privateKey.export({type:'pkcs8',format:'pem'}),{flag:'wx',mode:0o600});
  const pem=publicKey.export({type:'spki',format:'pem'});
  await writeFile(publicPath,pem,{mode:0o600});
  console.log('EliteBridge Windows terminal public key (safe to paste in EliteTrade):');
  console.log(pem.trim());
  console.log('Private identity stored locally only. Never upload terminal-private.pem.');
}
async function prove(terminalId,nonce) {
  if(!uuid.test(terminalId)||!/^[a-f0-9]{64}$/.test(nonce||''))throw Error('Use approved terminal UUID and exact 64-character enrollment nonce.');
  const signature=sign(null,enrollmentMessage({terminalId,nonce}),await readPrivateKey()).toString('base64url');
  const result=await connect('/api/elitebridge/terminals/'+terminalId+'/proof',{signature});
  if(result.verified!==true)throw Error('Enrollment proof not verified.');
  console.log('Terminal identity proven. Return to EliteTrade and APPROVE this device.');
}
async function run(terminalId,accountId,file,{once=false}={}) {
  if(!uuid.test(terminalId)||!uuid.test(accountId)||!file)throw Error('Provide terminal UUID, account UUID and the MT5 Common Files quote.csv path.');
  const privateKey=await readPrivateKey();
  let lastHeartbeat=0;
  do {
    const now=Date.now();
    try {
      const fileState=await stat(file);
      if(now-fileState.mtimeMs>120000||fileState.mtimeMs>now+30000)
        throw Error('MT5 file is stale. Open the DEMO terminal and attach the exporter.');
      const quote=parseDemoQuote(await readFile(file,'utf8'),{nowMs:now});
      // The heartbeat itself is a self-assertion, NOT independent broker proof.
      if(now-lastHeartbeat>=20000) {
        const heartbeat=signBridgePacket({privateKey,accountId,deviceId:terminalId,
          sequence:await nextSequence(),kind:'terminal.heartbeat',
          payload:{accountType:'demo',connected:true,tradeAllowed:quote.tradeAllowed},
          issuedAt:now,expiresAt:now+60000});
        await connect('/api/elitebridge/telemetry',{packet:heartbeat});
        lastHeartbeat=now;
      }
      const packet=signBridgePacket({privateKey,accountId,deviceId:terminalId,
        sequence:await nextSequence(),kind:'terminal.quote',
        payload:{accountType:'demo',symbol:quote.symbol,bid:quote.bid,ask:quote.ask,observedAt:quote.observedAt},
        issuedAt:now,expiresAt:now+60000});
      await connect('/api/elitebridge/telemetry',{packet});
      console.log('Signed DEMO quote accepted: '+quote.symbol+' · '+new Date(quote.observedAt).toISOString()+' · NO ORDERS');
    }catch(error) {
      console.error('Bridge telemetry paused: '+error.message);
    }
    if(!once)await pause(10000);
  }while(!once);
}
const [cmd,...args]=process.argv.slice(2);
if(cmd==='init')await initial();
else if(cmd==='public'){const key=createPublicKey(await readPrivateKey());console.log(key.export({type:'spki',format:'pem'}).trim());}
else if(cmd==='prove')await prove(args[0],args[1]);
else if(cmd==='run')await run(args[0],args[1],args[2]);
else if(cmd==='once')await run(args[0],args[1],args[2],{once:true});
else {
 console.log('EliteBridge Windows companion · no broker passwords or order controls');
 console.log('node scripts/elitebridge-terminal-companion.mjs init');
 console.log('node scripts/elitebridge-terminal-companion.mjs public');
 console.log('node scripts/elitebridge-terminal-companion.mjs prove TERMINAL_UUID NONCE');
 console.log('node scripts/elitebridge-terminal-companion.mjs run TERMINAL_UUID ACCOUNT_UUID C:\\...\\quote.csv');
}
export {parseDemoQuote};
