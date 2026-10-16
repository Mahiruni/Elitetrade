// Synthetic tests; no Wine, MT5 installation, broker login, or order submission.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectGatewayRuntime} from '../src/elitebridge-gateway-runtime.mjs';

const report={mode:'runtime-inspection',platform:'win32',pointerBits:64,
  terminalPresent:true,sdkVersion:'5.0.5000',pythonVersion:'3.12.10',
  brokerAuthenticated:false,tradingEnabled:false};
const terminalPath='C:\\MT5\\terminal64.exe';
const launcher=data=>['--input-type=module','-e',`let raw='';for await(const c of process.stdin)raw+=c;const r=JSON.parse(raw);if(Object.keys(r).join(',')!=='terminalPath'||process.argv.at(-1)!=='--doctor')process.exit(7);console.log(JSON.stringify(${JSON.stringify(data)}));`,'--'];

test('runtime doctor sends only terminal path and strips arbitrary returned fields',async()=>{
  const result=await inspectGatewayRuntime({executable:process.execPath,
    args:launcher({...report,password:'must-not-return',accountId:'must-not-return'}),terminalPath});
  assert.deepEqual(result,report);
  assert.equal(result.brokerAuthenticated,false);
});
test('runtime doctor rejects missing terminal, incorrect interpreter and false authentication',async()=>{
  for(const delta of [{terminalPresent:false},{platform:'linux'},{pointerBits:32},
    {brokerAuthenticated:true},{tradingEnabled:true},{sdkVersion:'secret arbitrary text'},
    {pythonVersion:'invalid'}]){
    await assert.rejects(inspectGatewayRuntime({executable:process.execPath,args:launcher({...report,...delta}),terminalPath}),/inspection rejected/);
  }
});
test('standalone doctor needs no vault, password, account or service token',()=>{
  const directory=mkdtempSync(join(tmpdir(),'elitebridge-doctor-'));
  try{
    const fixture=join(directory,'fixture.mjs');
    writeFileSync(fixture,`let raw='';for await(const c of process.stdin)raw+=c;const r=JSON.parse(raw);if(Object.keys(r).join(',')!=='terminalPath')process.exit(7);console.log(JSON.stringify(${JSON.stringify(report)}));`);
    const result=spawnSync(process.execPath,['scripts/elitebridge-cloud-gateway.mjs','doctor'],{
      encoding:'utf8',timeout:10000,
      env:{PATH:process.env.PATH,ELITEBRIDGE_GATEWAY_EXECUTABLE:process.execPath,
        ELITEBRIDGE_GATEWAY_ARGS:JSON.stringify([fixture]),ELITEBRIDGE_GATEWAY_TERMINAL_PATH:terminalPath}
    });
    assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),report);
  }finally{rmSync(directory,{recursive:true,force:true});}
});
test('standalone doctor fails closed and excludes arbitrary launcher stderr',()=>{
  const result=spawnSync(process.execPath,['scripts/elitebridge-cloud-gateway.mjs','doctor'],{
    encoding:'utf8',timeout:10000,
    env:{PATH:process.env.PATH,ELITEBRIDGE_GATEWAY_EXECUTABLE:process.execPath,
      ELITEBRIDGE_GATEWAY_ARGS:JSON.stringify(['-e','console.error("private-detail");console.log(JSON.stringify({error:"SDK_PACKAGE_UNAVAILABLE"}));process.exitCode=1','--']),
      ELITEBRIDGE_GATEWAY_TERMINAL_PATH:terminalPath}
  });
  assert.equal(result.status,1);assert.equal(result.stdout,'');
  const r=JSON.parse(result.stderr);assert.equal(r.code,'SDK_PACKAGE_UNAVAILABLE');
  assert.equal(r.brokerAuthenticated,false);assert.ok(!result.stderr.includes('private-detail'));
});
test('Python runtime inspection never invokes initialize, login or account readers',()=>{
  const code=String.raw`
import sys, tempfile, pathlib
sys.path.insert(0, 'companion')
import mt5_cloud_gateway as gateway
class FakeSDK:
    __version__='5.0.5000'
    def forbidden(self,*args,**kwargs): raise AssertionError('SDK function invoked by doctor')
    initialize=shutdown=terminal_info=account_info=positions_get=symbol_select=symbol_info_tick=forbidden
original=sys.platform
try:
    sys.platform='win32'
    with tempfile.TemporaryDirectory() as d:
        path=pathlib.Path(d)/'terminal64.exe';path.write_bytes(b'synthetic only')
        r=gateway.inspect_runtime(FakeSDK(),str(path))
        assert r['brokerAuthenticated'] is False and r['tradingEnabled'] is False
        assert r['terminalPresent'] is True
        path.unlink()
        try: gateway.inspect_runtime(FakeSDK(),str(path));raise AssertionError('missing terminal accepted')
        except gateway.ProbeError as error: assert str(error)=='TERMINAL_BINARY_MISSING'
finally: sys.platform=original
print('PASS synthetic runtime inspection; zero SDK calls')
`;
  const result=spawnSync(process.platform==='win32'?'python':'python3',['-c',code],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/zero SDK calls/);
});
