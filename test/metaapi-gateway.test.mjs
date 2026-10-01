import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaApiGateway } from '../src/metaapi-gateway.mjs';
import { createGateway } from '../src/services.mjs';
const env = {METAAPI_TOKEN:'test-secret',METAAPI_ACCOUNT_ID:'remote-demo',METAAPI_LOCAL_ACCOUNT_ID:'local-demo',METAAPI_REGION:'new-york'};
const supplied = {accountId:'local-demo',login:'12345',server:'Broker-Demo',password:'never-forward-this'};
function fixture({account = {}, info = {}, status = 200} = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({url:String(url),options});
    const data = String(url).includes('/account-information')
      ? {platform:'mt5',type:'ACCOUNT_TRADE_MODE_DEMO',login:12345,server:'Broker-Demo',balance:10000,equity:9990,currency:'USD',...info}
      : {_id:'remote-demo',region:'new-york',state:'DEPLOYED',connectionStatus:'CONNECTED',login:'12345',server:'Broker-Demo',...account};
    return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  };
  return {gateway:createMetaApiGateway(env,fetchImpl),calls};
}
test('hosted demo provider requires explicit server-side configuration',() => {
  assert.equal(createGateway({MT5_GATEWAY_PROVIDER:'metaapi'}),null);
  assert.equal(createMetaApiGateway({...env,METAAPI_TOKEN:''}),null);
  assert.throws(() => createMetaApiGateway({...env,METAAPI_REGION:'evil.example/'}),/Invalid/);
});
test('verifies demo identity and returns actual account figures without sending passwords',async () => {
  const {gateway,calls} = fixture();
  const connected = await gateway.connect(supplied);
  assert.equal(connected.connected,true);
  const snapshot = await gateway.snapshot(connected.accountId);
  assert.equal(snapshot.balance,10000); assert.equal(snapshot.equity,9990);
  assert.equal(gateway.tradingEnabled,false);
  assert.ok(calls.every(c => c.options.method === 'GET' && c.options.redirect === 'error'));
  assert.ok(calls.every(c => c.options.headers['auth-token'] === env.METAAPI_TOKEN));
  assert.ok(!JSON.stringify(calls).includes(supplied.password));
  assert.equal(calls[1].url,'https://mt-client-api-v1.new-york.agiliumtrade.ai/users/current/accounts/remote-demo/account-information?refreshTerminalState=true');
});
test('rejects live, unknown, offline, wrong-region and mismatched demo accounts',async () => {
  for (const setup of [
    {info:{type:'ACCOUNT_TRADE_MODE_REAL'}}, {info:{type:undefined}}, {info:{platform:'mt4'}},
    {account:{connectionStatus:'DISCONNECTED'}}, {account:{region:'london'}},
    {account:{_id:'different-id'}}, {info:{login:999}}, {info:{balance:'10000'}}, {status:401}
  ]) await assert.rejects(fixture(setup).gateway.connect(supplied));
  const {gateway,calls} = fixture();
  await assert.rejects(gateway.connect({...supplied,accountId:'another-local'}));
  assert.equal(calls.length,0);
  await assert.rejects(gateway.connect({...supplied,server:'Another-Demo'}));
  await assert.rejects(gateway.snapshot('metaapi:another-local:remote-demo'));
});
test('cannot start, stop or falsely report bot execution; unlink does not delete provider account',async () => {
  const {gateway,calls} = fixture();
  const id = (await gateway.connect(supplied)).accountId;
  calls.length = 0;
  await assert.rejects(gateway.control(id,{id:'bot'},true),/automatic trading is not implemented/);
  await assert.rejects(gateway.control(id,{id:'bot'},false),/automatic trading is not implemented/);
  await assert.rejects(gateway.botState(id,'bot'),/No strategy execution state/);
  assert.deepEqual(await gateway.disconnect(id),{disconnected:true});
  assert.equal(calls.length,0);
});
