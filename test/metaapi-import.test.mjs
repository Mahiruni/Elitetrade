import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaApiGateway } from '../src/metaapi-gateway.mjs';

const remoteId='66c54440-7d34-402d-a036-a455fe92591a';
const localId='b7e99855-4533-4b31-a419-59df968e3aa4';
const login='477054974', server='Exness-MT5Trial9';
function fixture(options={}) {
  const calls=[];
  // Provisioning read-account frequently omits platform (per MetaApi docs).
  const hosted={_id:remoteId,name:'EliteDemo',login,server,region:'london',state:'DEPLOYED',connectionStatus:'CONNECTED',metadata:{},...options.hosted};
  const info={login,server,platform:'mt5',type:'ACCOUNT_TRADE_MODE_DEMO',balance:10000,equity:10000,currency:'USD',tradeAllowed:true,investorMode:false,...options.info};
  const fetchImpl=async(url,request)=>{
    const path=new URL(url).pathname;
    calls.push({path,method:request.method});
    let data;
    if(path.endsWith('/'+remoteId))data=hosted;
    else if(path.endsWith('/account-information'))data=info;
    else if(path.endsWith('/positions'))data=[];
    else throw new Error('Unexpected provider request: '+path);
    return {ok:true,status:200,json:async()=>data};
  };
  return {gateway:createMetaApiGateway({METAAPI_TOKEN:'server-test-token',METAAPI_REGION:'london'},fetchImpl),calls};
}
test('adopts connected existing demo without creating or deleting a hosted account',async()=>{
  const {gateway,calls}=fixture();
  const result=await gateway.adoptDemo({accountId:localId,login,server},remoteId);
  assert.equal(result.connected,true);
  assert.equal(result.accountId,`metaapi-existing:${localId}:${remoteId}`);
  assert.equal(result.tradingAllowed,true);
  const snapshot=await gateway.snapshot(result.accountId);
  assert.equal(snapshot.accountType,'demo');
  const removed=await gateway.disconnect(result.accountId);
  assert.equal(removed.hostedAccountPreserved,true);
  assert.ok(calls.every(call=>call.method==='GET'));
  assert.ok(calls.every(call=>!call.path.endsWith('/trade')));
});
test('refuses explicitly non-MT5 hosted platform and broker non-MT5 result',async()=>{
  const wrongHosted=fixture({hosted:{platform:'mt4'}});
  await assert.rejects(wrongHosted.gateway.adoptDemo({accountId:localId,login,server},remoteId),/not an MT5 account/);
  const wrongBroker=fixture({info:{platform:'mt4'}});
  await assert.rejects(wrongBroker.gateway.adoptDemo({accountId:localId,login,server},remoteId),/verified MT5/);
});
test('refuses a real hosted account',async()=>{
  const {gateway}=fixture({info:{type:'ACCOUNT_TRADE_MODE_REAL'}});
  await assert.rejects(gateway.adoptDemo({accountId:localId,login,server},remoteId),/DEMO/);
});
test('refuses mismatched broker identity and cross-record metadata',async()=>{
  const mismatch=fixture({hosted:{server:'Other-MT5Trial1'}});
  await assert.rejects(mismatch.gateway.adoptDemo({accountId:localId,login,server},remoteId),/does not match/);
  const claimed=fixture({hosted:{metadata:{elitetradeAccountId:'some-other-account'}}});
  await assert.rejects(claimed.gateway.adoptDemo({accountId:localId,login,server},remoteId),/another EliteTrade record/);
});
test('does not authorize demo orders just because a hosted demo was adopted',async()=>{
  const {gateway,calls}=fixture();
  const {accountId}=await gateway.adoptDemo({accountId:localId,login,server},remoteId);
  await assert.rejects(gateway.demoOrder(accountId,{},'receipt123'),/disabled/);
  assert.ok(calls.every(call=>call.method==='GET'));
});
