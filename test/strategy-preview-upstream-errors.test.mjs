import test from 'node:test';
import assert from 'node:assert/strict';
import {createMetaApiGateway} from '../src/metaapi-gateway.mjs';

const link='metaapi-existing:ab618cec-f918-42e9-a610-9316f0afc728:66c54440-7d34-402d-a036-a455fe92591a';
function hosted(){return {_id:'66c54440-7d34-402d-a036-a455fe92591a',name:'EliteDemo',metadata:{},login:'477054974',server:'Exness-MT5Trial9',region:'london',state:'DEPLOYED',connectionStatus:'CONNECTED'};}
test('MetaApi TypeError network failure is not wrongly called an invalid Vercel token',async()=>{
 let calls=0;
 const gateway=createMetaApiGateway({METAAPI_TOKEN:'safe-test-token'},async()=>{
   calls++;throw Object.assign(new TypeError('private: socket failed'),{cause:{code:'UNKNOWN_TLS_NETWORK_REASON'}});
 });
 const warnings=[];
 const mocked=test.mock.method(console,'warn',text=>warnings.push(JSON.parse(text)));
 try {
   await assert.rejects(gateway.connectionHealth(link),e=>{
     assert.match(e.message,/network connection to MetaApi/);
     assert.doesNotMatch(e.message,/replace.*token|change.*token|redeploy/i);
     assert.doesNotMatch(e.message,/private/);
     return true;
   });
   assert.equal(calls,2,'GET requests can be retried once after network failure');
   assert.deepEqual(warnings.map(x=>x.kind),['network','network']);
 } finally {mocked.mock.restore();}
});
test('MetaApi authorization failure continues to identify a rejected token',async()=>{
 const gateway=createMetaApiGateway({METAAPI_TOKEN:'safe-test-token'},async()=>Response.json({error:'UnauthorizedError',message:'PRIVATE'}, {status:401}));
 const mocked=test.mock.method(console,'warn',()=>{});
 try {await assert.rejects(gateway.connectionHealth(link),/rejected the API token/);}
 finally {mocked.mock.restore();}
});
test('provider 504 is described as account-information unavailability, not Vercel configuration',async()=>{
 const gateway=createMetaApiGateway({METAAPI_TOKEN:'safe-test-token'},async(url)=>{
   if(new URL(url).pathname.endsWith('/account-information'))return Response.json({error:'InternalError',message:'PRIVATE'}, {status:504});
   return Response.json(hosted());
 });
 const mocked=test.mock.method(console,'warn',()=>{});
 try {
   const result=await gateway.connectionHealth(link);
   assert.equal(result.providerStatus,504);
   assert.equal(result.brokerVerified,false);
   assert.equal(result.accountType,null);
 }finally{mocked.mock.restore();}
});
