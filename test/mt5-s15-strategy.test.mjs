import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build15sTickCandles} from '../src/mt5-fifteen-second-candles.mjs';
import {evaluateStrategy,planTrade,STRATEGIES} from '../src/trading-strategies.mjs';
import {createMetaApiGateway} from '../src/metaapi-gateway.mjs';
const t=Math.floor(Date.now()/15000)*15000;
const ticks=(missing=null)=>Array.from({length:12},(_,i)=>{
  const bucket=t-(12-i)*15000;
  const px=4000+i*.12;
  return [
    {time:new Date(bucket+1200).toISOString(),bid:px,ask:px+.1},
    {time:new Date(bucket+12400).toISOString(),bid:px+.08,ask:px+.18}
  ];
}).filter((_,i)=>i!==missing).flat();
test('S15 uses real completed tick bars; does not interpolate missing data or read forming bars',()=>{
 const candles=build15sTickCandles([...ticks(),{
   time:new Date(t+800).toISOString(),bid:9999,ask:10000
 }],t+1000);
 assert.equal(candles.length,12);
 assert.equal(Date.parse(candles.at(-1).time),t-15000);
 assert.ok(candles.every((c,i)=>i===0||Date.parse(c.time)-Date.parse(candles[i-1].time)===15000));
 assert.equal(evaluateStrategy('scalping-s15',candles,t+1000).side,'buy');
 assert.throws(()=>evaluateStrategy('scalping-s15',build15sTickCandles(ticks(9),t+1000),t+1000),/gaps/);
 assert.equal(STRATEGIES['scalping-s15'].minutes,.25);
 assert.equal(STRATEGIES['scalping-m1'].timeframe,'1m');
});
test('S15 rejects invalid prices, future ticks, oversize response and missing 15s intervals',()=>{
 assert.throws(()=>build15sTickCandles({},t),/Invalid MetaApi/);
 assert.throws(()=>build15sTickCandles(Array(1001).fill({time:new Date(t-15000).toISOString(),bid:1,ask:2}),t),/Invalid MetaApi/);
 assert.throws(()=>build15sTickCandles([{time:new Date(t-15000).toISOString(),bid:0,ask:1}],t),/Invalid broker tick prices/);
 assert.throws(()=>build15sTickCandles([{time:new Date(t+10000).toISOString(),bid:1,ask:2}],t),/Future broker tick/);
 assert.throws(()=>evaluateStrategy('scalping-s15',build15sTickCandles(ticks(0).slice(0,5),t),t),/Not enough/);
});
test('S15 uses same protected DEMO trading risk controls as M1',()=>{
 const b={symbol:'XAUUSDm',risk_percent:1,stop_loss:1,take_profit:1,lot_size:.01,daily_loss:3,max_drawdown:10};
 const info={type:'ACCOUNT_TRADE_MODE_REAL',platform:'mt5',equity:10000,freeMargin:10000,tradeAllowed:true,investorMode:false};
 assert.throws(()=>planTrade({bot:b,info,quote:{},spec:{},side:'buy',at:t}),/MT5 demo account/);
 assert.throws(()=>planTrade({bot:b,info:{...info,type:'ACCOUNT_TRADE_MODE_DEMO'},quote:{},spec:{},side:null,at:t}),/No entry signal/);
});
test('MetaApi S15 preview reads historical ticks and never submits trade requests',async()=>{
 const local='ab618cec-f918-42e9-a610-9316f0afc728',remote='66c54440-7d34-402d-a036-a455fe92591a';
 const binding='metaapi-existing:'+local+':'+remote,calls=[];
 const fetcher=async(url,opts)=>{
  const u=new URL(url);calls.push({path:u.pathname,method:opts.method,search:u.search});
  if(u.pathname.endsWith('/'+remote))
    return Response.json({_id:remote,login:'12345678',server:'Broker-Demo',
      region:'london',state:'DEPLOYED',connectionStatus:'CONNECTED'});
  if(u.pathname.endsWith('/account-information'))
    return Response.json({login:12345678,server:'Broker-Demo',platform:'mt5',
      type:'ACCOUNT_TRADE_MODE_DEMO',tradeAllowed:true,investorMode:false,
      balance:10000,equity:10000,freeMargin:10000,currency:'USD'});
  if(u.pathname.endsWith('/current-price'))
    return Response.json({symbol:'XAUUSDm',time:new Date().toISOString(),bid:4000,ask:4001});
  if(u.pathname.endsWith('/specification'))return Response.json({symbol:'XAUUSDm'});
  if(u.pathname.endsWith('/ticks'))return Response.json(ticks());
  throw Error('Unexpected route '+u.pathname);
 };
 const api=createMetaApiGateway({METAAPI_TOKEN:'test-only'},fetcher);
 const value=await api.previewMarket(binding,'XAUUSDm','15s');
 assert.equal(value.candles.length,12);
 assert.equal(value.exposureVerified,false);
 assert.ok(calls.some(x=>x.path.endsWith('/ticks')&&x.search.includes('limit=1000')));
 assert.ok(calls.every(x=>x.method==='GET'));
 assert.ok(!calls.some(x=>x.path.endsWith('/trade')||x.path.endsWith('/orders')));
});
test('S15 stays an opt-in configuration, not a forced live order',()=>{
 const server=readFileSync(new URL('../src/supabase-app.mjs',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const engine=readFileSync(new URL('../src/demo-engine.mjs',import.meta.url),'utf8');
 assert.match(server,/scalping-s15/);
 assert.match(ui,/15-Second Scalper/);
 assert.match(engine,/riskCheckpoint/);
 assert.match(engine,/planTrade/);
 assert.match(engine,/elitetrade_engine_reserve/);
 assert.match(engine,/unresolved/);
 assert.doesNotMatch(ui,/forceTrade|bypassRisk|unsafeOrder/);
});
