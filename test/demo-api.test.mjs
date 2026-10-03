import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
async function fixture(t){
 let ready=false,type='ACCOUNT_TRADE_MODE_DEMO',controls=0,orders=0;
 const user={id:'owner',email:'test@example.test',full_name:'Tester',role:'user',active:true,disabled:false};
 const bot={id:'bot',account_id:'account',user_id:'owner',status:'stopped',strategy:'breakout',symbol:'XAUUSDm',risk_percent:1,stop_loss:1,take_profit:2,lot_size:.01,daily_loss:3,max_drawdown:10};
 const db={authUser:async()=>({id:'owner',factors:[]}),one:async(table,search)=>{
  if(table==='elitetrade_profiles')return user;
  if(table==='elitetrade_bots')return search.includes('id=eq.other')?null:bot;
  if(table==='elitetrade_accounts')return {id:'account',gateway_id:'metaapi:account:remote',status:'connected'};
  if(table==='elitetrade_engine_heartbeat')return ready?{updated_at:new Date().toISOString()}:null;
  if(table==='elitetrade_settings')return {value:'14000'};
 },rpc:async name=>{if(name==='elitetrade_engine_control')controls++;},query:async()=>[]};
 const gateway={mode:'account-data',tradingEnabled:false,market:async()=>{
  const at=Math.floor(Date.now()/900000)*900000;
  return {info:{type,platform:'mt5',tradeAllowed:true,investorMode:false,equity:10000,balance:10000,freeMargin:9000},candles:Array.from({length:26},(_,i)=>({time:new Date(at-(26-i)*900000).toISOString(),open:100,high:101,low:99,close:100}))};
 },demoOrder:async()=>{orders++;}};
 const app=createSupabaseApplication({db,deviceVerification:false,gateway,telegram:null,env:{APP_ORIGIN:'http://localhost:3000'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer test','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 return {call,set ready(v){ready=v;},set type(v){type=v;},get controls(){return controls;},get orders(){return orders;}};
}
test('production demo control requires heartbeat and verified demo permissions; Stop remains available offline',async t=>{
 const f=await fixture(t);
 assert.equal((await f.call('/api/config')).data.tradingEnabled,false);
 assert.equal((await f.call('/api/bots')).data.engineReady,false);
 assert.equal((await f.call('/api/bots/bot/control',{running:true})).status,503);assert.equal(f.controls,0);
 assert.equal((await f.call('/api/bots/bot/control',{running:false})).status,200);assert.equal(f.controls,1);
 f.ready=true;assert.equal((await f.call('/api/config')).data.tradingEnabled,true);
 assert.equal((await f.call('/api/bots')).data.engineReady,true);
 f.type='ACCOUNT_TRADE_MODE_REAL';assert.equal((await f.call('/api/bots/bot/control',{running:true})).status,409);assert.equal(f.controls,1);
 f.type='ACCOUNT_TRADE_MODE_DEMO';assert.equal((await f.call('/api/bots/bot/control',{running:true})).status,200);assert.equal(f.controls,2);
 assert.equal((await f.call('/api/bots/other/control',{running:true})).status,404);
 assert.equal(f.orders,0);
});
test('strategy preview uses broker data but does not arm or execute',async t=>{
 const f=await fixture(t);const r=await f.call('/api/bots/bot/preview',{});
 assert.equal(r.status,200);assert.equal(r.data.message,'Preview only. No order sent.');assert.equal(r.data.signal.side,null);assert.equal(f.controls,0);assert.equal(f.orders,0);
});
