import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDemoQuote} from '../scripts/elitebridge-terminal-companion.mjs';
const now=Date.now();
const sample=({time=now,mode='demo',connected='true',tradeAllowed='true',bid='4146.238',ask='4146.478',symbol='XAUUSDm'}={})=>
  [mode,connected,tradeAllowed,symbol,bid,ask,String(time)].join('|')+'\r\n';

test('Windows companion parses only fresh genuine MT5 DEMO exporter rows',()=>{
 const result=parseDemoQuote(sample(),{nowMs:now});
 assert.deepEqual(result,{accountType:'demo',connected:true,tradeAllowed:true,
   symbol:'XAUUSDm',bid:4146.238,ask:4146.478,observedAt:now});
 assert.equal(parseDemoQuote(sample({tradeAllowed:'false'}),{nowMs:now}).tradeAllowed,false);
});
test('no old, real, invalid or missing-price data gets signed',()=>{
 for(const raw of [
  sample({mode:'real'}),sample({connected:'false'}),
  sample({time:now-140000}),sample({time:now+45000}),
  sample({bid:'0'}),sample({ask:'-1'}),sample({bid:'NaN'}),
  sample({ask:'4000',bid:'4100'}),sample({symbol:'../../../secret'}),
  'demo|true|true|XAUUSDm',sample()+'excess'
 ])assert.throws(()=>parseDemoQuote(raw,{nowMs:now}),/Invalid|verified|stale/);
});
test('MQL5 adapter is DEMO only, reads broker ticks and contains no order operations',()=>{
 const source=readFileSync(new URL('../mt5/EliteBridge_Demo_Telemetry.mq5',import.meta.url),'utf8');
 assert.match(source,/ACCOUNT_TRADE_MODE_DEMO/);
 assert.match(source,/SymbolInfoTick\(/);
 assert.match(source,/FILE_COMMON/);
 assert.doesNotMatch(source,/OrderSend\(|PositionOpen\(|CTrade\b|WebRequest\(/);
 const companion=readFileSync(new URL('../scripts/elitebridge-terminal-companion.mjs',import.meta.url),'utf8');
 assert.match(companion,/signBridgePacket\(/);
 assert.match(companion,/await nextSequence\(\)/);
 assert.doesNotMatch(companion,/demoOrder\(|placeOrder\(|submitTrade\(/);
});
test('signed registration never publishes Ed25519 private material to web',()=>{
 const src=readFileSync(new URL('../public/hosted-mt5.js',import.meta.url),'utf8');
 assert.match(src,/Register public identity/);
 assert.match(src,/Approve identity/);
 assert.match(src,/Revoke/);
 assert.match(src,/terminal-private\.pem/);
 assert.doesNotMatch(src,/\/api\/elitebridge\/telemetry.+POST/);
});
