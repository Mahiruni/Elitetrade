import test from 'node:test';
import assert from 'node:assert/strict';
import {createPaperDemo,paperAction,paperView,paperCandles} from '../public/paper-demo/engine.mjs';
import {readFileSync} from 'node:fs';
test('paper demo cannot connect to any broker, MetaApi or live execution',()=>{
 const s=createPaperDemo();let view=paperView(s);
 assert.equal(view.mode,'paper-only');assert.equal(view.executionEnabled,false);
 assert.equal(view.brokerConnected,false);assert.equal(view.liveData,false);
 assert.equal(view.balance,10000);assert.equal(view.running,false);
});
test('paper candles are valid, consecutive and generated from synthetic offline data',()=>{
 for(const name of ['scalping','trend','breakout']){
  const arr=paperCandles(name,5);
  assert.equal(arr.length,120);assert.ok(arr.every(v=>v.close>0&&v.low<=v.open&&v.high>=v.close));
  assert.equal(new Set(arr.map(x=>x.time)).size,120);
 }
});
test('bot start, virtual progression, paper trading, pause and reset work',()=>{
 let s=createPaperDemo();paperAction(s,'start');
 assert.equal(s.running,true);
 for(let i=0;i<250;i++)paperAction(s,'step',1);
 let p=paperView(s);
 assert.ok(p.step===250);
 assert.ok(p.history.length>0,'the synthetic price must trigger visible paper trade closures');
 assert.ok(p.history.every(x=>Number.isFinite(x.pnl)));
 assert.ok(Number.isFinite(p.equity));assert.ok(p.balance>0);
 paperAction(s,'pause');assert.equal(s.running,false);
 s=paperAction(s,'reset');assert.equal(s.step,0);assert.equal(s.balance,10000);
});
test('paper frontend only uses local module without provider or secrets',()=>{
 const js=readFileSync(new URL('../public/paper-demo/demo.js',import.meta.url),'utf8');
 const html=readFileSync(new URL('../public/paper-demo/index.html',import.meta.url),'utf8');
 assert.ok(!/metaapi\.cloud|supabase\.co|\/api\/bots\/|\/trade(?:\W|$)|METAAPI_TOKEN|SERVICE_ROLE_KEY/i.test(js));
 assert.match(html,/SIMULATED MARKET/);assert.match(html,/No MT5 password/);
});
test('published strategy evaluator equals the real EliteTrade module',()=>{
 const a=readFileSync(new URL('../src/trading-strategies.mjs',import.meta.url),'utf8');
 const b=readFileSync(new URL('../public/paper-demo/trading-strategies.mjs',import.meta.url),'utf8');
 assert.equal(a,b);
});
