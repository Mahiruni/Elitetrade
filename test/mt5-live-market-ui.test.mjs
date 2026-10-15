import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {liveMarketDetails} from '../src/market-view.mjs';

const at=new Date().toISOString();
const market=()=>({
 info:{platform:'mt5',type:'ACCOUNT_TRADE_MODE_DEMO',currency:'USD',
   balance:1000,equity:1008,login:'9876543',server:'PRIVATE'},
 quote:{bid:4146.238,ask:4146.478,time:at},
 positions:[{id:202, symbol:'XAUUSDm',type:'POSITION_TYPE_BUY',volume:.01,
   openPrice:4140,currentPrice:4146.238,profit:8,stopLoss:4130,takeProfit:4160,
   secret:'DO_NOT_EXPOSE'}],
 orders:[{id:303,symbol:'XAUUSDm',type:'ORDER_TYPE_BUY_LIMIT',volume:.01,
   openPrice:4120,stopLoss:4110,takeProfit:4160,secret:'DO_NOT_EXPOSE'}],
 candles:[{time:at,open:4145,high:4147,low:4144,close:4146,
   proprietaryProviderMetadata:'DO_NOT_EXPOSE'}]
});
const request={symbol:'XAUUSDm',timeframe:'1m'};

test('broker live feed publishes genuine quote, position profit and optionally candles',()=>{
 const summary=liveMarketDetails(market(),request);
 assert.equal(summary.fresh,true);
 assert.deepEqual(summary.quote,{bid:4146.238,ask:4146.478});
 assert.equal(summary.snapshot.positions.length,1);
 assert.equal(summary.snapshot.positions[0].profit,8);
 assert.equal(summary.snapshot.profit,8);
 assert.equal(summary.snapshot.equity,1008);
 assert.ok(!Object.hasOwn(summary,'candles'));
 assert.ok(!Object.hasOwn(summary,'orders'));
 const extended=liveMarketDetails(market(),{...request,withCandles:true,withOrders:true});
 assert.equal(extended.candles.length,1);
 assert.equal(extended.orders.length,1);
 assert.doesNotMatch(JSON.stringify(extended),/DO_NOT_EXPOSE|PRIVATE|9876543|secret/i);
});
test('stale quotes are displayed as stale, never recency-forged',()=>{
 const t=market();t.quote.time=new Date(Date.now()-90000).toISOString();
 const summary=liveMarketDetails(t,request);
 assert.equal(summary.fresh,false);
 assert.equal(summary.updatedAt,t.quote.time);
 assert.equal(summary.snapshot.updatedAt,t.quote.time);
});
test('missing or malformed broker feed fails closed',()=>{
 for(const item of [
  {...market(),positions:null},
  {...market(),quote:{bid:12,ask:11,time:at}},
  {...market(),quote:{bid:12,ask:13,time:'invalid'}},
  {...market(),info:{...market().info,platform:'mt4'}},
 ]) assert.throws(()=>liveMarketDetails(item,request),/could not be verified/);
 assert.throws(()=>liveMarketDetails({...market(),candles:null},{...request,withCandles:true}),/candles/);
});
test('request route authenticates owner and only calls read-only broker service',()=>{
 const server=readFileSync(new URL('../src/supabase-app.mjs',import.meta.url),'utf8');
 const beginning=server.indexOf("if(path==='/api/market/live'");
 assert.ok(beginning>0);
 const ending=server.indexOf('const botPreview=',beginning);
 const route=server.slice(beginning,ending);
 assert.match(route,/await needUser\(req\)/);
 assert.match(route,/user_id=eq\.\$\{q\(ctx\.user\.id\)\}/);
 assert.match(route,/gateway\.liveMarket\(/);
 assert.match(route,/Cache-Control','private, no-store'/);
 assert.doesNotMatch(route,/demoOrder\(|reserve\(|engine_control|gateway\.control\(/);
});
test('browser automatically fetches on Trade and updates without full redraw',()=>{
 const ui=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(ui,/function startLiveFeed\(\)/);
 assert.match(ui,/setTimeout\(tick,8000\)/);
 assert.match(ui,/if\(path==='\/trade'\)startLiveFeed\(\)/);
 assert.match(ui,/workspaceUI\.applyLiveMarket\(botId,feed\)/);
 assert.match(ui,/document\.hidden\|\|!navigator\.onLine/);
 const workspace=readFileSync(new URL('../public/workspace.js',import.meta.url),'utf8');
 assert.match(workspace,/data-live-positions/);
 assert.match(workspace,/data-live-bid/);
 assert.match(workspace,/data-live-feed-state/);
 const chart=readFileSync(new URL('../public/market-chart.js',import.meta.url),'utf8');
 assert.match(chart,/broker-price-line/);
 assert.match(chart,/Quotes are not synthetic|Quotes are not synthetic/); // source must explain quote/candle distinction
});
