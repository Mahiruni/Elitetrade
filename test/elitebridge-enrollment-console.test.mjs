import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import {createEliteBridgeCloud} from '../src/elitebridge-cloud.mjs';
import {createEliteBridgeEnrollmentConsole} from '../public/elitebridge-enrollment.js';
import {createHostedMt5Workspace} from '../public/hosted-mt5.js';
const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const code=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('nonadministrator cannot query or open terminal enrollment',async()=>{
  const requests=[];
  const console=createEliteBridgeEnrollmentConsole({api:async p=>{requests.push(p);return{};},esc,isAdmin:()=>false});
  const data=await console.load();
  assert.deepEqual(requests,[]);
  const html=console.render(data);
  assert.match(html,/administrator access/i);
  assert.doesNotMatch(html,/<form|publicKey/);
});
test('owner/admin terminal screen shows actual server state, escapes hostile labels, never claims broker verified',async()=>{
 const responses={
  '/elitebridge/protocol':{pairingEnabled:true,pairingProofRequired:true},
  '/elitebridge/terminals':{terminals:[{
    id:'8c492b0f-0de4-4a4e-9ad0-1dca73b2b718',
    label:'<img src=x onerror=alert(1)>',account_mode:'demo',status:'pending',
    proof_verified_at:null,last_seen_at:null,telemetryState:'never-received'
  }]},
  '/elitebridge/diagnostics':{terminals:[]},
  '/accounts?fast=1':{accounts:[{id:'a5d374b6-c0c9-45ed-95f1-30f8999fd61e',broker:'Exness',login:'123456789'}]}
 };
 const calls=[];
 const console=createEliteBridgeEnrollmentConsole({api:async path=>{calls.push(path);return responses[path];},esc,isAdmin:()=>true});
 const data=await console.load();
 assert.equal(calls.length,4);
 const html=console.render(data);
 assert.match(html,/Enroll a trusted Windows terminal/);
 assert.match(html,/PUBLIC key/);
 assert.match(html,/Issue pairing challenge/);
 assert.match(html,/Not yet proven/);
 assert.match(html,/Broker independently verified: NO/);
 assert.doesNotMatch(html,/<img|123456789/);
 assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
 assert.match(html,/&lt;img/);
 assert.doesNotMatch(html,/type="password"|name="password"|name="privateKey"/i);
 assert.match(html,/Never enter an MT5 password, private signing key/);
});
test('proof-verified terminal is approvable; no private key or direct trading actions',()=>{
 const terminal={id:'8c492b0f-0de4-4a4e-9ad0-1dca73b2b718',label:'Trusted Windows',
    account_mode:'demo',status:'pending',proof_verified_at:new Date().toISOString()};
 const app=createEliteBridgeEnrollmentConsole({api:async()=>({}),esc,isAdmin:()=>true});
 const html=app.render({admin:true,
   protocol:{pairingEnabled:true,pairingProofRequired:true},
   terminals:{terminals:[terminal]},health:{terminals:[]},accounts:{accounts:[]}});
 assert.match(html,/Approve verified terminal/);
 assert.doesNotMatch(html,/Issue pairing challenge/);
 assert.doesNotMatch(html,/Place order|Execute trade|Submit password/);
 const source=code('public/elitebridge-enrollment.js');
 assert.match(source,/window\.confirm/);
 assert.match(source,/accountMode:'demo'/);
 assert.match(source,/\/elitebridge\/terminals/);
 assert.doesNotMatch(source,/demoOrder\(|submitOrder\(|private\.pem|MT5_DEMO_PASSWORD|SUPABASE_SECRET_KEY/);
});
test('server exposes only the public Ed25519 fingerprint matching the Windows companion',async()=>{
 const {publicKey}=generateKeyPairSync('ed25519');
 const pem=publicKey.export({type:'spki',format:'pem'}).toString();
 const ownerId=randomUUID(),record={id:randomUUID(),account_id:randomUUID(),
   label:'Windows demo',account_mode:'demo',status:'pending',public_key:pem};
 const bridge=createEliteBridgeCloud({db:{query:async()=>[record]}});
 const result=await bridge.list({ownerId});
 const expected=createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex');
 assert.equal(result.terminals[0].fingerprint,expected);
 assert.doesNotMatch(JSON.stringify(result),/BEGIN PUBLIC KEY|END PUBLIC KEY|private_key|public_key/);
 const client=code('public/elitebridge-enrollment.js');
 assert.match(client,/Public-key fingerprint unavailable; approval blocked/);
 assert.match(client,/t\.fingerprint/);
});
test('Hosted MT5 route embeds the console and server maps its JS file without exposing it publicly outside authenticated shell',async()=>{
 const page=createHostedMt5Workspace({api:async()=>({
   schema:'hosted_mt5_readiness_v1',
   host:{state:'not_provisioned'},
   broker:{state:'not_verified'},
   strategy:{realTickBacktest:'not_verified'},
   research:{compiled:true,name:'EA research'}
 }),esc,isAdmin:()=>true});
 const html=await page.page();
 assert.match(html,/data-bridge-console/);
 assert.match(html,/Not provisioned/);
 for(const path of ['src/app.mjs','src/supabase-app.mjs']){
   const source=code(path);
   assert.match(source,/files\['\/elitebridge-enrollment\.js'\]/);
 }
 const router=code('src/supabase-app.mjs');
 assert.match(router,/path==='\/api\/elitebridge\/terminals' && method==='POST'/);
 assert.match(router,/const ctx=await needAdmin\(req\)/);
 assert.match(router,/bridgeCloud\.prove/);
 assert.match(router,/ELITEBRIDGE_CLOUD_ENABLED/);
});
