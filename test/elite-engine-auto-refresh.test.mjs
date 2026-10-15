import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/EliteEnginePage.kt',import.meta.url),'utf8');
const service=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/EliteEngineService.kt',import.meta.url),'utf8');
const gradle=readFileSync(new URL('../android-native/app/build.gradle',import.meta.url),'utf8');

test('Elite Engine automatically checks backend every 15s only while Activity is started',()=>{
 assert.match(page,/refreshIntervalMillis=15_000L/);
 assert.match(page,/LocalLifecycleOwner\.current/);
 assert.match(page,/repeatOnLifecycle\(Lifecycle\.State\.STARTED\)/);
 assert.match(page,/while\(isActive\)\{\s*refreshBackend\(\)\s*delay\(refreshIntervalMillis\)/s);
 assert.match(gradle,/lifecycle-runtime-ktx:2\.9\.4/);
 assert.match(gradle,/lifecycle-runtime-compose:2\.9\.4/);
});
test('manual refresh is merged into shared footer control and prevents overlapping requests',()=>{
 const native=readFileSync(new URL('../android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt',import.meta.url),'utf8');
 assert.match(page,/if\(loading\)return/);
 assert.match(page,/onRegisterRefresh\(suspend \{ refreshBackend\(\) \}\)/);
 assert.match(page,/onDispose \{ onRegisterRefresh\(null\) \}/);
 assert.match(native,/if \(screen=="Elite Engine"\) engineRefreshHandler\?\.invoke\(\)/);
 assert.match(native,/FloatingActionButton\(/);
 assert.doesNotMatch(page,/Refresh backend now/);
 assert.match(page,/enabled=backendKnown&&enabled&&!loading/);
 assert.match(page,/Auto-refresh ON · Every 15 seconds/);
 assert.match(page,/Last backend check:/);
 assert.match(page,/checkedAtMillis=System\.currentTimeMillis\(\)/);
});
test('backend errors cannot leave falsely green online state',()=>{
 assert.match(page,/catch\(e:CancellationException\)\{throw e\}/);
 assert.match(page,/catch\(e:Exception\)\{[\s\S]*?ready=false\s*backendKnown=false/);
 assert.match(page,/fresh&&ready&&backendKnown/);
 assert.match(page,/Waiting for verified server status/);
 assert.match(page,/enabled=backendKnown&&enabled&&!loading/);
});
test('polling GET never pulses engine, arms bot, or changes background service limits',()=>{
 const refresh=page.slice(page.indexOf('suspend fun refreshBackend()'),page.indexOf('    // The phone service reports'));
 assert.match(refresh,/api\.mobileEngineStatus\(\)/);
 assert.doesNotMatch(refresh,/mobileEnginePulse|selectStrategy|startForeground|start\(|post\(|order_send/);
 assert.match(service,/withTimeoutOrNull\(monitoringDelayMs\)/);
 assert.match(service,/monitoringDelayMs=if\(reply\.optInt\("scanIntervalSeconds",45\)==15\)15_000L else 45_000L/);
 assert.match(service,/override fun onTimeout/);
});
