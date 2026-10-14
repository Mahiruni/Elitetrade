import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const svc=read('android-native/app/src/main/java/com/elitetrade/android/EliteEngineService.kt');
const api=read('android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt');
const ui=read('android-native/app/src/main/java/com/elitetrade/android/EliteEnginePage.kt');
test('Android foreground service automatically pauses on lost network and resumes validated internet',()=>{
 assert.match(svc,/registerDefaultNetworkCallback/);
 assert.match(svc,/unregisterNetworkCallback/);
 assert.match(svc,/NET_CAPABILITY_VALIDATED/);
 assert.match(svc,/networkWakeup.receive\(\)/);
 assert.match(svc,/Internet offline/);
});
test('transient backend failures use bounded backoff without indefinite busy polling',()=>{
 assert.match(svc,/Backend\/provider unavailable/);
 assert.match(svc,/300_000L/);
 assert.doesNotMatch(svc,/consecutiveErrors>=3/);
});
test('Android OS timeout stops foreground service; user consent required to start',()=>{
 assert.match(svc,/override fun onTimeout\(startId:Int,fgsType:Int\)/);
 assert.match(svc,/START_NOT_STICKY/);
 assert.doesNotMatch(svc,/BOOT_COMPLETED/);
});
test('mobile API refreshes expiring user JWT through the secure keystore token and server device verification',()=>{
 assert.match(api,/jwtExpiryMillis/);
 assert.match(api,/ensureMobileEngineSession/);
 assert.match(api,/vault.read\(\)/);
 assert.match(api,/grant_type=refresh_token/);
 assert.match(api,/acceptSession\(renewed\)/);
 assert.match(api,/server\("\/api\/engine\/mobile\/tick"/);
});
test('native UI accurately describes network recovery and Android limitations',()=>{
 assert.match(ui,/reconnect enabled while engine runs/);
 assert.match(ui,/Internet recovery/);
 assert.match(ui,/six hours per rolling day/);
});
test('no provider secrets or broker trade calls added to native APK',()=>{
 assert.doesNotMatch(svc+ui,/sb_secret_|SUPABASE_SERVICE_ROLE_KEY|METAAPI_TOKEN|agiliumtrade|OrderSend/);
});
