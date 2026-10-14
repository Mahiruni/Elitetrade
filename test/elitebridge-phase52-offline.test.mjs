import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,stat,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createSandboxKeys,signBridgePacket,verifyBridgePacket,createSandboxReplayStore} from '../src/elitebridge-protocol.mjs';
import {createOfflineDemoOutbox} from '../src/elitebridge-offline-outbox.mjs';

const now=Date.parse('2026-10-15T12:00:00Z');
const accountId=randomUUID(),deviceId=randomUUID();
const terminal=createSandboxKeys(),controller=createSandboxKeys(),outsider=createSandboxKeys();
const heartbeat={accountType:'demo',connected:true,tradeAllowed:false};
async function fixture(t,{capacity=32}={}){
 const directory=await mkdtemp(join(tmpdir(),'bridge-offline-'));
 t.after(async()=>rm(directory,{recursive:true,force:true}));
 let current=now;
 const args={directory,accountId,deviceId,terminalPublicKey:terminal.publicKey,
   controllerPublicKey:controller.publicKey,clock:()=>current,capacity};
 return {directory,args,make:()=>createOfflineDemoOutbox(args),
   tick:(ms)=>{current+=ms},
   sign:(receivedMessageId,sequence=1,privateKey=controller.privateKey)=>
     signBridgePacket({privateKey,accountId,deviceId,sequence,
       kind:'controller.ack',payload:{receivedMessageId,accepted:true},
       issuedAt:current,expiresAt:current+60000}),
   enqueue:async(box)=>
     box.enqueue({kind:'terminal.heartbeat',payload:heartbeat,privateKey:terminal.privateKey})
 };
}
test('signed messages remain on disk after reconstructing a new offline companion',async t=>{
 const f=await fixture(t),a=f.make(),p=await f.enqueue(a);
 assert.equal(p.kind,'terminal.heartbeat');
 assert.equal(p.sequence,1);
 const b=f.make();
 assert.equal((await b.inspect()).pending,1);
 assert.equal((await b.pending())[0].messageId,p.messageId);
 const bytes=await readFile(join(f.directory,'outbox.json'),'utf8');
 assert.doesNotMatch(bytes,/PRIVATE KEY|BEGIN PRIVATE|secret|password/i);
 if(process.platform!=='win32'){
  const mode=(await stat(join(f.directory,'outbox.json'))).mode&0o777;
  assert.equal(mode,0o600);
 }
});
test('valid controller-signed receipt clears exactly the correct packet',async t=>{
 const f=await fixture(t),box=f.make(),p=await f.enqueue(box);
 const replay=createSandboxReplayStore();
 await verifyBridgePacket({packet:p,publicKey:terminal.publicKey,accountId,deviceId,
   role:'terminal',replayStore:replay,nowMs:now});
 const ack=f.sign(p.messageId,1);
 const response=await f.make().acceptSignedReceipt(ack);
 assert.equal(response.acknowledged,true);
 assert.equal(response.ordersEnabled,false);
 assert.equal((await f.make().inspect()).pending,0);
 assert.equal((await f.make().inspect()).acknowledged,1);
 await assert.rejects(f.make().acceptSignedReceipt(ack),/does not match/);
 const next=await f.enqueue(box);
 assert.equal(next.sequence,2);
 await assert.rejects(f.make().acceptSignedReceipt(f.sign(next.messageId,1)),/replay/);
 assert.equal((await box.inspect()).pending,1);
 await f.make().acceptSignedReceipt(f.sign(next.messageId,2));
 assert.equal((await box.inspect()).lastReceipt,2);
});
test('forged controller receipt cannot remove queued DEMO telemetry',async t=>{
 const f=await fixture(t),box=f.make(),p=await f.enqueue(box);
 await assert.rejects(box.acceptSignedReceipt(f.sign(p.messageId,1,outsider.privateKey)),/signature/);
 await assert.rejects(box.acceptSignedReceipt(f.sign(randomUUID().replace(/-/g,'').slice(0,32))),/does not match/);
 assert.equal((await f.make().inspect()).pending,1);
});
test('signed real account and order packets cannot enter the offline outbox',async t=>{
 const f=await fixture(t),box=f.make();
 await assert.rejects(box.enqueue({kind:'terminal.order',payload:heartbeat,privateKey:terminal.privateKey}),/DEMO telemetry only/);
 await assert.rejects(box.enqueue({kind:'terminal.heartbeat',payload:{...heartbeat,accountType:'real'},
   privateKey:terminal.privateKey}),/REAL accounts are prohibited/);
 await assert.rejects(box.enqueue({kind:'terminal.heartbeat',payload:heartbeat,
   privateKey:outsider.privateKey}),/does not match pinned/);
 assert.equal((await box.inspect()).pending,0);
});
test('bounded queue refuses overflow and expires stale packets without reusing sequences',async t=>{
 const f=await fixture(t,{capacity:1}),box=f.make();
 const first=await f.enqueue(box);
 await assert.rejects(f.enqueue(box),/offline queue full/);
 f.tick(61000);
 assert.equal((await box.pending()).length,0);
 assert.equal(await box.discardExpired(),1);
 assert.equal((await box.inspect()).expired,1);
 const next=await f.enqueue(box);
 assert.equal(next.sequence,first.sequence+1);
 assert.equal((await box.inspect()).lastIssued,2);
});
test('tampering with persisted journal is detected before reading or appending',async t=>{
 const f=await fixture(t),box=f.make();
 await f.enqueue(box);
 const file=join(f.directory,'outbox.json');
 const data=JSON.parse(await readFile(file,'utf8'));
 data.queue[0].payload.connected=false;
 await writeFile(file,JSON.stringify(data));
 await assert.rejects(f.make().inspect(),/signature verification failed/);
 await assert.rejects(f.make().enqueue({kind:'terminal.heartbeat',
   payload:heartbeat,privateKey:terminal.privateKey}),/signature verification failed/);
});
test('wrong device identity or key cannot resume another offline queue',async t=>{
 const f=await fixture(t),box=f.make();
 await f.enqueue(box);
 await assert.rejects(createOfflineDemoOutbox({...f.args,deviceId:randomUUID()}).inspect(),/mismatched/);
 await assert.rejects(createOfflineDemoOutbox({...f.args,controllerPublicKey:outsider.publicKey}).inspect(),/mismatched/);
});
test('no database, live MT5 credentials, network or order dispatch in transport module',async()=>{
 const source=await readFile(new URL('../src/elitebridge-offline-outbox.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(source,/from ['"](?:pg|node:net|node:http|https|ws|@supabase\/supabase-js)['"]/);
 assert.doesNotMatch(source,/MetaApi\(|demoOrder\(|OrderSend\(|fetch\(/);
 assert.match(source,/ordersEnabled:false/);
 assert.match(source,/await rename\(temporary,file\)/);
});
