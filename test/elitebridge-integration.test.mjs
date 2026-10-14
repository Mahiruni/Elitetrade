import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('EliteBridge endpoint is authenticated, scoped to the owner, and read only',()=>{
 const backend=read('src/supabase-app.mjs');
 const route=backend.split("if (path === '/api/elitebridge/status' && method === 'GET')")[1]?.split("if (path === '/api/engine/mobile/status'")[0];
 assert.ok(route);
 assert.match(route,/needUser\(req\)/);
 assert.match(route,/user_id=eq\.\$\{q\(ctx.user.id\)\}/);
 assert.match(route,/eliteBridgeStatus/);
 assert.doesNotMatch(route,/\.demoOrder\(|\.market\(|\.rpc\(|body\.|\.connect\(/);
});
test('Android EliteBridge interface is reachable and cannot switch providers or arm bots',()=>{
 const activity=read('android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt');
 const page=read('android-native/app/src/main/java/com/elitetrade/android/EliteBridgePage.kt');
 const api=read('android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt');
 assert.match(activity,/"EliteBridge" -> EliteBridgePage/);
 assert.match(activity,/AccountRow\(Icons.Default.Cable,"EliteBridge"/);
 assert.match(api,/server\("\/api\/elitebridge\/status"\)/);
 assert.match(page,/Phase 3 is protocol-sandbox only/);
 assert.match(page,/Not connected/);
 assert.doesNotMatch(page,/api\.controlBot|demoOrder|METAAPI_TOKEN|sb_secret_/);
});
