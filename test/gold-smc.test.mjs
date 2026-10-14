import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluateGoldSmc,validatedGoldCandles } from '../src/gold-smc.mjs';

const now=Date.parse('2026-10-14T08:30:00Z');
const symbol='XAUUSD';
const candles=(ms,n,bias=1)=>Array.from({length:n},(_,i)=>{
  const base=2000+bias*i*.12;
  return {time:new Date(now-(n-i)*ms).toISOString(),
    open:base,high:base+.4,low:base-.4,close:base+.10};
});
const dataset={
  symbol,accountType:'demo',
  quote:{symbol,time:new Date(now-1000).toISOString(),bid:2007.60,ask:2007.68},
  spec:{symbol,point:.01,digits:2},
  timeframes:{m15:candles(900000,80),m5:candles(300000,80)}
};
test('valid broker history never invents a signal without the causal SMC pattern',()=>{
  const r=evaluateGoldSmc(dataset,now);
  assert.equal(r.state,'WAIT');assert.equal(r.executionEnabled,false);
  assert.equal(r.validated,false);assert.equal(r.plan,undefined);
  assert.equal(r.source,'MT5 broker candles');
  assert.equal(r.bias,'BULLISH');
  assert.ok(r.reasons.some(s=>s.includes('sweep')));
});
test('only broker-closed bars are used and history must be current',()=>{
  const result=validatedGoldCandles([...dataset.timeframes.m5,
    {time:new Date(now).toISOString(),open:1,high:10000,low:.5,close:1}], 'm5',now);
  assert.equal(result.length,80);
  assert.equal(result.at(-1).stamp+300000,now);
  const old=dataset.timeframes.m5.slice(0,-6);
  assert.throws(()=>validatedGoldCandles(old,'m5',now),/Stale/);
});
test('rejects counterfeit symbols, invalid specifications, stale or future broker quotes',()=>{
  assert.throws(()=>evaluateGoldSmc({...dataset,symbol:'EURUSD'},now),/XAUUSD/);
  assert.throws(()=>evaluateGoldSmc({...dataset,accountType:'unknown'},now),/account type/);
  assert.throws(()=>evaluateGoldSmc({...dataset,spec:{...dataset.spec,point:0}},now),/specification/);
  for(const diff of [-31000,6000])assert.throws(()=>evaluateGoldSmc({...dataset,quote:{...dataset.quote,time:new Date(now+diff).toISOString()}},now),/quote/);
});
test('rejects missing, corrupt, duplicate, or interrupted execution feed',()=>{
  assert.throws(()=>evaluateGoldSmc({...dataset,timeframes:{...dataset.timeframes,m5:[]}},now),/Insufficient/);
  const bad=dataset.timeframes.m5.map((c,i)=>i===50?{...c,low:c.high+1}:c);
  assert.throws(()=>evaluateGoldSmc({...dataset,timeframes:{...dataset.timeframes,m5:bad}},now),/Invalid/);
  const duplicate=dataset.timeframes.m5.map((c,i)=>i===30?{...c,time:dataset.timeframes.m5[29].time}:c);
  assert.throws(()=>evaluateGoldSmc({...dataset,timeframes:{...dataset.timeframes,m5:duplicate}},now),/duplicate/);
  const gap=dataset.timeframes.m5.filter((_,i)=>i!==77);
  assert.throws(()=>evaluateGoldSmc({...dataset,timeframes:{...dataset.timeframes,m5:gap}},now),/Interrupted/);
});
test('out-of-session analysis is never marked tradable',()=>{
  const after=Date.parse('2026-10-14T18:30:00Z'),shift=after-now;
  const shifted={...dataset,quote:{...dataset.quote,time:new Date(after-1000).toISOString()},
    timeframes:Object.fromEntries(Object.entries(dataset.timeframes).map(([k,cs])=>[k,cs.map(c=>({...c,time:new Date(Date.parse(c.time)+shift).toISOString()}))]))};
  const r=evaluateGoldSmc(shifted,after);
  assert.equal(r.state,'WAIT');assert.ok(r.reasons.some(s=>s.includes('Outside')));
});
test('authenticated hamburger navigation and page asset wiring exist without a bot control action',()=>{
  const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const panel=readFileSync(new URL('../public/gold-smc.js',import.meta.url),'utf8');
  const server=readFileSync(new URL('../src/supabase-app.mjs',import.meta.url),'utf8');
  assert.match(app,/\['\/gold-smc','trade','Gold SMC Scalper'\]/);
  assert.match(app,/goldSmcUI\.mount/);
  assert.match(server,/goldSmc=evaluateGoldSmc/);
  assert.match(panel,/goldSmc:true/);
  assert.doesNotMatch(panel,/\/control|\/orders|demoOrder|PositionOpen/);
});
