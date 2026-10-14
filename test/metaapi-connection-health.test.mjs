import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaApiGateway } from '../src/metaapi-gateway.mjs';

const local='ab618cec-f918-42e9-a610-9316f0afc728';
const remote='66c54440-7d34-402d-a036-a455fe92591a';
const link=`metaapi-existing:${local}:${remote}`;
function setup({connectionStatus='CONNECTED',state='DEPLOYED',infoStatus=200,accountType='ACCOUNT_TRADE_MODE_DEMO',providerMessages=false}={}) {
  const calls=[];
  const fetcher=async(url,opts)=>{
    const path=new URL(url).pathname;
    calls.push({path,method:opts.method});
    if(path.endsWith('/'+remote))return Response.json({_id:remote,name:'EliteDemo',metadata:{},login:'477054974',server:'Exness-MT5Trial9',region:'london',state,connectionStatus});
    if(path.endsWith('/account-information'))
      return infoStatus===200?Response.json({login:'477054974',server:'Exness-MT5Trial9',platform:'mt5',type:accountType,balance:10000,equity:10000,currency:'USD',tradeAllowed:true,investorMode:false}):Response.json({error:'InternalError',message:'PRIVATE PROVIDER DETAILS'},{status:infoStatus});
    throw new Error('Unexpected path '+path);
  };
  return {gateway:createMetaApiGateway({METAAPI_TOKEN:'fixture-token'},fetcher),calls};
}
test('disconnected broker returns actionable safe status without retrieving account figures or trading',async()=>{
  const {gateway,calls}=setup({connectionStatus:'DISCONNECTED_FROM_BROKER'});
  const state=await gateway.connectionHealth(link);
  assert.equal(state.hostingState,'DEPLOYED');
  assert.equal(state.connectionStatus,'DISCONNECTED_FROM_BROKER');
  assert.equal(state.accountType,null);
  assert.equal(state.brokerVerified,false);
  assert.match(state.message,/broker/);
  assert.equal(calls.length,1);
  assert.ok(calls.every(c=>c.method==='GET'));
});
test('normal disconnected and deploying hosting fail closed without account-info requests',async()=>{
 for (const settings of [{connectionStatus:'DISCONNECTED'},{state:'DEPLOYING'}]) {
  const {gateway,calls}=setup(settings);const state=await gateway.connectionHealth(link);
  assert.equal(state.brokerVerified,false);
  assert.equal(state.accountType,null);
  assert.equal(calls.length,1);
 }
});
test('connected verified demo provides current broker state without enabling orders',async()=>{
 const {gateway,calls}=setup();const state=await gateway.connectionHealth(link);
 assert.equal(state.hostingState,'DEPLOYED');
 assert.equal(state.connectionStatus,'CONNECTED');
 assert.equal(state.brokerVerified,true);
 assert.equal(state.accountType,'demo');
 assert.equal(state.tradeAllowed,true);
 assert.equal(state.executionEnabled,false);
 assert.ok(calls.every(c=>c.method==='GET'&&!c.path.endsWith('/trade')));
});
test('connected REAL never appears as a demo',async()=>{
 const {gateway}=setup({accountType:'ACCOUNT_TRADE_MODE_REAL'});
 const result=await gateway.connectionHealth(link);
 assert.equal(result.accountType,'real');assert.equal(result.executionEnabled,false);
});
test('provider 504 leaves broker type unverified and scrubs provider response',async()=>{
 const {gateway}=setup({infoStatus:504});
 const result=await gateway.connectionHealth(link);
 assert.equal(result.providerStatus,504);
 assert.equal(result.accountType,null);
 assert.equal(result.brokerVerified,false);
 assert.ok(!JSON.stringify(result).includes('PRIVATE PROVIDER DETAILS'));
});
test('invalid auth token errors are not silently treated as a connected broker',async()=>{
 const {gateway}=setup({infoStatus:401});
 await assert.rejects(gateway.connectionHealth(link),/token/i);
});
