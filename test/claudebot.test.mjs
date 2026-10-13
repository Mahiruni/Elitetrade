import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRsi, calculateEma, evaluateClaudeChecks, isFreshBrokerQuote } from '../public/claude-bot.js';

const origin=Date.parse('2026-10-01T00:00:00Z');
function candles(count,minutes=15) {
  return Array.from({length:count},(_,i)=>{
    const close=1.15+i*0.0001;
    return {time:new Date(origin+i*minutes*60000).toISOString(),open:close-0.00008,high:close+0.00005,low:close-0.00012,close};
  });
}
test('EMA uses a seeded exponential average and rejects insufficient candles',()=>{
  assert.equal(calculateEma([1,2,3],5),null);
  assert.equal(calculateEma([2,2,2,2,2],3),2);
});
test('RSI is bounded and handles flat/upward-only closes',()=>{
  assert.equal(calculateRsi(Array(15).fill(2)),50);
  assert.equal(calculateRsi(Array.from({length:15},(_,i)=>i+1)),100);
  assert.equal(calculateRsi([1,2,3],14),null);
});
test('signal freshness uses real broker timestamp and never assumes missing quotes are live',()=>{
  const now=origin+100000;
  assert.equal(isFreshBrokerQuote({updatedAt:new Date(now-5000).toISOString()},now),true);
  assert.equal(isFreshBrokerQuote({updatedAt:new Date(now-61000).toISOString()},now),false);
  assert.equal(isFreshBrokerQuote({updatedAt:new Date(now+6000).toISOString()},now),false);
  assert.equal(isFreshBrokerQuote({},now),false);
});
test('eight checks do not invent 5-second market movement or EMA 200 when only 120 bars exist',()=>{
  const raw=candles(120),now=Date.parse(raw.at(-1).time)+15*60000+1000;
  const output=evaluateClaudeChecks({candles:raw,timeframe:'15m'},now);
  assert.equal(output.length,8);
  assert.equal(output[0].available,true);
  assert.equal(output[2].available,false);
  assert.match(output[2].detail,/not verified 5s ticks/);
  assert.equal(output[5].available,false);
  assert.equal(output[7].available,true);
});
test('EMA 200 is calculated only when enough validated closed candles exist',()=>{
  const raw=candles(220),now=Date.parse(raw.at(-1).time)+15*60000+1000;
  const output=evaluateClaudeChecks({candles:raw,timeframe:'15m'},now);
  assert.equal(output[5].available,true);
  assert.match(output[5].detail,/EMA 200/);
});
