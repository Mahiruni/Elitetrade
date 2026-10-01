import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaApiGateway } from '../src/metaapi-gateway.mjs';
const env={METAAPI_TOKEN:'private',METAAPI_REGION:'new-york'};
const supplied={accountId:'local-1',login:'12345',server:'Broker-Live',password:'secret-password'};
function fixture(overrides={}) {
  const calls=[]; const accounts=new Map(); let creations=0;
  const fetchImpl=async(url,options)=>{
    const u=new URL(url); calls.push({url:String(url),...options});
    if(overrides.status) return new Response('{}',{status:overrides.status});
    if(options.method==='POST' && u.pathname==='/users/current/accounts') {
      const b=JSON.parse(options.body); const id=`remote-${++creations}`;
      accounts.set(id,{...b,_id:id,state:'DEPLOYED',connectionStatus:'CONNECTED',...overrides.account});
      return Response.json({id});
    }
    if(u.searchParams.has('query')) return Response.json([...accounts.values()]);
    const id=u.pathname.split('/')[4]; const a=accounts.get(id);
    if(options.method==='DELETE') {accounts.delete(id);return new Response(null,{status:204});}
    if(u.pathname.endsWith('/deploy')) {a.state='DEPLOYED';return new Response(null,{status:204});}
    if(u.pathname.endsWith('/account-information')) return Response.json({platform:'mt5',type:'ACCOUNT_TRADE_MODE_REAL',login:Number(a.login),server:a.server,balance:100,equity:99,currency:'USD',...overrides.info});
    return Response.json({...a,...overrides.metadata});
  };
  return {gateway:createMetaApiGateway(env,fetchImpl),calls,accounts,get creations(){return creations;}};
}
test('requires only a private API token and validates region',()=>{
  assert.equal(createMetaApiGateway({}),null);
  assert.ok(createMetaApiGateway(env));
  assert.throws(()=>createMetaApiGateway({...env,METAAPI_REGION:'evil.test/'}),/Invalid/);
});
test('provisions distinct per-user demo and real connections; retries reuse account',async()=>{
  for(const type of ['ACCOUNT_TRADE_MODE_REAL','ACCOUNT_TRADE_MODE_DEMO']) {
    const f=fixture({info:{type}}); const first=await f.gateway.connect(supplied);
    assert.equal(first.connected,true);
    assert.equal((await f.gateway.snapshot(first.accountId)).accountType,type.endsWith('REAL')?'real':'demo');
    assert.equal((await f.gateway.connect(supplied)).accountId,first.accountId);
    const second=await f.gateway.connect({...supplied,accountId:'local-2',login:'67890'});
    assert.notEqual(first.accountId,second.accountId); assert.equal(f.creations,2);
    const writes=f.calls.filter(c=>c.method==='POST');
    assert.ok(writes.every(c=>/^[a-f0-9]{32}$/.test(c.headers['transaction-id'])));
    assert.ok(f.calls.filter(c=>c.method==='GET').every(c=>!c.body));
    assert.equal(f.gateway.tradingEnabled,false);
  }
});
test('delayed connection persists a pending binding and deploys without duplicate creation',async()=>{
  const f=fixture({account:{state:'UNDEPLOYED',connectionStatus:'DISCONNECTED'}});
  const pending=await f.gateway.connect(supplied);assert.equal(pending.pending,true);assert.equal(pending.connected,false);
  assert.ok(f.calls.some(c=>c.url.endsWith('/deploy')));
  const a=[...f.accounts.values()][0];a.connectionStatus='CONNECTED';
  assert.equal((await f.gateway.connect(supplied)).connected,true);assert.equal(f.creations,1);
});
test('rejects wrong ownership, identity, platform, contest and incomplete balances',async()=>{
  for(const setup of [{metadata:{metadata:{elitetradeAccountId:'another'}}},{metadata:{login:'999'}},{info:{platform:'mt4'}},{info:{type:'ACCOUNT_TRADE_MODE_CONTEST'}},{info:{balance:'100'}},{status:401}]) await assert.rejects(fixture(setup).gateway.connect(supplied));
  await assert.rejects(fixture().gateway.snapshot('https://evil.test'));
});
test('accepted creation retries use a stable transaction ID without leaking provider errors',async()=>{
  const calls=[];const gateway=createMetaApiGateway(env,async(url,options)=>{
    calls.push(options);return options.method==='GET'?Response.json([]):new Response('secret-password raw provider error',{status:202});
  });
  for(let i=0;i<2;i++) await assert.rejects(gateway.connect(supplied),/processing this connection/);
  const writes=calls.filter(c=>c.method==='POST');assert.equal(writes[0].headers['transaction-id'],writes[1].headers['transaction-id']);
});
test('rejects trading and removes only the verified provider binding',async()=>{
  const f=fixture();const first=await f.gateway.connect(supplied);const second=await f.gateway.connect({...supplied,accountId:'local-2'});
  await assert.rejects(f.gateway.control(first.accountId,{},true),/not implemented/);
  await assert.rejects(f.gateway.botState(first.accountId),/No strategy/);
  await assert.rejects(f.gateway.disconnect(first.accountId.replace('local-1','local-2')),/ownership/);
  assert.deepEqual(await f.gateway.disconnect(first.accountId),{disconnected:true});
  assert.equal(f.accounts.size,1);assert.equal((await f.gateway.snapshot(second.accountId)).balance,100);
});
