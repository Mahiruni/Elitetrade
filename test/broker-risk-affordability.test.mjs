import test from 'node:test';
import assert from 'node:assert/strict';
import {brokerRiskAffordability} from '../src/broker-risk-affordability.mjs';

const now=Date.now();
const bot={symbol:'XAUUSDm',strategy:'scalping-m1',risk_percent:1,
  stop_loss:1,take_profit:2,lot_size:.01,daily_loss:3,max_drawdown:10};
function broker(extra={}) {
  const market={
    info:{type:'ACCOUNT_TRADE_MODE_DEMO',platform:'mt5',tradeAllowed:true,investorMode:false,
      equity:1000,balance:1000,freeMargin:950},
    quote:{symbol:'XAUUSDm',bid:3999.80,ask:4000.00,lossTickValue:1,time:new Date(now).toISOString()},
    spec:{symbol:'XAUUSDm',tickSize:.01,point:.01,minVolume:.01,maxVolume:100,
      volumeStep:.01,digits:2,stopsLevel:10,tradeMode:'SYMBOL_TRADE_MODE_FULL',
      allowedOrderTypes:['SYMBOL_ORDER_MARKET','SYMBOL_ORDER_SL','SYMBOL_ORDER_TP']}
  };
  return {...market,...extra};
}
test('broker-derived minimum lot risk blocks $1000 account with $40 gold stop and $10 risk budget',()=>{
  const r=brokerRiskAffordability({bot,market:broker(),at:now});
  assert.equal(r.status,'blocked_minimum_lot');
  assert.equal(r.tradeAuthorized,false);
  assert.equal(r.riskBudget,10);
  assert.equal(r.minimumBrokerLot,.01);
  assert.ok(r.minLotRiskAtConfiguredStop>=39.9);
  assert.ok(r.suggestion.stopLossPercent>=.1&&r.suggestion.stopLossPercent<1);
  assert.ok(r.suggestion.approxEstimatedLoss<=10);
  assert.ok(r.suggestion.takeProfitPercent<2);
});
test('a suggestion is never applied to the running bot or interpreted as a broker order',()=>{
  const clone=JSON.stringify(bot);
  const r=brokerRiskAffordability({bot,market:broker(),at:now});
  assert.equal(JSON.stringify(bot),clone);
  assert.equal(r.tradeAuthorized,false);
  assert.ok(!Object.hasOwn(r,'order'));
});
test('more equity can make the same lot risk affordable',()=>{
  const base=broker();
  const r=brokerRiskAffordability({bot,market:{...base,info:{...base.info,equity:15000,balance:15000}},at:now});
  assert.equal(r.status,'affordable');
  assert.equal(r.tradeAuthorized,false);
  assert.equal(r.suggestion,null);
});
test('no recommendation if broker is REAL, stale or malformed',()=>{
  const base=broker();
  const cases=[
    {...base,info:{...base.info,type:'ACCOUNT_TRADE_MODE_REAL'}},
    {...base,quote:{...base.quote,time:new Date(now-900000).toISOString()}},
    {...base,spec:{...base.spec,minVolume:0}},
  ];
  for(const market of cases){
    const r=brokerRiskAffordability({bot,market,at:now});
    assert.equal(r.status,'unverified');
    assert.equal(r.tradeAuthorized,false);
    assert.equal(r.suggestion,null);
  }
});
test('no unsafe narrower stop recommendation if spread is too high',()=>{
  const m=broker();
  const r=brokerRiskAffordability({bot,market:{...m,quote:{...m.quote,bid:3995}},at:now});
  assert.equal(r.status,'blocked_minimum_lot');
  assert.equal(r.suggestion,null);
});
