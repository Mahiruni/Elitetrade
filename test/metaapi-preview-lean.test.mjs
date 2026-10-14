import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetaApiGateway} from '../src/metaapi-gateway.mjs';
const remote='66c54440-7d34-402d-a036-a455fe92591a';
const local='ab618cec-f918-42e9-a610-9316f0afc728';
const binding=`metaapi-existing:${local}:${remote}`;
function mock() {
 const calls=[];
 const fetcher=async(url,options)=>{
  const u=new URL(url),path=u.pathname;
  calls.push({path,query:u.search,method:options.method});
  if(path.endsWith('/'+remote))return Response.json({_id:remote,name:'EliteDemo',metadata:{},login:'477054974',server:'Exness-MT5Trial9',region:'london',state:'DEPLOYED',connectionStatus:'CONNECTED'});
  if(path.endsWith('/account-information'))return Response.json({login:477054974,server:'Exness-MT5Trial9',platform:'mt5',type:'ACCOUNT_TRADE_MODE_DEMO',currency:'USD',balance:10000,equity:10000,tradeAllowed:true,investorMode:false,freeMargin:9990});
  if(path.endsWith('/current-price'))return Response.json({symbol:'XAUUSD',time:new Date().toISOString(),bid:4050,ask:4051});
  if(path.endsWith('/specification'))return Response.json({symbol:'XAUUSD',point:0.01,digits:2});
  if(path.endsWith('/candles'))return Response.json([]);
  if(path.endsWith('/positions')||path.endsWith('/orders'))return Response.json([]);
  throw new Error('Unexpected path');
 };
 return {gateway:createMetaApiGateway({METAAPI_TOKEN:'fixture-token'},fetcher),calls};
}
test('read-only preview avoids forced MT5 refresh, positions, orders and trading',async()=>{
 const {gateway,calls}=mock();
 const p=await gateway.previewMarket(binding,'XAUUSD','5m');
 assert.equal(p.info.type,'ACCOUNT_TRADE_MODE_DEMO');
 assert.equal(p.exposureVerified,false);
 assert.equal(p.quote.symbol,'XAUUSD');
 assert.equal(p.spec.symbol,'XAUUSD');
 assert.deepEqual(p.candles,[]);
 assert.equal(calls.length,5);
 assert.ok(calls.every(c=>c.method==='GET' && !c.query.includes('refreshTerminalState=true')));
 assert.ok(!calls.some(c=>/\/(positions|orders|trade)$/.test(c.path)));
});
test('MetaApi accepts 1m preview candles without trading or forced refresh',async()=>{
 const {gateway,calls}=mock();
 await gateway.previewMarket(binding,'XAUUSD','1m');
 assert.ok(calls.some(c=>c.path.includes('/timeframes/1m/candles')));
 assert.ok(calls.some(c=>c.path.endsWith('/candles')));
 assert.ok(calls.every(c=>c.method==='GET' && !c.query.includes('refreshTerminalState=true')));
 assert.ok(!calls.some(c=>c.path.endsWith('/trade')));
});
test('execution market retains all fresh account/position/order risk reads',async()=>{
 const {gateway,calls}=mock();
 const p=await gateway.market(binding,'XAUUSD','5m');
 assert.deepEqual(p.positions,[]);
 assert.deepEqual(p.orders,[]);
 assert.ok(calls.some(c=>c.path.endsWith('/account-information') && c.query.includes('refreshTerminalState=true')));
 assert.ok(calls.some(c=>c.path.endsWith('/positions') && c.query.includes('refreshTerminalState=true')));
 assert.ok(calls.some(c=>c.path.endsWith('/orders') && c.query.includes('refreshTerminalState=true')));
 assert.ok(!calls.some(c=>c.path.endsWith('/trade')));
});
test('read-only snapshot avoids slow terminal refresh while remaining broker-verified',async()=>{
 const {gateway,calls}=mock();
 const result=await gateway.snapshot(binding);
 assert.equal(result.connected,true);assert.equal(result.accountType,'demo');
 assert.ok(calls.every(c=>c.method==='GET'&&!c.query.includes('refreshTerminalState=true')));
});
