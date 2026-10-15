import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('authenticated Supabase preview returns read-only broker minimum-lot advice',()=>{
  const api=read('src/supabase-app.mjs');
  assert.match(api,/brokerRiskAffordability\(\{bot,market\}\)/);
  assert.match(api,/signal,order,riskMessage,riskFit/);
  const src=read('src/broker-risk-affordability.mjs');
  assert.match(src,/tradeAuthorized:false/);
  assert.doesNotMatch(src,/demoOrder\(|submitOrder\(|engine_control\(/);
});

test('web bot surfaces a stopped-risk gate and never auto-applies suggested settings',()=>{
  const ui=read('public/app.js');
  assert.match(ui,/Risk check stopped this bot/);
  assert.match(ui,/risk\?\.status==='blocked_minimum_lot'/);
  assert.match(ui,/For manual review only/);
  assert.doesNotMatch(ui,/applySuggestedRisk|autoSaveStop/);
});

test('native Android user-confirmed start establishes monitoring before arming, and preview is read-only',()=>{
  const ui=read('android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt');
  const api=read('android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt');
  assert.match(ui,/Text\("Preview signal & risk"\)/);
  assert.match(ui,/api\.previewBot\(bot\.str\("id"\)\)/);
  assert.match(ui,/pendingBotPreview/);
  const onConfirm=ui.slice(ui.indexOf('pendingControl?.let'),ui.indexOf('pendingControl?.let')+3400);
  assert.match(onConfirm,/if\(running\)/);
  assert.match(onConfirm,/EliteEngineService\.start\(context,api\)/);
  assert.match(onConfirm,/if\(!ready\)throw IllegalStateException/);
  assert.ok(onConfirm.indexOf('EliteEngineService.start(context,api)') < onConfirm.indexOf('api.controlBot(bot.str("id"),running)'));
  assert.match(api,/suspend fun previewBot\(/);
});
