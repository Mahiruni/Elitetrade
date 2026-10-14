import {createHash,createPublicKey,randomBytes} from 'node:crypto';
import {mkdir,readFile,open,rename,unlink,stat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {signBridgePacket,verifyBridgePacket} from './elitebridge-protocol.mjs';

// Phase 5.2: local, no-network DEMO companion queue. NOT an MT5 terminal.
// Only *public* verification keys are passed into this store. The sender's
// private key is supplied transiently to enqueue() and is NEVER persisted.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>isObj(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const fail=msg=>{throw new Error('EliteBridge offline: '+msg)};
function validId(id,label){if(typeof id!=='string'||!uuid.test(id))fail('invalid '+label);return id.toLowerCase()}
function fingerprint(pub){
  let key;
  try{key=pub?.type==='public' ? pub : createPublicKey(pub)}catch{fail('invalid verification public key')}
  if(key.asymmetricKeyType!=='ed25519')fail('Ed25519 verification keys required');
  return createHash('sha256').update(key.export({type:'spki',format:'der'})).digest('hex');
}
function cleanState({accountId,deviceId,terminalFingerprint,controllerFingerprint}){
  return {version:1,accountId,deviceId,terminalFingerprint,controllerFingerprint,
    lastIssued:0,lastReceipt:0,acknowledged:0,expired:0,queue:[]};
}
function clone(value){return structuredClone(value)}
function assertState(s,identity){
  if(!exact(s,['version','accountId','deviceId','terminalFingerprint','controllerFingerprint',
    'lastIssued','lastReceipt','acknowledged','expired','queue'])||
    s.version!==1||
    ['accountId','deviceId','terminalFingerprint','controllerFingerprint'].some(k=>s[k]!==identity[k])||
    !['lastIssued','lastReceipt','acknowledged','expired'].every(k=>
      Number.isSafeInteger(s[k])&&s[k]>=0)||
    !Array.isArray(s.queue)||s.queue.length>64)fail('corrupt or mismatched local journal');
  const sequences=new Set(),messages=new Set();
  for(const p of s.queue){
    if(!isObj(p)||!Number.isSafeInteger(p.sequence)||p.sequence<1||
       p.sequence>s.lastIssued||sequences.has(p.sequence)||
       typeof p.messageId!=='string'||messages.has(p.messageId)||
       !['terminal.heartbeat','terminal.quote'].includes(p.kind))
      fail('invalid local queue entry');
    sequences.add(p.sequence);messages.add(p.messageId);
  }
}
async function writeAtomic(directory,file,state){
  const temporary=join(directory,'.outbox-'+process.pid+'-'+randomBytes(6).toString('hex'));
  let handle;
  try{
    handle=await open(temporary,'wx',0o600);
    await handle.writeFile(JSON.stringify(state));
    await handle.sync();
    await handle.close();handle=null;
    await rename(temporary,file);
    // Best effort directory metadata flush; Android filesystem support varies.
    try{const d=await open(directory,'r');try{await d.sync()}finally{await d.close()}}catch{}
  }finally{
    if(handle)await handle.close();
    await rm(temporary,{force:true}).catch(()=>{});
  }
}
export function createOfflineDemoOutbox({
 directory,accountId,deviceId,terminalPublicKey,controllerPublicKey,
 clock=()=>Date.now(),capacity=32
}={}){
  if(typeof directory!=='string'||!directory.startsWith('/')||directory.length>800||
     directory.includes('\0'))fail('absolute local outbox directory required');
  const identity={
    accountId:validId(accountId,'account ID'),deviceId:validId(deviceId,'device ID'),
    terminalFingerprint:fingerprint(terminalPublicKey),
    controllerFingerprint:fingerprint(controllerPublicKey)
  };
  if(!Number.isSafeInteger(capacity)||capacity<1||capacity>64)fail('invalid queue capacity');
  if(typeof clock!=='function')fail('clock is required');
  const file=join(directory,'outbox.json'),lock=join(directory,'outbox.lock');
  const load=async()=>{
    let s;
    try{s=JSON.parse(await readFile(file,'utf8'))}
    catch(e){if(e?.code==='ENOENT')return cleanState(identity);fail('unreadable local journal')}
    assertState(s,identity);
    // Detect modified, injected or forged queued packets on disk. Signature
    // verification uses a non-authorizing sandbox claim, NOT server approval.
    for(const packet of s.queue){
      try{await verifyBridgePacket({packet,publicKey:terminalPublicKey,
        accountId:identity.accountId,deviceId:identity.deviceId,
        role:'terminal',replayStore:{claim:async()=>true},nowMs:packet.issuedAt})}
      catch{fail('local journal signature verification failed')}
    }
    return s;
  };
  const locked=async(fn)=>{
    await mkdir(directory,{recursive:true,mode:0o700});
    let h;
    try{h=await open(lock,'wx',0o600)}
    catch(e){if(e?.code==='EEXIST')fail('outbox busy or stale lock; never delete while another process is active');
      throw e}
    try{return await fn()}
    finally{await h.close();await unlink(lock).catch(()=>{})}
  };
  const save=state=>writeAtomic(directory,file,state);
  return {
    async inspect(){
      // Check only; does not change or disclose private keys.
      const s=await load();
      return {pending:s.queue.length,lastIssued:s.lastIssued,lastReceipt:s.lastReceipt,
        acknowledged:s.acknowledged,expired:s.expired,demoOnly:true,ordersEnabled:false,
        brokerVerified:false};
    },
    async enqueue({kind,payload,privateKey,expiresInMs=60000}={}){
      if(!['terminal.heartbeat','terminal.quote'].includes(kind))fail('DEMO telemetry only');
      if(!privateKey)fail('signing key missing');
      if(!Number.isSafeInteger(expiresInMs)||expiresInMs<1000||expiresInMs>90000)
        fail('invalid expiry duration');
      return locked(async()=>{
        const s=await load(),now=clock();
        if(!Number.isSafeInteger(now)||now<1)fail('invalid clock');
        const before=s.queue.length;
        s.queue=s.queue.filter(p=>p.expiresAt>now);
        s.expired+=before-s.queue.length;
        if(s.queue.length>=capacity)fail('offline queue full; refusing to drop unsent messages');
        if(s.lastIssued>=Number.MAX_SAFE_INTEGER)fail('sequence exhausted');
        const packet=signBridgePacket({privateKey,kind,payload,
          accountId:identity.accountId,deviceId:identity.deviceId,
          sequence:s.lastIssued+1,issuedAt:now,expiresAt:now+expiresInMs});
        try{await verifyBridgePacket({packet,publicKey:terminalPublicKey,
          accountId:identity.accountId,deviceId:identity.deviceId,
          role:'terminal',replayStore:{claim:async()=>true},nowMs:now})}
        catch{fail('signing key does not match pinned device public key')}
        s.lastIssued++;s.queue.push(packet);
        await save(s);
        return clone(packet);
      });
    },
    async pending(){
      const s=await load(),now=clock();
      return clone(s.queue.filter(x=>x.expiresAt>now));
    },
    async acceptSignedReceipt(packet){
      return locked(async()=>{
        const s=await load(),now=clock();
        if(!isObj(packet)||packet.kind!=='controller.ack')fail('signed controller receipt required');
        const requested=packet.payload?.receivedMessageId;
        const pending=s.queue.find(x=>x.messageId===requested);
        if(!pending)fail('receipt does not match a queued message');
        if(pending.expiresAt<=now)fail('expired message cannot be acknowledged');
        await verifyBridgePacket({packet,publicKey:controllerPublicKey,
          accountId:identity.accountId,deviceId:identity.deviceId,role:'controller',
          nowMs:now,replayStore:{claim:async ({sequence})=>sequence>s.lastReceipt}});
        s.queue=s.queue.filter(x=>x.messageId!==requested);
        s.lastReceipt=packet.sequence;
        s.acknowledged++;
        await save(s);
        return {acknowledged:true,messageId:requested,pending:s.queue.length,
          ordersEnabled:false};
      });
    },
    async discardExpired(){
      return locked(async()=>{
        const s=await load(),now=clock(),before=s.queue.length;
        s.queue=s.queue.filter(x=>x.expiresAt>now);
        s.expired+=before-s.queue.length;
        await save(s);
        return before-s.queue.length;
      });
    }
  };
}
