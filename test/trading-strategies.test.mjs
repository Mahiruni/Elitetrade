import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateStrategy,planTrade,riskCheckpoint} from '../src/trading-strategies.mjs';
const at=Math.floor(Date.now()/900000)*900000;
function candles(prices,minutes=15){return prices.map((close,i)=>({time:new Date(at-(prices.length-i)*minutes*60000).toISOString(),open:close,high:close+.01,low:close-.01,close}));}
const bot={symbol:'XAUUSDm',risk_percent:1,stop_loss:1,take_profit:2,lot_size:1,daily_loss:3,max_drawdown:10};
const info={type:'ACCOUNT_TRADE_MODE_DEMO',platform:'mt5',tradeAllowed:true,investorMode:false,equity:1000,balance:1000,freeMargin:900};
const quote={symbol:bot.symbol,ask:2000,bid:1999.9,lossTickValue:1,time:new Date(at).toISOString()};
const spec={symbol:bot.symbol,tickSize:.01,minVolume:.01,maxVolume:100,volumeStep:.01,point:.01,digits:2,stopsLevel:10,tradeMode:'SYMBOL_TRADE_MODE_FULL',allowedOrderTypes:['SYMBOL_ORDER_MARKET','SYMBOL_ORDER_SL','SYMBOL_ORDER_TP']};
const setup={bot,info,quote,spec,side:'buy',at};
test('strategy presets detect both EMA cross directions and exclude forming candles',()=>{
 for(const [strategy,minutes] of [['trend',15],['scalping',5]]) {
  const flat=Array(110).fill(100);
  assert.equal(evaluateStrategy(strategy,candles([...flat,102],minutes),at).side,'buy');
  assert.equal(evaluateStrategy(strategy,candles([...flat,98],minutes),at).side,'sell');
  const base=candles(flat,minutes);base.push({time:new Date(at).toISOString(),open:100,high:200,low:99,close:200});
  assert.equal(evaluateStrategy(strategy,base,at).side,null);
 }
});
test('breakout uses previous highs/lows and requires a closing breakout',()=>{
 assert.equal(evaluateStrategy('breakout',candles([...Array(25).fill(100),102]),at).side,'buy');
 assert.equal(evaluateStrategy('breakout',candles([...Array(25).fill(100),98]),at).side,'sell');
 assert.equal(evaluateStrategy('breakout',candles(Array(26).fill(100)),at).side,null);
});
test('rejects stale, gapped, duplicate, invalid or insufficient candle data',()=>{
 const base=candles(Array(60).fill(100));
 assert.throws(()=>evaluateStrategy('trend',base,at+1800001),/stale/);
 for(const list of [base.slice(0,10),[...base,base.at(-1)],base.filter((_,i)=>i!==58),base.map((c,i)=>i===58?{...c,close:NaN}:c)])assert.throws(()=>evaluateStrategy('trend',list,at));
});
test('risk-sized volumes never round up and include price stops and targets',()=>{
 const plan=planTrade({...setup,info:{...info,equity:10500}});assert.equal(plan.volume,.05);assert.equal(plan.estimatedRisk,100);assert.ok(plan.estimatedRisk<=105);
});
test('rejects budgets below minimum lot, real accounts, investor mode and stale quotes',()=>{
 // At 1% risk this account cannot afford the 20-currency-unit minimum lot.
 assert.throws(()=>planTrade(setup),/minimum/);
 const valid={...setup,info:{...info,equity:10000}};
 const plan=planTrade(valid);assert.equal(plan.volume,.05);assert.equal(plan.estimatedRisk,100);assert.equal(plan.stopLoss,1980);assert.equal(plan.takeProfit,2040);
 const sell=planTrade({...valid,side:'sell'});assert.ok(sell.stopLoss>quote.bid&&sell.takeProfit<quote.bid);assert.ok(sell.estimatedRisk<=100);
 for(const change of [{info:{...valid.info,type:'ACCOUNT_TRADE_MODE_REAL'}},{info:{...valid.info,investorMode:true}},{quote:{...quote,time:new Date(at-31000).toISOString()}},{quote:{...quote,bid:1900}},{spec:{...spec,tradeMode:'SYMBOL_TRADE_MODE_DISABLED'}},{spec:{...spec,tickSize:undefined}}])assert.throws(()=>planTrade({...valid,...change}));
});
test('persistent equity baselines survive restart and use UTC day rollover',()=>{
 const state={day:new Date(at).toISOString().slice(0,10),day_equity:1000,peak_equity:1100};
 assert.throws(()=>riskCheckpoint(state,{...info,equity:970},bot,at),/Daily/);
 assert.throws(()=>riskCheckpoint({...state,day_equity:900},{...info,equity:980},bot,at),/drawdown/);
 const next=riskCheckpoint(state,{...info,equity:1080},bot,at+86400000);assert.equal(next.day_equity,1080);assert.equal(next.peak_equity,1100);
});
