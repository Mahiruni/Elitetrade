import test from 'node:test';
import assert from 'node:assert/strict';
import {USDT_CONTRACT,USDT_DESTINATION,tronHex,usdtAmount,confirmedUsdt,createTronReader,scanUsdtInvoices} from '../src/tron-payments.mjs';
const txid='ab'.repeat(32),topic='ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const invoice={id:'invoice',destination:USDT_DESTINATION,amount_units:140001234,created_at:1700000000000,expires_at:1700086400000};
const event=units=>({address:tronHex(USDT_CONTRACT).slice(2),topics:[topic,'0'.repeat(64),'0'.repeat(24)+tronHex(USDT_DESTINATION).slice(2)],data:BigInt(units).toString(16).padStart(64,'0')});
const receipt=()=>({id:txid,receipt:{result:'SUCCESS'},blockNumber:123456,blockTimeStamp:invoice.created_at+60000,log:[event(invoice.amount_units)]});
const transfer=()=>({to:USDT_DESTINATION,token_info:{address:USDT_CONTRACT},type:'Transfer',value:String(invoice.amount_units),block_timestamp:invoice.created_at+60000,transaction_id:txid});
test('TRON checksum and exact six-decimal USDT arithmetic',()=>{
 assert.match(tronHex(USDT_DESTINATION),/^41[a-f0-9]{40}$/);
 assert.throws(()=>tronHex(USDT_DESTINATION.slice(0,-1)+'C'),/checksum/);
 assert.throws(()=>tronHex('0x'+ 'a'.repeat(40)),/address/);
 assert.equal(usdtAmount('140001234'),'140.001234');
 assert.equal(usdtAmount('10000000000001'),'10000000.000001');
});
test('only the successful solidified genuine-USDT receipt matches the invoice',()=>{
 assert.deepEqual(confirmedUsdt(receipt(),invoice,txid),{txid,amountUnits:'140001234',blockNumber:123456,blockTimestamp:invoice.created_at+60000});
 for(const mutate of [r=>r.id='aa'.repeat(32),r=>r.receipt.result='REVERT',r=>r.result='FAILED',r=>delete r.blockNumber,r=>r.blockTimeStamp=invoice.created_at-1,r=>r.blockTimeStamp=invoice.expires_at+1,r=>r.log[0].address='a'.repeat(40),r=>r.log[0].topics[0]='f'.repeat(64),r=>r.log[0].topics[2]='0'.repeat(64),r=>r.log[0].data='g'.repeat(64),r=>r.log=[event(invoice.amount_units-1)],r=>r.log=[event(invoice.amount_units+1)],r=>r.log.push(event(1))]){
  const r=receipt();mutate(r);assert.equal(confirmedUsdt(r,invoice,txid),null);
 }
 assert.equal(confirmedUsdt({},invoice,txid),null);
 const r=receipt();r.log=[event(100000000),event(40001234)];assert.ok(confirmedUsdt(r,invoice,txid));
});
test('reader uses fixed mainnet, confirmed incoming transfers, safe pagination, and solidity receipts',async()=>{
 const calls=[];
 const reader=createTronReader({apiKey:' test-key ',fetchImpl:async(url,options)=>{
  calls.push({url:new URL(url),options});
  return {ok:true,json:async()=>url.includes('walletsolidity')?receipt():{success:true,data:[],meta:calls.length===1?{fingerprint:'next token',links:{next:'https://untrusted.example'}}:{}}};
 }});
 await reader.transfers(USDT_DESTINATION,invoice.created_at,invoice.expires_at);
 await reader.receipt(txid);
 assert.equal(calls.length,3);
 for(const c of calls){assert.equal(c.url.origin,'https://api.trongrid.io');assert.equal(c.options.headers['TRON-PRO-API-KEY'],'test-key');assert.equal(c.options.redirect,'error');}
 const p=calls[0].url.searchParams;
 assert.equal(p.get('only_confirmed'),'true');assert.equal(p.get('only_to'),'true');assert.equal(p.get('contract_address'),USDT_CONTRACT);
 assert.equal(calls[1].url.searchParams.get('fingerprint'),'next token');
 assert.equal(calls[2].url.pathname,'/walletsolidity/gettransactioninfobyid');assert.equal(calls[2].options.method,'POST');assert.deepEqual(JSON.parse(calls[2].options.body),{value:txid});
 assert.throws(()=>reader.receipt('../evil'),/Invalid/);
});
test('missing keys, provider quota errors, and incomplete data fail closed',async()=>{
 let hits=0;
 const absent=createTronReader({apiKey:null,fetchImpl:async()=>{hits++;}});
 await assert.rejects(()=>absent.transfers(USDT_DESTINATION,0,1),/TronGrid API key/);assert.equal(hits,0);
 for(const response of [{ok:false,status:429},{ok:true,json:async()=>({success:false,data:[]})}]){
  const reader=createTronReader({apiKey:'key',fetchImpl:async()=>response});
  await assert.rejects(()=>reader.transfers(USDT_DESTINATION,0,1));
 }
});
function scannerFixture({rows=[invoice],transfers=[transfer()],proof=receipt(),lease='lease',error=null}={}){
 const calls=[];
 const db={rpc:async(name,args)=>{calls.push([name,args]);return name==='elitetrade_crypto_claim_scan'?lease:'payment';},query:async()=>rows,update:async(...args)=>calls.push(['update',...args])};
 const reader={transfers:async()=>{if(error)throw error;return transfers;},receipt:async()=>proof};
 return {db,reader,calls};
}
test('scanner binds verified transfer to the owned invoice and finishes its own lease',async()=>{
 const f=scannerFixture();
 assert.deepEqual(await scanUsdtInvoices({...f,at:invoice.created_at+120000}),{checked:1,activated:1});
 const completion=f.calls.find(([n])=>n==='elitetrade_crypto_complete')[1];
 assert.deepEqual(completion,{p_invoice_id:invoice.id,p_txid:txid,p_amount_units:'140001234',p_block_number:123456,p_block_timestamp:invoice.created_at+60000});
 assert.equal(f.calls.at(-1)[1].p_lease_id,'lease');assert.equal(f.calls.at(-1)[1].p_ok,true);
});
test('indexed transfers alone, wrong contracts, and failed receipts never activate',async()=>{
 for(const overrides of [{proof:{}},{proof:{...receipt(),receipt:{result:'REVERT'}}},{transfers:[{...transfer(),token_info:{address:'fake'}}]},{transfers:[{...transfer(),transaction_id:'invalid'}]},{transfers:[{...transfer(),value:'140000000'}]},{transfers:[]}]){
  const f=scannerFixture(overrides);assert.equal((await scanUsdtInvoices({...f,at:invoice.created_at+120000})).activated,0);
  assert.equal(f.calls.some(([n])=>n==='elitetrade_crypto_complete'),false);
 }
});
test('concurrent scanner is skipped and provider failure preserves unpaid invoices',async()=>{
 const busy=scannerFixture({lease:null});assert.deepEqual(await scanUsdtInvoices(busy),{busy:true});assert.equal(busy.calls.length,1);
 const error=Object.assign(new Error('Provider unavailable.'),{status:503});const f=scannerFixture({error});
 await assert.rejects(()=>scanUsdtInvoices(f),/Provider unavailable/);
 assert.equal(f.calls.some(([n])=>n==='elitetrade_crypto_complete'),false);
 assert.deepEqual(f.calls.at(-1),['elitetrade_crypto_finish_scan',{p_lease_id:'lease',p_ok:false,p_message:'Provider unavailable.'}]);
});
test('bounded scanner leaves unprocessed invoices for the next scheduled run',async()=>{
 const f=scannerFixture();let ticks=0;
 assert.deepEqual(await scanUsdtInvoices({...f,clock:()=>ticks++?76000:0}),{checked:0,activated:0});
 assert.equal(f.calls.some(([n])=>n==='update'),false);
});
