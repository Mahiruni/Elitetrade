import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');

const screen='android-native/app/src/main/java/com/elitetrade/android/EliteBridgeDevicesPage.kt';
const api='android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt';
const activity='android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt';
const bridge='android-native/app/src/main/java/com/elitetrade/android/EliteBridgePage.kt';

test('new device management screen is reachable from authenticated EliteBridge navigation',()=>{
  assert.match(read(activity),/"EliteBridge Devices" -> EliteBridgeDevicesPage/);
  assert.match(read(bridge),/onNavigate\("EliteBridge Devices"\)/);
  assert.match(read(screen),/Back to EliteBridge/);
});
test('native management uses existing owner-scoped API and no privileged credentials',()=>{
 const s=read(api),page=read(screen);
 assert.match(s,/server\("\/api\/elitebridge\/devices"\)/);
 assert.match(s,/ensureMobileEngineSession\(\)/);
 assert.match(s,/eliteBridgeDeviceDecision/);
 assert.match(s,/action!="approve" && action!="revoke"/);
 assert.doesNotMatch(page,/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|METAAPI_TOKEN|OrderSend|demoOrder\(|\.market\(/);
 assert.doesNotMatch(s.slice(s.indexOf('suspend fun eliteBridgeDevices()'),
   s.indexOf('suspend fun eliteBridgeProbe(')),/sb_secret_|service_role|METAAPI_TOKEN|OrderSend/);
});
test('no pretend broker connection, enrollment secret, automatic approval or order execution',()=>{
 const s=read(screen);
 assert.match(s,/Orders: disabled/);
 assert.match(s,/Independent MT5: not connected/);
 assert.match(s,/not been activated/);
 assert.match(s,/if\(status=="pending" && admin\)/);
 assert.match(s,/Revoke device/);
 assert.match(s,/AlertDialog/);
 assert.doesNotMatch(s,/KeyPairGenerator|createPrivateKey|password=|tradeAllowed=true|startBot/);
});
test('existing EliteBridge broker diagnostics remain read only',()=>{
 const s=read(bridge);
 assert.match(s,/eliteBridgeProbe/);
 assert.match(s,/Phase 3 is protocol-sandbox only/);
 assert.match(s,/Open existing MT5 accounts/);
 assert.doesNotMatch(s,/\.demoOrder\(|\.controlBot\(/);
});
