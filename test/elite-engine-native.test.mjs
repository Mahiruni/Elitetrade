import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('non-exported Android dataSync foreground service',()=>{
 const manifest=source('android-native/app/src/main/AndroidManifest.xml');
 assert.match(manifest,/android:name="\.EliteEngineService"/);
 assert.match(manifest,/android:exported="false"/);
 assert.match(manifest,/android:foregroundServiceType="dataSync"/);
});
test('no broker admin secrets or order endpoints in Android engine service',()=>{
 const s=source('android-native/app/src/main/java/com/elitetrade/android/EliteEngineService.kt');
 assert.match(s,/START_NOT_STICKY/);
 assert.match(s,/mobileEnginePulse/);
 assert.match(s,/45_000L/);
 assert.doesNotMatch(s,/sb_secret_|service_role|METAAPI_TOKEN|agiliumtrade|OrderSend/);
});
test('verified app API endpoint, native screen, and no auto-start',()=>{
 const activity=source('android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt');
 const api=source('android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt');
 const ui=source('android-native/app/src/main/java/com/elitetrade/android/EliteEnginePage.kt');
 assert.match(activity,/"Elite Engine" -> EliteEnginePage/);
 assert.match(activity,/onEngine=\{screen="Elite Engine"\}/);
 assert.match(api,/server\("\/api\/engine\/mobile\/tick"/);
 assert.match(ui,/enabled=enabled&&!loading/);
 assert.match(ui,/Start native DEMO engine/);
 assert.match(ui,/Stop the old Termux worker/);
});
