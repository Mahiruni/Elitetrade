import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateStrategy,STRATEGIES} from '../src/trading-strategies.mjs';
import {processDemoRun} from '../src/demo-engine.mjs';

const aligned=Math.floor(Date.now()/60000)*60000;
const commonBot={strategy:'scalping-m1',symbol:'XAUUSDm',risk_percent:1,stop_loss:1,take_profit:2,lot_size:.01,daily_loss:3,max_drawdown:10};
function bars(direction='buy',at=aligned) {
  const lowToHigh=direction==='buy';
  const prices=Array.from({length:36},(_,i)=>lowToHigh?100+i*.3:200-i*.3);
  // The trend stays established across the pullback; this is not a new cross.
  const previous=lowToHigh
    ? {open:110.5,close:109,high:110.6,low:108.9}
    : {open:189.5,close:191,high:191.1,low:189.4};
  const recovered=lowToHigh
    ? {open:109,close:110.8,high:110.9,low:108.95}
    : {open:191,close:189.2,high:191.05,low:189.1};
  return [...prices.map(close=>({open:close,close,high:close+.15,low:close-.15})),previous,recovered]
    .map((bar,i,list)=>({...bar,time:new Date(at-(list.length-i)*60000).toISOString()}));
}

test('M1 adds verified closed-bar pullback recoveries without requiring new EMA crossover',()=>{
  for(const side of ['buy','sell']){
    const candles=bars(side);
    const result=evaluateStrategy('scalping-m1',candles,aligned);
    assert.equal(result.side,side);
    assert.equal(result.timeframe,'1m');
    assert.match(result.description,/pullback recovery/);
    assert.equal(STRATEGIES['scalping-m1'].fast,5);
    assert.equal(STRATEGIES['scalping-m1'].slow,13);
  }
});
test('M1 does not trade unclosed, bad or gapped bars to increase frequency',()=>{
  for(const side of ['buy','sell']){
    const candles=bars(side);
    const notYetConfirmed=candles.slice(0,-1);
    notYetConfirmed.push({...candles.at(-1),time:new Date(aligned).toISOString()});
    assert.equal(evaluateStrategy('scalping-m1',notYetConfirmed,aligned).side,null);
    const interrupted=candles.filter((_,i)=>i!==34);
    assert.throws(()=>evaluateStrategy('scalping-m1',interrupted,aligned),/gaps/);
  }
});
function setup(history=[]) {
  const run={bot_id:'bot-test',user_id:'owner-test',account_id:'account-test',enabled:true,config:commonBot};
  let sent=0,confirmed=0,updatedMessage='',reserve=0;
  const db={
    async rpc(name){
      if(name==='elitetrade_engine_lease')return true;
      if(name==='elitetrade_engine_reserve'){reserve++;return 'receipt-test';}
    },
    async one(table) {
      if(table==='elitetrade_engine_runs')return run;
      if(table==='elitetrade_profiles')return {active:true,disabled:false,role:'admin'};
      if(table==='elitetrade_accounts')return {gateway_id:'metaapi-existing:owner:remote',status:'connected'};
      if(table==='elitetrade_engine_orders')return null;
      if(table==='elitetrade_engine_risk')return null;
      return null;
    },
    async query(table,params){
      assert.equal(table,'elitetrade_engine_orders');
      assert.match(params,/account_id=eq.account-test/);
      assert.match(params,/status=in.\(confirmed,reserved,unknown\)/);
      return history;
    },
    async update(table,filter,data) {
      if(table==='elitetrade_engine_runs') {updatedMessage=data.message||updatedMessage;Object.assign(run,data);}
      if(table==='elitetrade_engine_orders'&&data.status==='confirmed')confirmed++;
    },
    async upsert() {}
  };
  const gateway={
    async market() {return {
      info:{type:'ACCOUNT_TRADE_MODE_DEMO',platform:'mt5',tradeAllowed:true,investorMode:false,
        balance:10000,equity:10000,freeMargin:9000},
      quote:{symbol:'XAUUSDm',ask:110.85,bid:110.80,lossTickValue:1,time:new Date().toISOString()},
      spec:{symbol:'XAUUSDm',tickSize:.01,point:.01,minVolume:.01,maxVolume:100,volumeStep:.01,
        digits:2,stopsLevel:10,tradeMode:'SYMBOL_TRADE_MODE_FULL',
        allowedOrderTypes:['SYMBOL_ORDER_MARKET','SYMBOL_ORDER_SL','SYMBOL_ORDER_TP']},
      positions:[],orders:[],candles:bars('buy')
    };},
    async margin() {return {margin:2};},
    async demoOrder(){sent++;return {id:'test-broker-accepted'};}
  };
  return {db,gateway,run,get sent(){return sent;},get confirmed(){return confirmed;},
    get reserve(){return reserve;},get message(){return updatedMessage;}};
}
test('M1 demo pullback can execute with all original brokerage/risk/reservation safeguards',async()=>{
  const f=setup();
  await processDemoRun({...f,at:Date.now()});
  assert.equal(f.sent,1);
  assert.equal(f.reserve,1);
  assert.equal(f.confirmed,1);
});
test('M1 account-wide 3-minute cooldown rejects otherwise-valid signals',async()=>{
  const f=setup([{id:'recent',created_at:new Date(Date.now()-90000).toISOString(),status:'confirmed'}]);
  await processDemoRun({...f,at:Date.now()});
  assert.equal(f.sent,0);
  assert.equal(f.reserve,0);
  assert.match(f.message,/cooldown/i);
});
test('M1 8-per-day entry cap rejects otherwise-valid signals',async()=>{
  const h=Array.from({length:8},(_,i)=>({id:String(i),created_at:new Date(Date.now()-(i+4)*60000).toISOString(),status:'confirmed'}));
  const f=setup(h); await processDemoRun({...f,at:Date.now()});
  assert.equal(f.sent,0);
  assert.equal(f.reserve,0);
  assert.match(f.message,/daily entry cap/i);
});
test('M1 fails closed when order history cannot be checked',async()=>{
  const f=setup();
  f.db.query=async()=>{throw Error('Database unavailable')};
  await processDemoRun({...f,at:Date.now()});
  assert.equal(f.sent,0);
  assert.equal(f.reserve,0);
  assert.equal(f.run.enabled,true);
  assert.match(f.message,/entry history unavailable/);
});
