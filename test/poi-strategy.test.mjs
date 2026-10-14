import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePoiStrategy, POI_FRAMES } from '../src/poi-strategy.mjs';

const now=Date.parse('2026-10-14T12:00:00Z');
const symbol='EURUSD';
const candle=(t,i)=>({time:new Date(t).toISOString(),open:1.10+i*.00002,high:1.101+i*.00002,low:1.099+i*.00002,close:1.1002+i*.00002});
const series=(ms,count)=>Array.from({length:count},(_,i)=>candle(now-(count-i)*ms,i));
const input={
  symbol,accountType:'demo',
  quote:{symbol,time:new Date(now-2000).toISOString(),bid:1.102,ask:1.1022},
  spec:{symbol,point:.00001,digits:5},
  timeframes:{
    w1:Array.from({length:18},(_,i)=>candle(Date.parse('2026-06-15T00:00:00Z')+i*POI_FRAMES.w1.ms,i)),
    h4:series(POI_FRAMES.h4.ms,80),
    m15:series(POI_FRAMES.m15.ms,80),
    m5:series(POI_FRAMES.m5.ms,80)
  }
};
test('verified multi-timeframe source yields explainable WAIT without fabricated trade',()=>{
  const result=evaluatePoiStrategy(input,now);
  assert.equal(result.source,'MT5 broker candles');
  assert.equal(result.executionEnabled,false);
  assert.equal(result.state,'WAIT');
  assert.equal(result.validated,false);
  assert.equal(result.side,null);
  assert.equal(result.plan,undefined);
  assert.equal(result.w1.samples,17);
  assert.ok(result.reasons.length>0);
});
test('stale and future quotes fail closed',()=>{
  for(const time of [now-31000,now+6000])assert.throws(()=>evaluatePoiStrategy({...input,quote:{...input.quote,time:new Date(time).toISOString()}},now),/quote is stale/);
});
test('unverified account types, symbols and specifications are rejected',()=>{
  assert.throws(()=>evaluatePoiStrategy({...input,accountType:'unverified'},now),/account type/);
  assert.throws(()=>evaluatePoiStrategy({...input,symbol:'USDJPY'},now),/quote/);
  assert.throws(()=>evaluatePoiStrategy({...input,spec:{symbol,point:0,digits:5}},now),/specification/);
});
test('missing or malformed broker candles are rejected rather than substituted',()=>{
  assert.throws(()=>evaluatePoiStrategy({...input,timeframes:{...input.timeframes,m15:[]}},now),/insufficient/);
  const corrupt={...input.timeframes,m5:input.timeframes.m5.map((c,i)=>i===7?{...c,high:c.low-1}:c)};
  assert.throws(()=>evaluatePoiStrategy({...input,timeframes:corrupt},now),/invalid/);
});
test('gaps in the latest execution bars prevent analysis',()=>{
  const gap={...input.timeframes,m5:input.timeframes.m5.filter((_,i)=>i!==77)};
  assert.throws(()=>evaluatePoiStrategy({...input,timeframes:gap},now),/gap/);
});
test('future unfinished bars never enter an assessment',()=>{
  const result=evaluatePoiStrategy({...input,timeframes:{...input.timeframes,m5:[...input.timeframes.m5,{...candle(now,90),high:99999}]}},now);
  assert.equal(result.state,'WAIT');assert.equal(result.m5.closedAt,new Date(now).toISOString());
});
