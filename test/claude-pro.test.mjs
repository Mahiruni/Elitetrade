import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createApplication } from '../src/app.mjs';
import { createSupabaseApplication } from '../src/supabase-app.mjs';
import { DEFAULTS, brokerSignal, countdown, cycleDelay, demoSignal, restorePreferences } from '../public/claude-pro-model.js';

test('sample fixtures are explicit demo readings, support both directions and do not claim a live provider',()=>{
  const signals=[demoSignal(DEFAULTS,0,1000),demoSignal(DEFAULTS,1,1000)];
  assert.deepEqual(new Set(signals.map(s=>s.direction)),new Set(['higher','lower']));
  for(const signal of signals){assert.equal(signal.mode,'demo');assert.equal(signal.readings.length,8);assert.equal(signal.expiresAt,21000);assert.match(signal.note,/No broker order/);assert.match(signal.readings[4].detail,/Synthetic OTC/);}
});
test('countdown uses absolute expiry and automatic broker polling is slower than demo polling',()=>{
  assert.equal(countdown(21000,1000),20);assert.equal(countdown(21000,20999),1);assert.equal(countdown(21000,30000),0);
  assert.equal(cycleDelay('mt5'),60000);assert.equal(cycleDelay('demo'),25000);
});
test('preferences are validated and never restore a live source or automation on reload',()=>{
  const saved=restorePreferences(JSON.stringify({...DEFAULTS,mode:'mt5',duration:3,preset:'opus',botId:'private-bot',auto:true}));
  assert.equal(saved.mode,'demo');assert.equal(saved.botId,'');assert.equal(saved.duration,3);assert.equal(saved.preset,'opus');assert.equal(Object.hasOwn(saved,'auto'),false);
  assert.deepEqual(restorePreferences('{invalid'),DEFAULTS);
  assert.equal(restorePreferences('{"duration":999,"preset":"__proto__"}').duration,5);
});
const now=Date.parse('2026-10-14T12:00:00Z');
const bot={id:'test-bot',symbol:'EURUSD',strategy:'EMA',name:'Test',status:'stopped'};
const preview={accountType:'demo',timeframe:'15m',updatedAt:new Date(now-2000).toISOString(),signal:{side:'buy'},order:{volume:.01},candles:Array.from({length:40},(_,i)=>({time:new Date(now-(40-i)*900000).toISOString(),open:1+i*.0001,close:1.00004+i*.0001,high:1.0001+i*.0001,low:.9999+i*.0001}))};
test('broker signals reject missing, stale and future quotes and unknown account types',()=>{
  for(const updatedAt of [undefined,new Date(now-61000).toISOString(),new Date(now+10000).toISOString()])assert.throws(()=>brokerSignal(DEFAULTS,bot,{...preview,updatedAt},now),/stale|missing/);
  assert.throws(()=>brokerSignal(DEFAULTS,bot,{...preview,accountType:'unverified'},now),/account type/);
});
test('MT5 readings use actual candles and decline directions without history or a risk-checked plan',()=>{
  const result=brokerSignal(DEFAULTS,bot,preview,now);
  assert.equal(result.direction,'higher');assert.equal(result.instrument,'EURUSD');assert.equal(result.readings.length,8);assert.match(result.readings[2].title,/15m/);assert.equal(result.readings[5].available,false);
  assert.equal(brokerSignal(DEFAULTS,bot,{...preview,order:null},now).direction,'none');
  assert.equal(brokerSignal(DEFAULTS,bot,{...preview,candles:[]},now).direction,'none');
  assert.equal(brokerSignal(DEFAULTS,bot,{...preview,candles:[{time:new Date(now-900000).toISOString(),open:1,high:1,low:2,close:3}]},now).direction,'none');
});
test('web entry, lazy React assets and fonts are served through the existing server',async t=>{
  const app=createApplication({key:randomBytes(32),dbPath:':memory:',env:{APP_ORIGIN:'http://localhost:3000'}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  for(const path of ['/claude-pro-bot','/claude-pro-workspace.js','/claude-pro-bot.js','/claude-pro-bot.css','/fonts/inter-latin.woff2']){const response=await fetch(base+path);assert.equal(response.status,200,path);assert.ok(Number(response.headers.get('content-length'))>0,path);}
});
test('the production Supabase server also serves the new route and assets',async t=>{
  const app=createSupabaseApplication({gateway:null,telegram:null,env:{NODE_ENV:'test',APP_ORIGIN:'http://localhost:3000',SUPABASE_URL:'https://example.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test'}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  for(const path of ['/claude-pro-bot','/claude-pro-workspace.js','/claude-pro-bot.js','/claude-pro-bot.css','/fonts/inter-latin.woff2']){const response=await fetch(base+path);assert.equal(response.status,200,path);assert.ok(Number(response.headers.get('content-length'))>0,path);}
});
test('Android bundles the same React page behind a limited bridge and adds its menu entry',()=>{
  const activity=readFileSync('android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt','utf8');
  const native=readFileSync('android-native/app/src/main/java/com/elitetrade/android/ClaudeProBotPage.kt','utf8');
  assert.match(activity,/"Claude Pro Bot" -> ClaudeProBotPage/);assert.match(native,/allowFileAccess=false/);assert.match(native,/frame-src 'none'/);
  assert.equal(readFileSync('public/claude-pro-bot.js','utf8'),readFileSync('android-native/app/src/main/assets/claude-pro/claude-pro-bot.js','utf8'));
});
