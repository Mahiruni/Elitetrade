// Synthetic contract tests. These do not install MT5, contact Exness or trade.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {spawnSync} from 'node:child_process';
import {createGatewaySupervisor,gatewayHttpHandler,sdkCollector,validateGatewayConfig} from '../src/elitebridge-gateway-runtime.mjs';
import {sealGatewayConfig,openGatewayConfig} from '../src/elitebridge-gateway-vault.mjs';
import {validateGatewaySnapshot} from '../src/elitebridge-gateway-snapshot.mjs';

const at=Date.parse('2026-10-16T12:00:00Z');
const config={accountId:'test-account',broker:'Exness',server:'Exness-MT5Trial9',mode:'demo',
  login:'123456',password:'private-fixture-password',token:'x'.repeat(43),symbol:'XAUUSDm',
  terminalPath:'C:\\MT5\\terminal64.exe'};
const packet=()=>({authenticated:true,brokerConnected:true,platform:'mt5',broker:'Exness',mode:'demo',
  accountId:config.accountId,server:config.server,observedAt:new Date(at).toISOString(),
  loginDigest:createHash('sha256').update(config.login).digest('hex'),balance:1000,equity:990,
  currency:'USD',margin:0,freeMargin:990,floatingProfit:-10,positions:[],openPositionCount:0,
  quote:{symbol:'XAUUSDm',bid:4000,ask:4000.1,observedAt:new Date(at).toISOString()},
  tradingEnabled:false,readOnly:true});

test('encrypted gateway vault rejects tampering and wrong key; ciphertext excludes password',()=>{
  const key=randomBytes(32),vault=sealGatewayConfig(config,key);
  assert.deepEqual(openGatewayConfig(vault,key),config);
  assert.ok(!JSON.stringify(vault).includes(config.password));
  assert.throws(()=>openGatewayConfig(vault,randomBytes(32)),/authenticated/);
  const bytes=Buffer.from(vault.ciphertext,'base64');bytes[0]^=1;
  assert.throws(()=>openGatewayConfig({...vault,ciphertext:bytes.toString('base64')},key));
});
test('gateway locks real access and rejects mismatched server mode before collection',()=>{
  assert.throws(()=>validateGatewayConfig({...config,mode:'real'}));
  assert.throws(()=>validateGatewayConfig({...config,server:'Exness-MT5Real9'}));
  assert.throws(()=>validateGatewayConfig({...config,token:'short'}));
  assert.throws(()=>validateGatewayConfig({...config,symbol:undefined}));
  assert.throws(()=>validateGatewayConfig({...config,accountId:123456}));
});
test('strict snapshot binding rejects wrong login, position errors, old source quotes and injected fields',()=>{
  const value=validateGatewaySnapshot({...packet(),password:'must-not-forward'},config,()=>at);
  assert.equal(value.tradingEnabled,false);assert.equal(value.password,undefined);
  for(const change of [{loginDigest:'a'.repeat(64)},{accountId:'other'},
    {tradingEnabled:true},{openPositionCount:1},{positions:[{}]},
    {quote:{...packet().quote,observedAt:new Date(at-31000).toISOString()}},
    {quote:{...packet().quote,symbol:'EURUSD'}},{balance:Infinity}])
    assert.throws(()=>validateGatewaySnapshot({...packet(),...change},config,()=>at));
});
test('supervisor clears stale data after outage and recovers on a fresh collection',async()=>{
  let time=at,down=false;const audit=[];
  const s=createGatewaySupervisor({config,clock:()=>time,audit:x=>audit.push(x),collect:async()=>{
    if(down)throw Object.assign(Error(config.password),{code:'BROKER_DISCONNECTED'});
    return {...packet(),observedAt:new Date(time).toISOString(),quote:null};
  }});
  await s.refresh();assert.equal(s.status().state,'connected');assert.equal(s.snapshot().quote,null);
  time+=31000;assert.throws(()=>s.snapshot());assert.equal(s.status().state,'stale');
  down=true;await s.refresh();assert.equal(s.status().state,'interrupted');assert.throws(()=>s.snapshot());
  down=false;await s.refresh();assert.equal(s.snapshot().observedAt,new Date(time).toISOString());
  assert.ok(!JSON.stringify(audit).includes(config.password));
  await s.stop();assert.equal(s.status().state,'stopped');assert.throws(()=>s.snapshot());
});
test('single in-flight collection and stopped supervisor cannot revive a connection',async()=>{
  let release,calls=0;
  const s=createGatewaySupervisor({config,clock:()=>at,collect:()=>{calls++;return new Promise(r=>{release=r;});}});
  const a=s.refresh(),b=s.refresh();assert.equal(calls,1);assert.equal(a,b);
  const stopped=s.stop();release(packet());await stopped;
  assert.equal(s.status().state,'stopped');assert.throws(()=>s.snapshot());
});
test('identity mismatch blocks immediately; repeated transport failures exhaust recovery budget',async()=>{
  for(const code of ['ACCOUNT_IDENTITY_MISMATCH','BROKER_DISCONNECTED']){
    let calls=0;
    const s=createGatewaySupervisor({config,collect:async()=>{calls++;throw Object.assign(Error(),{code});}});
    for(let i=0;i<10;i++)await s.refresh();
    assert.equal(s.status().state,'blocked');assert.equal(calls,code==='ACCOUNT_IDENTITY_MISMATCH'?1:8);
  }
});
test('private HTTP gateway enforces service auth, account scope and read-only methods',async t=>{
  const s=createGatewaySupervisor({config,clock:()=>at,collect:async()=>packet()});
  const server=createServer(gatewayHttpHandler({config,supervisor:s}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base='http://127.0.0.1:'+server.address().port,headers={Authorization:'Bearer '+config.token};
  assert.equal((await fetch(base+'/healthz')).status,401);
  const path='/snapshot?accountId='+config.accountId+'&mode=demo';
  assert.equal((await fetch(base+path,{headers})).status,503);
  await s.refresh();
  const response=await fetch(base+path,{headers});assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  assert.equal((await response.json()).tradingEnabled,false);
  assert.equal((await fetch(base+'/snapshot?accountId=foreign&mode=demo',{headers})).status,403);
  assert.equal((await fetch(base+path+'&accountId=foreign',{headers})).status,403);
  assert.equal((await fetch(base+path,{headers,method:'POST'})).status,405);
});
test('SDK child receives password on stdin only and never receives gateway service token',async()=>{
  const code=`let s='';for await(const p of process.stdin)s+=p;const c=JSON.parse(s);console.log(JSON.stringify({stdinPassword:c.password,hasToken:'token' in c,argv:process.argv.slice(1),envPassword:process.env.MT5_PASSWORD}));`;
  const collect=sdkCollector({executable:process.execPath,args:['--input-type=module','-e',code],config});
  const result=await collect(new AbortController().signal);
  assert.equal(result.stdinPassword,config.password);assert.equal(result.hasToken,false);
  assert.ok(!JSON.stringify(result.argv).includes(config.password));assert.equal(result.envPassword,undefined);
});
test('SDK child timeout and arbitrary exception strings are sanitized',async()=>{
  const timeout=sdkCollector({executable:process.execPath,args:['-e','setTimeout(()=>{},10000)'],config,timeoutMs:100});
  await assert.rejects(timeout(),e=>e.code==='SDK_TIMEOUT');
  const failure=sdkCollector({executable:process.execPath,args:['-e',`console.log(JSON.stringify({error:'${config.password}'}))`],config});
  await assert.rejects(failure(),e=>e.message==='SDK_COLLECTION_FAILED');
  const nonzero=sdkCollector({executable:process.execPath,args:['-e','console.log("{}");process.exitCode=7'],config});
  await assert.rejects(nonzero(),e=>e.message==='SDK_COLLECTION_FAILED');
});
test('production Python collector authenticates explicitly and validates broker state with fake SDK',()=>{
  const script=String.raw`
import sys, copy, json
from types import SimpleNamespace as N
sys.path.insert(0, 'companion')
from mt5_cloud_gateway import collect, ProbeError
now=1792152000000
cfg=json.loads(sys.stdin.read())
class SDK:
    ACCOUNT_TRADE_MODE_DEMO=0
    def __init__(self):
        self.account=N(login=123456,server=cfg['server'],trade_mode=0,company='Exness (SC) Ltd',currency='USD',balance=1000.,equity=990.,margin=0.,margin_free=990.,profit=-10.,trade_allowed=True)
        self.tick=N(bid=4000.,ask=4000.1,time_msc=now)
        self.closed=False
    def initialize(self,path,**kw):
        assert kw['login']==123456 and kw['password']==cfg['password'] and kw['server']==cfg['server'] and kw['portable'] is True
        return True
    def shutdown(self): self.closed=True
    def account_info(self): return self.account
    def terminal_info(self): return N(connected=True)
    def positions_get(self): return []
    def symbol_select(self,s,v): return True
    def symbol_info_tick(self,s): return self.tick
f=SDK();r=collect(f,cfg,now)
assert r['authenticated'] and r['positions']==[] and r['quote']['bid']==4000. and f.closed
assert cfg['password'] not in json.dumps(r) and '123456' not in json.dumps(r)
f=SDK();f.tick.time_msc=now-31000
assert collect(f,cfg,now)['quote'] is None
for prop,value,expected in [('login',999,'ACCOUNT_IDENTITY_MISMATCH'),('server','Exness-MT5Trial10','BROKER_SERVER_MISMATCH'),('trade_mode',2,'REAL_ACCOUNT_LOCKED'),('company','Other Broker','BROKER_IDENTITY_MISMATCH')]:
    f=SDK();setattr(f.account,prop,value)
    try: collect(f,cfg,now);raise AssertionError('unsafe')
    except ProbeError as e: assert str(e)==expected
    assert f.closed
try: collect(SDK(),{**cfg,'mode':'real'},now);raise AssertionError('unsafe')
except ProbeError as e: assert str(e)=='REAL_ACCOUNT_LOCKED'
print('PASS: synthetic SDK authentication, stale quote, identity, server, broker and real lock')
`;
  const r=spawnSync(process.platform==='win32'?'python':'python3',['-c',script],{input:JSON.stringify(config),encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/PASS: synthetic/);
});
