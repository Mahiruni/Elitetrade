import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadOnlyBrokerRouter} from '../src/elitebridge-router.mjs';
const local='11111111-2222-4333-8444-555555555555';
const remote='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const account={gateway_id:'metaapi-existing:'+local+':'+remote,status:'connected'};
const now=Date.parse('2026-10-14T20:30:00Z');
function mock({health,feed,throwHealth=false,throwFeed=false}={}){
 const calls=[];
 const metaapi={mode:'account-data',
  async connectionHealth(id){calls.push(['health',id]);if(throwHealth)throw Error('secret account data');return health||{hostingState:'DEPLOYED',connectionStatus:'CONNECTED',brokerVerified:true,accountType:'demo',tradeAllowed:true};},
  async previewMarket(id,symbol,frame){calls.push(['preview',id,symbol,frame]);if(throwFeed)throw Error('private upstream token');return feed||{info:{platform:'mt5',type:'ACCOUNT_TRADE_MODE_DEMO'},quote:{symbol,time:new Date(now-15000).toISOString(),bid:4050.12,ask:4050.26}};},
  async demoOrder(){throw Error('Must never submit trade');},
  async market(){throw Error('Must never read execution market');}
 };
 const router=createReadOnlyBrokerRouter({metaapi,clock:()=>now});
 return {router,calls};
}
test('a verified hosted DEMO account returns fresh safe quote without calling execution methods',async()=>{
 const {router,calls}=mock();const data=await router.probe({account,symbol:'XAUUSDm'});
 assert.equal(data.state,'verified-demo');assert.equal(data.market.state,'fresh');
 assert.equal(data.market.quote.ageSeconds,15);
 assert.equal(data.market.quote.spread,.14);
 assert.equal(data.verification.tradeAllowed,true);
 assert.deepEqual(calls.map(a=>a[0]),['health','preview']);
 const json=JSON.stringify(data);
 assert.ok(!json.includes(local));assert.ok(!json.includes(remote));
 assert.equal(data.executedOrder,false);
});
test('REAL broker accounts are rejected without accessing market feed',async()=>{
 const {router,calls}=mock({health:{hostingState:'DEPLOYED',connectionStatus:'CONNECTED',brokerVerified:true,accountType:'real',tradeAllowed:true}});
 const data=await router.probe({account});
 assert.equal(data.state,'real-account-blocked');
 assert.deepEqual(calls.map(a=>a[0]),['health']);
});
test('disconnected and unsupported identities fail closed with no broker request',async()=>{
 const {router,calls}=mock();
 assert.equal((await router.probe({account:{...account,status:'disconnected'}})).state,'saved-disconnected');
 assert.equal((await router.probe({account:{...account,gateway_id:'elitebridge:phantom'}})).state,'unsupported-binding');
 assert.equal(calls.length,0);
});
test('connection problems are safely normalized, with no upstream exception leakage',async()=>{
 const {router}=mock({throwHealth:true});
 const data=await router.probe({account});
 assert.equal(data.state,'unavailable');assert.ok(!JSON.stringify(data).includes('secret account data'));
});
test('expired, future, reversed or malformed prices are never described as fresh',async()=>{
 for(const quote of [{symbol:'XAUUSDm',time:new Date(now-250000).toISOString(),bid:4,ask:5},
 {symbol:'XAUUSDm',time:new Date(now+45000).toISOString(),bid:4,ask:5},
 {symbol:'XAUUSDm',time:new Date(now).toISOString(),bid:7,ask:5},
 {symbol:'OTHER',time:new Date(now).toISOString(),bid:4,ask:5},
 {symbol:'XAUUSDm',time:'bad',bid:4,ask:5}]){
  const {router}=mock({feed:{info:{platform:'mt5',type:'ACCOUNT_TRADE_MODE_DEMO'},quote}});
  const data=await router.probe({account});assert.equal(data.market.state,'stale-or-invalid');
 }
});
test('the read-only preview rechecks DEMO identity and masks errors',async()=>{
 const f=mock({feed:{info:{platform:'mt5',type:'ACCOUNT_TRADE_MODE_REAL'},quote:{symbol:'XAUUSDm',bid:4050,ask:4051,time:new Date(now).toISOString()}}});
 assert.equal((await f.router.probe({account})).market.state,'blocked');
 const g=mock({throwFeed:true});
 const data=await g.router.probe({account});assert.equal(data.market.state,'unavailable');
 assert.ok(!JSON.stringify(data).includes('private upstream token'));
});
test('invalid instrument is rejected before any provider call',async()=>{
 const f=mock();
 await assert.rejects(f.router.probe({account,symbol:'../../trade'}),/Invalid MT5 symbol/);
 assert.equal(f.calls.length,0);
});
