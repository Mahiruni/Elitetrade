import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
import {USDT_DESTINATION} from '../src/tron-payments.mjs';
async function fixture(t){
 const calls=[];
 const profile={id:'5f94bfa3-d7f6-4ec6-a944-cd116c4dc3ec',email:'fixture@example.test',role:'user',active:false,disabled:false};
 const method={id:'00000000-0000-4000-8000-000000000001',kind:'crypto',network:'TRC20',details:USDT_DESTINATION};
 const invoice={id:'owned-invoice',amount_units:140001234,status:'pending'};
 const db={authUser:async()=>({id:profile.id,factors:[]}),one:async(table)=>{
  if(table==='elitetrade_profiles')return profile;
  if(table==='elitetrade_crypto_health')return {provider_ok:true,updated_at:new Date().toISOString(),message:'Ready.'};
  if(table==='elitetrade_settings')return {value:'14000'};
 },query:async(table,search,token)=>{calls.push([table,search,token]);return table==='elitetrade_payment_methods'?[method]:table==='elitetrade_crypto_invoices'?[invoice]:[];},rpc:async(name,args,token)=>{calls.push([name,args,token]);return name==='elitetrade_crypto_invoice'?invoice:null;}};
 const app=createSupabaseApplication({db,gateway:null,telegram:null,env:{APP_ORIGIN:'http://localhost:3000'}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));t.after(()=>app.close());
 const base=`http://127.0.0.1:${app.server.address().port}`;
 const call=async(path,body,token='member')=>{const r=await fetch(base+'/api'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
 return {calls,call,profile,method};
}
test('invoice endpoints require authentication and enforce ownership in data queries',async t=>{
 const f=await fixture(t);assert.equal((await f.call('/crypto-invoices',null,'')).status,401);
 const result=await f.call('/crypto-invoices');assert.equal(result.status,200);assert.equal(result.data.invoices[0].amount,'140.001234');
 const query=f.calls.find(([n])=>n==='elitetrade_crypto_invoices');assert.match(query[1],new RegExp(`user_id=eq.${f.profile.id}`));assert.equal(query[2],'member');
 const methods=await f.call('/payment-methods');assert.equal(methods.data.methods[0].automatic,true);assert.equal(methods.data.crypto.ready,true);
});
test('invoice creation accepts only method ID and uses the caller token, never client amount or recipient',async t=>{
 const f=await fixture(t);
 const result=await f.call('/crypto-invoices',{methodId:f.method.id,amount:1,destination:'evil'});
 assert.equal(result.status,201);assert.equal(result.data.invoice.amount,'140.001234');
 assert.deepEqual(f.calls.find(([n])=>n==='elitetrade_crypto_invoice'),['elitetrade_crypto_invoice',{p_method_id:f.method.id},'member']);
 assert.equal((await f.call('/crypto-invoices',{methodId:'bad'})).status,400);
 assert.equal((await f.call('/payments',{methodId:f.method.id,reference:'trc20:'+'a'.repeat(64)})).status,400);
});
test('TronGrid configuration is admin-only and the saved key is excluded from audit output',async t=>{
 const f=await fixture(t),body={price:140,telegramChat:'',tronGridApiKey:'test-private-key-123456'};
 assert.equal((await f.call('/admin/settings',body)).status,403);assert.equal(f.calls.length,0);
 f.profile.role='admin';assert.equal((await f.call('/admin/settings',body)).status,200);
 assert.deepEqual(f.calls.find(([n])=>n==='elitetrade_crypto_save_key'),['elitetrade_crypto_save_key',{p_key:body.tronGridApiKey},'member']);
 assert.ok(!JSON.stringify(f.calls.find(([n])=>n==='elitetrade_audit')).includes(body.tronGridApiKey));
 f.calls.length=0;
 assert.equal((await f.call('/admin/settings',{...body,tronGridApiKey:'x'.repeat(16)+'\nBad'})).status,400);assert.equal(f.calls.length,0);
});
