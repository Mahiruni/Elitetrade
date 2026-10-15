import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEliteBridgeWorkspace} from '../public/elitebridge.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
test('owner workspace shows accurate missing-host state without false broker/ordering claims',async()=>{
 const calls=[];
 const api=async url=>{
  calls.push(url);
  if(url==='/elitebridge/protocol')return {phase:7,pairingEnabled:true};
  if(url==='/elitebridge/status')return {activeProvider:'metaapi'};
  throw Error('Admin-only API must not be called as customer');
 };
 const ui=createEliteBridgeWorkspace({api,esc,state:{user:{role:'customer'}}});
 const html=await ui.page();
 assert.match(html,/Elite<span>Bridge\.<\/span>/);
 assert.match(html,/Independent bridge has no live-order authority/);
 assert.match(html,/Only an authenticated administrator/);
 assert.match(html,/No signed terminal heartbeat establishes/);
 assert.ok(!calls.includes('/elitebridge/terminals'));
 assert.doesNotMatch(html,/type=["']password["']/);
 ui.dispose();
});
test('administrator diagnostics are owner-scoped and safely escaped before display',async()=>{
 const calls=[];
 const api=async url=>{
  calls.push(url);
  if(url==='/elitebridge/protocol')return {phase:7,pairingEnabled:true,realObservationEnabled:false};
  if(url==='/elitebridge/status')return {activeProvider:'metaapi'};
  if(url==='/elitebridge/terminals')return {terminals:[{id:'d26d5735-1058-4e91-9ce1-f727191758ee',
    account_mode:'demo',label:'<img src=x onerror=alert(1)>',status:'pending',telemetryState:'never-received'}]};
  if(url==='/elitebridge/diagnostics')return {terminals:[]};
  if(url==='/accounts')return {accounts:[]};
  throw Error('Unexpected api '+url);
 };
 const ui=createEliteBridgeWorkspace({api,esc,state:{user:{role:'admin'}}});
 const html=await ui.page();
 assert.match(html,/Register Windows terminal/);
 assert.match(html,/Ed25519 PUBLIC key/);
 assert.match(html,/Pair terminal/);
 assert.match(html,/No MT5 account available/);
 assert.ok(!html.includes('<img src=x onerror='));
 assert.match(html,/&lt;img src=x/);
 assert.ok(calls.includes('/elitebridge/diagnostics'));
 ui.dispose();
});
test('signed pairing cloud routes require verified owner admin; telemetry accepts no orders',()=>{
 const source=read('src/supabase-app.mjs');
 assert.match(source,/if\(path==='\/api\/elitebridge\/telemetry'/);
 assert.match(source,/await bridgeCloud\.receive\(body\.packet/);
 const section=source.slice(source.indexOf("if(path==='/api/elitebridge/diagnostics'"),
   source.indexOf("if (path === '/api/elitebridge/protocol'"));
 assert.match(section,/await needAdmin\(req\)/);
 assert.match(section,/user_id=eq\.'\+q\(ctx\.user\.id\)/);
 assert.doesNotMatch(section,/demoOrder\(|tradeRequest\(|placeOrder\(/);
 const cloud=read('src/elitebridge-cloud.mjs');
 assert.match(cloud,/ordersEnabled:false/);
});
test('both app servers route EliteBridge assets and native Android shows truthful statuses',()=>{
 for(const name of ['src/app.mjs','src/supabase-app.mjs']){
   const c=read(name);
   assert.match(c,/files\['\/elitebridge\.js'\]/);
   assert.match(c,/files\['\/elitebridge\.css'\]/);
   assert.match(c,/'\/elitebridge'/);
 }
 const web=read('public/app.js');
 assert.match(web,/bridgeUI\.page/);assert.match(web,/bridgeUI\.mount/);
 const native=read('android-native/app/src/main/java/com/elitetrade/android/EliteBridgePage.kt');
 assert.match(native,/No enrolled terminal|No approved EliteBridge terminals/);
 assert.match(native,/Independent trades: DISABLED/);
});
