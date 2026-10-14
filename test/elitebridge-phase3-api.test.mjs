import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

test('Phase 3 protocol status endpoint refuses anonymous requests and exposes no broker secrets',async t=>{
 const db={
   authUser:async()=>({id:'one',factors:[]}),
   one:async table=>table==='elitetrade_profiles'?{id:'one',email:'test@example.com',disabled:false,active:true,role:'user'}:null
 };
 const app=createSupabaseApplication({db,gateway:null,deviceVerification:false,telegram:null,
   env:{APP_ORIGIN:'http://localhost:3000'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const root='http://127.0.0.1:'+app.server.address().port+'/api/elitebridge/protocol';
 assert.equal((await fetch(root)).status,401);
 const r=await fetch(root,{headers:{Authorization:'Bearer test-user'}});
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 const x=await r.json();
 assert.equal(x.phase,3);assert.equal(x.version,3);
 assert.equal(x.state,'sandbox-only');assert.equal(x.ordersEnabled,false);
 assert.equal(x.pairingEnabled,false);assert.equal(x.brokerVerified,false);
 assert.ok(!JSON.stringify(x).includes('password'));
});
test('native app labels protocol as sandbox, not live broker gateway',()=>{
 const ui=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/EliteBridgePage.kt',import.meta.url),'utf8');
 const api=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt',import.meta.url),'utf8');
 assert.match(ui,/Protocol v3/);
 assert.match(ui,/MT5 NOT CONNECTED/);
 assert.match(ui,/Pairing: disabled/);
 assert.match(api,/server\("\/api\/elitebridge\/protocol"\)/);
});
