import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicKey,generateKeyPairSync,sign,randomUUID} from 'node:crypto';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
import {createTerminalEnrollment,checkTerminalPublicKey,enrollmentMessage,
  verifyEnrollmentProof,publicTerminalSummary,ingestSignedTerminalPacket} from '../src/elitebridge-enrollment.mjs';
import {signBridgePacket} from '../src/elitebridge-protocol.mjs';

const ownerId=randomUUID(),accountId=randomUUID();
const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const pem=publicKey.export({type:'spki',format:'pem'});
test('enrollment requires actual Ed25519 keypair and never accepts a private key',()=>{
 const row=createTerminalEnrollment({ownerId,accountId,label:'Exness DEMO Terminal',publicKey:pem});
 assert.equal(row.status,'pending');
 assert.equal(row.account_mode,'demo');
 assert.equal(row.owner_id,ownerId);
 assert.match(row.proof_nonce,/^[a-f0-9]{64}$/);
 assert.equal(checkTerminalPublicKey(pem),pem);
 assert.throws(()=>checkTerminalPublicKey('not a public key'),/Ed25519/);
 const proof=sign(null,enrollmentMessage({terminalId:row.id,nonce:row.proof_nonce}),privateKey).toString('base64url');
 assert.ok(verifyEnrollmentProof({terminal:row,signature:proof}));
 assert.throws(()=>verifyEnrollmentProof({terminal:row,signature:proof,nowMs:Date.parse(row.proof_expires_at)+1}),/expired/);
 const visible=JSON.stringify(publicTerminalSummary(row));
 assert.doesNotMatch(visible,/PRIVATE|BEGIN PUBLIC KEY|proof_nonce|password/);
 assert.equal(publicTerminalSummary(row).brokerVerified,false);
});
test('signed DEMO telemetry is accepted once and durable replay prevents a second claim',async()=>{
 const row=createTerminalEnrollment({ownerId,accountId,label:'Exness DEMO Terminal',publicKey:pem});
 row.status='approved';row.proof_verified_at=new Date().toISOString();
 const history=new Set();let last=0;
 const db={rpc:async(name,args)=>{
   assert.equal(name,'elitetrade_bridge_claim');
   if(args.p_sequence<=last||history.has(args.p_message_id))return false;
   history.add(args.p_message_id);last=args.p_sequence;return true;
 }};
 const now=Date.now();
 const packet=signBridgePacket({privateKey,kind:'terminal.quote',
   accountId,deviceId:row.id,sequence:1,
   payload:{accountType:'demo',symbol:'XAUUSDm',bid:4146,ask:4146.3,observedAt:now},
   issuedAt:now,expiresAt:now+60000});
 const args={packet,terminal:row,db,nowMs:now};
 const result=await ingestSignedTerminalPacket(args);
 assert.equal(result.accepted,true);
 assert.equal(result.independentBrokerVerified,false);
 assert.equal(result.ordersEnabled,false);
 await assert.rejects(()=>ingestSignedTerminalPacket(args),/replay|sequence/i);
 await assert.rejects(()=>ingestSignedTerminalPacket({...args,terminal:{...row,status:'revoked'}}),/not an approved/);
 const realPacket=signBridgePacket.bind(null);
 assert.throws(()=>realPacket({privateKey,kind:'terminal.heartbeat',accountId,deviceId:row.id,
   sequence:2,payload:{accountType:'real',connected:true,tradeAllowed:true}}),/REAL accounts are prohibited/);
});
test('registration, challenge, approval and read-only telemetry are owner-controlled',async t=>{
 const rows=new Map();
 const db={
   authUser:async()=>({id:ownerId,factors:[]}),
   one:async(table,query)=> {
     if(table==='elitetrade_profiles')return {id:ownerId,email:'demo@example.invalid',disabled:false,active:true,role:'user'};
     if(table==='elitetrade_accounts')return query.includes(accountId)?{id:accountId}:null;
     return null;
   }
 };
 const bridgeDb={
   async insert(table,row) {assert.equal(table,'elitetrade_bridge_terminals');rows.set(row.id,{...row});return [row];},
   async one(table,query){
     const id=/id=eq\.([0-9a-f-]{36})/.exec(query)?.[1];
     return table==='elitetrade_bridge_terminals' ? rows.get(id)||null : null;
   },
   async update(table,query,patch){
     const id=/id=eq\.([0-9a-f-]{36})/.exec(query)?.[1],row=rows.get(id);
     if(!row||query.includes('owner_id=eq.')&&!query.includes(ownerId)||
       query.includes('proof_verified_at=is.null')&&row.proof_verified_at||
       query.includes('proof_verified_at=not.is.null')&&!row.proof_verified_at||
       query.includes('status=eq.pending')&&row.status!=='pending')return [];
     const next={...row,...patch};rows.set(id,next);return [next];
   },
   async query(table,query){
     assert.equal(table,'elitetrade_bridge_terminals');
     return [...rows.values()].filter(r=>r.owner_id===ownerId);
   },
   async rpc(name,args) {assert.equal(name,'elitetrade_bridge_claim');
     const row=rows.get(args.p_terminal_id);
     if(args.p_sequence<=row.last_sequence)return false;
     row.last_sequence=args.p_sequence;return true;
   }
 };
 const app=createSupabaseApplication({db,bridgeDb,gateway:null,
   deviceVerification:false,telegram:null,env:{APP_ORIGIN:'http://localhost:3000'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const root='http://127.0.0.1:'+app.server.address().port;
 const request=(path,body,auth=true)=>fetch(root+path,{method:'POST',headers:{
   'Content-Type':'application/json',...(auth?{Authorization:'Bearer user'}:{})},
   body:JSON.stringify(body)});
 assert.equal((await request('/api/elitebridge/terminals',{accountId,label:'Remote Demo',publicKey:pem},false)).status,401);
 const newTerminal=await request('/api/elitebridge/terminals',
   {accountId,label:'Remote Demo',publicKey:pem});
 assert.equal(newTerminal.status,201);
 const reg=await newTerminal.json();
 assert.equal(reg.terminal.identityProofVerified,false);
 assert.equal(reg.terminal.ordersEnabled,false);
 const url='/api/elitebridge/terminals/'+reg.terminal.id;
 assert.equal((await request(url+'/approve',{},true)).status,409);
 const signature=sign(null,enrollmentMessage({
   terminalId:reg.terminal.id,nonce:reg.enrollment.nonce}),privateKey).toString('base64url');
 const proof=await request(url+'/proof',{signature},false);
 assert.equal(proof.status,200);
 assert.equal((await request(url+'/proof',{signature},false)).status,403);
 const approval=await request(url+'/approve',{},true);
 assert.equal(approval.status,200);
 assert.equal((await approval.json()).brokerVerified,false);
 const now=Date.now(),packet=signBridgePacket({
   privateKey,kind:'terminal.heartbeat',accountId,deviceId:reg.terminal.id,sequence:1,
   payload:{accountType:'demo',connected:true,tradeAllowed:true},issuedAt:now,expiresAt:now+60000
 });
 const ingested=await request('/api/elitebridge/telemetry',{packet},false);
 assert.equal(ingested.status,200);
 assert.equal((await ingested.json()).ordersEnabled,false);
 const listed=await fetch(root+'/api/elitebridge/terminals',{headers:{Authorization:'Bearer user'}});
 assert.equal(listed.status,200);
 const listing=await listed.json();
 assert.equal(listing.terminals.length,1);
 assert.doesNotMatch(JSON.stringify(listing),/BEGIN PUBLIC KEY|proof_nonce|password/);
 assert.equal((await request(url+'/revoke',{},true)).status,200);
 assert.equal((await request('/api/elitebridge/telemetry',{packet},false)).status,403);
});
