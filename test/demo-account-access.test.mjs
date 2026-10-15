import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadSelectedDemoAccount} from '../src/demo-account-access.mjs';
const owner='fa41d374-b6c4-4739-9637-49858949d0f4';
const other='95187d0e-fb09-454b-8614-20b585709324';
const id='c63ecdf5-2fd4-445f-9e2d-1a21f9300309';
function fake(record=null){
 const calls=[];
 return {calls,one:async(table,filter,token)=>{calls.push({table,filter,token});return record}};
}
test('normal account selection keeps JWT-scoped user lookup',async()=>{
 const db=fake({id,user_id:owner,gateway_id:'metaapi-existing:demo',status:'connected'});
 const data=await loadSelectedDemoAccount({db,accountId:id,userId:owner,token:'signed-jwt'});
 assert.equal(data.status,'connected');assert.equal(db.calls.length,1);
 assert.ok(db.calls[0].filter.includes('user_id=eq.'+owner));
 assert.equal(db.calls[0].token,'signed-jwt');
});
test('only a verified admin invocation may fall back to separate trusted backend DB',async()=>{
 const db=fake();
 const trusted=fake({id,user_id:owner,status:'connected',gateway_id:'safe-demo-link'});
 const no=await loadSelectedDemoAccount({db,engineDb:trusted,accountId:id,userId:owner,token:'member',admin:false});
 assert.equal(no,null);assert.equal(trusted.calls.length,0);
 const yes=await loadSelectedDemoAccount({db,engineDb:trusted,accountId:id,userId:owner,token:'member',admin:true});
 assert.equal(yes.status,'connected');
 assert.ok(trusted.calls[0].filter.includes('user_id=eq.'+owner));
});
test('privileged fallback refuses a row belonging to a different user',async()=>{
 const data=await loadSelectedDemoAccount({db:fake(),engineDb:fake({id,user_id:other,status:'connected',gateway_id:'wrong'}),accountId:id,userId:owner,admin:true});
 assert.equal(data,null);
});
test('pending MT5 is not silently promoted to connected',async()=>{
 const data=await loadSelectedDemoAccount({db:fake({id,user_id:owner,status:'pending',gateway_id:'x'}),engineDb:fake(),accountId:id,userId:owner,admin:true});
 assert.equal(data.status,'pending');
});
test('bot arming retains fresh-worker, broker DEMO and no investor-mode safeguards',()=>{
 const backend=readFileSync(new URL('../src/supabase-app.mjs',import.meta.url),'utf8');
 assert.match(backend,/await engineReady\(db,ctx.token\)/);
 assert.match(backend,/loadSelectedDemoAccount/);
 assert.match(backend,/market.info.type!=='ACCOUNT_TRADE_MODE_DEMO'/);
 assert.match(backend,/market.info.tradeAllowed!==true/);
 assert.match(backend,/market.info.investorMode!==false/);
 const ui=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/EliteEnginePage.kt',import.meta.url),'utf8');
 assert.match(ui,/status=api.mobileEngineStatus\(\)/);
 assert.match(ui,/repeatOnLifecycle\(Lifecycle\.State\.STARTED\)/);
 assert.match(ui,/PHONE ACTIVE · VERIFYING SERVER/);
});
