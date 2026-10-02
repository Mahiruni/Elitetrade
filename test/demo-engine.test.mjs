import test from 'node:test';
import assert from 'node:assert/strict';
import {engineReady,processDemoRun} from '../src/demo-engine.mjs';
const bot={strategy:'breakout',symbol:'XAUUSDm',risk_percent:1,stop_loss:1,take_profit:2,lot_size:.01,daily_loss:3,max_drawdown:10};
function fixture({type='ACCOUNT_TRADE_MODE_DEMO',outcome='confirmed',exposure=false,active=true,leased=false}={}) {
 const now=Date.now(),boundary=Math.floor(now/900000)*900000;
 const run={bot_id:'bot',user_id:'member',account_id:'account',enabled:true,config:bot};
 const events=[],receipts=[];let orders=0;
 const db={
  async rpc(name){events.push(name);if(name==='elitetrade_engine_lease')return !leased;if(name==='elitetrade_engine_reserve'){if(receipts.length)return null;receipts.push({id:'receipt',status:'reserved'});return 'receipt';}},
  async one(table,search){
   if(table==='elitetrade_engine_runs')return run;
   if(table==='elitetrade_profiles')return {active,disabled:false,role:'user'};
   if(table==='elitetrade_accounts')return {gateway_id:'metaapi:account:remote',status:'connected'};
   if(table==='elitetrade_engine_orders')return search.includes('status=in.')?receipts.find(r=>['reserved','unknown'].includes(r.status)):receipts[0];
   if(table==='elitetrade_engine_risk')return null;
  },
  async update(table,search,value){events.push({table,value});if(table==='elitetrade_engine_orders')Object.assign(receipts[0],value);if(table==='elitetrade_engine_runs')Object.assign(run,value);},async upsert(){}
 };
 const gateway={
  async market(){return {info:{type,platform:'mt5',investorMode:false,tradeAllowed:true,equity:10000,balance:10000,freeMargin:9000},quote:{symbol:bot.symbol,ask:2000,bid:1999.9,lossTickValue:1,time:new Date().toISOString()},spec:{symbol:bot.symbol,tickSize:.01,point:.01,minVolume:.01,maxVolume:100,volumeStep:.01,digits:2,stopsLevel:10,tradeMode:'SYMBOL_TRADE_MODE_FULL',allowedOrderTypes:['SYMBOL_ORDER_MARKET','SYMBOL_ORDER_SL','SYMBOL_ORDER_TP']},positions:exposure?[{id:'manual'}]:[],orders:[],candles:Array.from({length:26},(_,i)=>({time:new Date(boundary-(26-i)*900000).toISOString(),open:i===25?2000:1900,high:i===25?2001:1901,low:i===25?1999:1899,close:i===25?2000:1900}))};},
  async margin(){return {margin:20};},async demoOrder(){events.push('broker-order');orders++;if(outcome==='unknown')throw new Error('timeout');return {orderId:'123'};}
 };
 return {db,gateway,run,events,receipts,get orders(){return orders;}};
}
test('confirmed demo execution reserves first, uses broker acknowledgement and never replays candle',async()=>{
 const f=fixture();await processDemoRun(f);assert.equal(f.orders,1);assert.equal(f.receipts[0].status,'confirmed');
 assert.ok(f.events.indexOf('elitetrade_engine_reserve')<f.events.indexOf('broker-order'));
 await processDemoRun(f);assert.equal(f.orders,1);
});
test('ambiguous broker outcome halts and persists unknown receipt without retry',async()=>{
 const f=fixture({outcome:'unknown'});await processDemoRun(f);assert.equal(f.orders,1);assert.equal(f.run.enabled,false);assert.equal(f.receipts[0].status,'unknown');
 f.run.enabled=true;await processDemoRun(f);assert.equal(f.orders,1);assert.equal(f.run.enabled,false);
});
test('real accounts, inactive members, existing exposure and competing workers send no orders',async()=>{
 for(const options of [{type:'ACCOUNT_TRADE_MODE_REAL'},{active:false},{exposure:true},{leased:true}]) {const f=fixture(options);await processDemoRun(f);assert.equal(f.orders,0);}
});
test('worker readiness requires a recent database heartbeat; database failure is offline',async()=>{
 assert.equal(await engineReady({one:async()=>({updated_at:new Date().toISOString()})}),true);
 assert.equal(await engineReady({one:async()=>({updated_at:new Date(Date.now()-100000).toISOString()})}),false);
 assert.equal(await engineReady({one:async()=>{throw new Error('offline');}}),false);
});
