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
test('normalizes pasted tokens, rejects invalid headers, retries only safe reads',async()=>{
 const seen=[];
 const normalized=createMetaApiGateway({...env,METAAPI_TOKEN:'  Bearer private\n'},async(url,options)=>{seen.push(options.headers['auth-token']);return Response.json([]);});
 await assert.rejects(normalized.connect(supplied),/valid account ID/);
 assert.deepEqual(seen,['private','private']);
 let calls=0;
 const invalid=createMetaApiGateway({...env,METAAPI_TOKEN:'bad\ntoken'},async()=>{calls++;});
 await assert.rejects(invalid.connect(supplied),/invalid characters/);assert.equal(calls,0);
 const transient=createMetaApiGateway(env,async()=>{calls++;if(calls===1)throw Object.assign(new Error('secret'),{cause:{code:'ECONNRESET'}});return Response.json([]);});
 await assert.rejects(transient.connect(supplied),/valid account ID/);assert.equal(calls,3);
 calls=0;
 const write=createMetaApiGateway(env,async(url,options)=>{calls++;if(options.method==='POST')throw Object.assign(new Error('secret-password'),{name:'TimeoutError'});return Response.json([]);});
 await assert.rejects(write.connect(supplied),/timed out/);assert.equal(calls,2);
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

test('provider demo order is explicitly gated, protects SL/TP and verifies broker acknowledgement',async()=>{
 for(const [type,enabled,code] of [['ACCOUNT_TRADE_MODE_REAL','true',10009],['ACCOUNT_TRADE_MODE_DEMO','false',10009],['ACCOUNT_TRADE_MODE_DEMO','true',10008],['ACCOUNT_TRADE_MODE_DEMO','true',10009]]) {
  const calls=[];const g=createMetaApiGateway({...env,DEMO_EXECUTION_ENABLED:enabled},async(url,options)=>{
   calls.push({url:String(url),options});
   if(String(url).endsWith('/trade'))return Response.json({numericCode:code,stringCode:code===10009?'TRADE_RETCODE_DONE':'TRADE_RETCODE_PLACED',orderId:'123'});
   if(String(url).includes('/account-information'))return Response.json({platform:'mt5',type,login:12345,server:'Broker-Live',balance:1000,equity:1000,currency:'USD',tradeAllowed:true,investorMode:false});
   return Response.json({_id:'remote',name:'EliteTrade local',metadata:{elitetradeAccountId:'local'},login:'12345',server:'Broker-Live',region:'new-york',state:'DEPLOYED',connectionStatus:'CONNECTED'});
  });
  const execute=()=>g.demoOrder('metaapi:local:remote',{actionType:'ORDER_TYPE_BUY',symbol:'XAUUSDm',volume:.01,stopLoss:1900,takeProfit:2100},'receipt-id');
  if(type==='ACCOUNT_TRADE_MODE_DEMO'&&enabled==='true'&&code===10009)assert.equal((await execute()).orderId,'123');else await assert.rejects(execute);
  const trades=calls.filter(c=>c.url.endsWith('/trade'));
  if(type==='ACCOUNT_TRADE_MODE_REAL'||enabled==='false')assert.equal(trades.length,0);
  else {assert.equal(trades.length,1);const body=JSON.parse(trades[0].options.body);assert.equal(body.stopLoss,1900);assert.equal(body.takeProfit,2100);assert.equal(body.symbol,'XAUUSDm');assert.ok(trades[0].url.startsWith('https://mt-client-api-v1.new-york.agiliumtrade.ai/'));}
 }
});
