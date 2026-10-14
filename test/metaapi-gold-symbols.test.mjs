import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaApiGateway } from '../src/metaapi-gateway.mjs';

const localId='ab618cec-f918-42e9-a610-9316f0afc728';
const remoteId='66c54440-7d34-402d-a036-a455fe92591a';
function setup(options={}) {
 const calls=[];
 const hosted={_id:remoteId,metadata:{},name:'EliteDemo',login:'477054974',server:'Exness-MT5Trial9',region:'london',state:'DEPLOYED',connectionStatus:'CONNECTED'};
 const info={login:'477054974',server:'Exness-MT5Trial9',platform:'mt5',type:'ACCOUNT_TRADE_MODE_DEMO',balance:10000,equity:10000,currency:'USD'};
 const fetchImpl=async(url,request)=>{
   const path=new URL(url).pathname;
   calls.push({method:request.method,path});
   if(path.endsWith('/'+remoteId)) return Response.json(hosted);
   if(path.endsWith('/account-information')) return Response.json({...info,...options.info});
   if(path.endsWith('/symbols')) return options.error ? Response.json({error:'NotFoundError',message:'Sensitive provider body'},{status:404}) : Response.json(options.symbols||['EURUSD','XAUUSDm','XAUUSD.pro','GOLD']);
   throw new Error('Unexpected request '+path);
 };
 return {gateway:createMetaApiGateway({METAAPI_TOKEN:'fixture-token'},fetchImpl),calls};
}
test('discovers exact Gold broker symbols without sending orders',async()=>{
 const {gateway,calls}=setup();
 const result=await gateway.goldSymbols(`metaapi-existing:${localId}:${remoteId}`,'XAUUSD');
 assert.equal(result.requestedSymbol,'XAUUSD');
 assert.equal(result.exactAvailable,false);
 assert.deepEqual(result.goldSymbols,['GOLD','XAUUSD.pro','XAUUSDm']);
 assert.equal(result.accountType,'demo');
 assert.equal(result.executionEnabled,false);
 assert.equal(calls.length,3);
 assert.ok(calls.every(c=>c.method==='GET'&&!c.path.endsWith('/trade')));
});
test('does not discover symbols for a real broker account',async()=>{
 const {gateway,calls}=setup({info:{type:'ACCOUNT_TRADE_MODE_REAL'}});
 await assert.rejects(gateway.goldSymbols(`metaapi-existing:${localId}:${remoteId}`),/DEMO/);
 assert.ok(!calls.some(c=>c.path.endsWith('/symbols')));
});
test('provider 404 becomes an actionable symbol-list error without leaking provider messages',async()=>{
 const {gateway}=setup({error:true});
 await assert.rejects(gateway.goldSymbols(`metaapi-existing:${localId}:${remoteId}`),e=>e.message.includes('symbol list') && !e.message.includes('Sensitive'));
});
test('rejects malformed symbol lookups before provider calls',async()=>{
 const {gateway,calls}=setup();
 await assert.rejects(gateway.goldSymbols(`metaapi-existing:${localId}:${remoteId}`,'../../secret'),/Invalid symbol/);
 assert.equal(calls.length,0);
});
