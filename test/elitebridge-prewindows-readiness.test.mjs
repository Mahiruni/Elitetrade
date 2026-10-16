import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {eliteBridgeReadiness} from '../src/elitebridge-readiness.mjs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

const now=Date.parse('2026-10-16T07:00:00Z');
const accountId=randomUUID();
const terminal=(status,age=30)=>({
 id:randomUUID(),status,proof_verified_at:new Date(now-120000).toISOString(),
 last_seen_at:new Date(now-age*1000).toISOString(),account_mode:'demo'
});

test('pre-Windows checks never assert MT5 broker verification or bridge orders',()=>{
 for(const cloudEnabled of [true,false]){
  for(const cloudInventory of [null,[],[terminal('pending')],[terminal('approved')]]){
    const r=eliteBridgeReadiness({cloudEnabled,cloudInventory,accounts:[{id:accountId}],
      isAdmin:true,nowMs:now});
    assert.equal(r.readOnly,true);
    assert.equal(r.brokerVerified,false);
    assert.equal(r.independentMT5Connected,false);
    assert.equal(r.ordersEnabled,false);
    assert.equal(r.realOrdersEnabled,false);
    assert.equal(r.checks.find(x=>x.id==='host').state,'pending');
    assert.equal(r.checks.find(x=>x.id==='execution').state,'pending');
    assert.equal(r.readyCount,r.checks.filter(x=>x.state==='ready').length);
    assert.ok(!JSON.stringify(r).includes(accountId));
  }
 });
});

test('unknown terminal registry stays unknown, not a fabricated empty enrollment',()=>{
 const x=eliteBridgeReadiness({cloudEnabled:true,cloudInventory:null,
   isAdmin:true,accounts:[{id:accountId}],nowMs:now});
 assert.equal(x.terminalRegistrations,null);
 assert.equal(x.checks.find(y=>y.id==='pairing').state,'unavailable');
 assert.equal(x.checks.find(y=>y.id==='telemetry').state,'unavailable');
 assert.equal(x.nextStep.id,'host');
});

test('approved signed terminal alone does not imply broker connectivity',()=>{
 const r=eliteBridgeReadiness({cloudEnabled:true,isAdmin:true,
   cloudInventory:[terminal('approved')],accounts:[{id:accountId}],nowMs:now});
 assert.equal(r.checks.find(x=>x.id==='pairing').state,'ready');
 assert.equal(r.checks.find(x=>x.id==='telemetry').state,'ready');
 assert.equal(r.brokerVerified,false);
 assert.equal(r.independentMT5Connected,false);
 assert.equal(r.ordersEnabled,false);
});
test('old, revoked and pending telemetry cannot appear recent',()=>{
 const old=terminal('approved',900);
 const revoked=terminal('revoked',3);
 const pending=terminal('pending',3);
 const r=eliteBridgeReadiness({cloudEnabled:true,isAdmin:true,
   cloudInventory:[old,revoked,pending],nowMs:now});
 assert.equal(r.signedTelemetryRecent,0);
 assert.equal(r.checks.find(x=>x.id==='telemetry').state,'pending');
});
test('non-admin receives no terminal counts or unverified pairings',()=>{
 const r=eliteBridgeReadiness({cloudEnabled:true,isAdmin:false,
   cloudInventory:[terminal('approved')],nowMs:now});
 assert.equal(r.terminalRegistrations,null);
 assert.equal(r.checks.find(x=>x.id==='pairing').state,'unavailable');
 assert.equal(r.checks.find(x=>x.id==='telemetry').state,'unavailable');
});

test('readiness endpoint requires sign-in, queries only owned account IDs and does not emit secrets',async t=>{
 let queried=false,inventoryRead=false;
 const owner=randomUUID();
 const db={
  authUser:async()=>({id:owner,factors:[]}),
  one:async table=>table==='elitetrade_profiles'?{id:owner,email:'owner@example.test',
    full_name:'Owner',role:'user',active:true,disabled:false}:null,
  query:async(table,filter)=>{
   if(table==='elitetrade_accounts'){
    queried=true;
    assert.match(filter,/user_id=eq\./);
    assert.match(filter,/select=id/);
    return [{id:accountId,login:'123456789',password:'should-stay-private'}];
   }
   throw Error('Unexpected table');
  }
 };
 const app=createSupabaseApplication({db,deviceVerification:false,gateway:null,telegram:null,
   env:{APP_ORIGIN:'http://localhost:3000'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const url='http://127.0.0.1:'+app.server.address().port+'/api/elitebridge/readiness';
 assert.equal((await fetch(url)).status,401);
 const response=await fetch(url,{headers:{Authorization:'Bearer owner'}});
 assert.equal(response.status,200);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 const json=await response.json();
 assert.equal(json.schema,'elitebridge-prewindows-v1');
 assert.equal(json.checks.find(x=>x.id==='account').state,'ready');
 assert.equal(json.brokerVerified,false);
 assert.equal(queried,true);
 assert.equal(inventoryRead,false);
 assert.doesNotMatch(JSON.stringify(json),/should-stay-private|123456789|owner@example.test|private.pem|SUPABASE_SECRET/i);
});

test('Android and web render the same owner-scoped readiness without passwords',()=>{
 const native=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/EliteBridgePage.kt',import.meta.url),'utf8');
 const api=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt',import.meta.url),'utf8');
 const web=readFileSync(new URL('../public/hosted-mt5.js',import.meta.url),'utf8');
 assert.match(native,/api\.eliteBridgeReadiness\(\)/);
 assert.match(native,/Before Windows connects|Windows connection readiness/);
 assert.match(api,/server\("\/api\/elitebridge\/readiness"\)/);
 assert.match(web,/api\('\/elitebridge\/readiness'\)/);
 assert.match(web,/Bridge orders:|Bridge orders/);
});
