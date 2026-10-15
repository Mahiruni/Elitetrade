import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {assessWindowsBridgeReadiness,formatWindowsBridgeReadiness}
  from '../src/elitebridge-windows-readiness.mjs';

function config(overrides={}){
  return {
    platform:'win32',arch:'x64',nodeVersion:'v24.12.0',pythonVersion:'Python 3.11.9',
    pythonBits:64,mt5SdkAvailable:true,mode:'demo',expectedLogin:'123456',
    expectedServer:'MT5-Broker Demo',symbol:'XAUUSDm',accountId:randomUUID(),
    terminalId:randomUUID(),localIdentityReady:true,
    terminalApproved:false,probeVerified:false,cloudReceiptVerified:false,
    ...overrides
  };
}
test('Windows preflight has no falsely broker-verified or order-enabled state',()=>{
  for(const mode of ['demo','real']){
    for(const flags of [
      {},{probeVerified:true},{probeVerified:true,terminalApproved:true},
      {probeVerified:true,terminalApproved:true,cloudReceiptVerified:true}
    ]){
      const r=assessWindowsBridgeReadiness(config({...flags,mode}));
      assert.equal(r.brokerVerified,false);
      assert.equal(r.ordersEnabled,false);
      assert.equal(r.realOrdersEnabled,false);
      assert.equal(r.readOnly,true);
      assert.equal(r.accountMode,mode);
      assert.ok(r.checks.every(x=>typeof x.passed==='boolean'));
      assert.match(formatWindowsBridgeReadiness(r),/REAL ORDERS: DISABLED/);
    }
  }
});
test('missing or unapproved Windows host prerequisites block real and demo MT5 preflight',()=>{
  const incomplete=[
    [{platform:'android',arch:'arm64'},'windows-x64'],
    [{platform:'linux'},'windows-x64'],
    [{arch:'ia32'},'windows-x64'],
    [{nodeVersion:'v22.0.0'},'node24'],
    [{nodeVersion:'v25.0.0'},'node24'],
    [{pythonVersion:'3.10.9'},'python64'],
    [{pythonBits:32},'python64'],
    [{mt5SdkAvailable:false},'mt5-sdk'],
    [{mode:'contest'},'account-mode'],
    [{expectedLogin:'demo-account'},'broker-login'],
    [{expectedServer:'bad\ninjected'},'broker-server'],
    [{symbol:'XAUUSD;exec'},'market-symbol'],
    [{accountId:'invalid'},'cloud-account-uuid'],
    [{terminalId:''},'approved-terminal-uuid'],
    [{localIdentityReady:false},'terminal-private-identity']
  ];
  for(const [change,id] of incomplete){
    const r=assessWindowsBridgeReadiness(config(change));
    assert.equal(r.state,'blocked',id);
    assert.equal(r.readyForLocalProbe,false,id);
    assert.equal(r.checks.find(x=>x.id===id)?.passed,false,id);
    assert.equal(r.ordersEnabled,false);
  }
});
test('readiness stages never substitute cloud receipt for admin approval',()=>{
  const ready=assessWindowsBridgeReadiness(config());
  assert.equal(ready.state,'ready-for-local-probe');
  assert.equal(assessWindowsBridgeReadiness(config({probeVerified:true})).state,
    'awaiting-explicit-approval');
  assert.equal(assessWindowsBridgeReadiness(config({
    probeVerified:true,terminalApproved:true
  })).state,'ready-for-test-publish');
  assert.equal(assessWindowsBridgeReadiness(config({
    probeVerified:true,terminalApproved:true,cloudReceiptVerified:true
  })).state,'read-only-observations-received');
});
test('Termux simulator runs without Windows, network, account or trade credentials',()=>{
  const r=spawnSync(process.execPath,['scripts/elitebridge-windows-sandbox.mjs'],
    {encoding:'utf8',timeout:8000});
  assert.equal(r.status,0,r.stderr);
  assert.match(r.stdout,/PASS: 6 simulated states/);
  assert.match(r.stdout,/NO VPS, BROKER CONNECTION OR TRADES/);
});
test('doctor is fail-closed on Android and never prints secrets or attempts a broker login',()=>{
  const env={...process.env,
    ELITEBRIDGE_MT5_EXPECT_LOGIN:'123456',
    ELITEBRIDGE_MT5_EXPECT_SERVER:'Broker-Windows',
    ELITEBRIDGE_MT5_EXPECT_MODE:'real',
    ELITEBRIDGE_ACCOUNT_ID:randomUUID(),ELITEBRIDGE_TERMINAL_ID:randomUUID(),
    ELITEBRIDGE_SECRET_TEST:'do-not-leak-me'
  };
  const r=spawnSync(process.execPath,['scripts/elitebridge-windows-doctor.mjs'],
    {encoding:'utf8',env,timeout:10000});
  if(process.platform!=='win32'){
    assert.equal(r.status,2);
    assert.match(r.stdout,/WAIT windows-x64/);
    assert.match(r.stdout,/BROKER VERIFIED: NO/);
  }
  assert.doesNotMatch(r.stdout+r.stderr,/do-not-leak-me|123456|Broker-Windows/);
  const unsafe=spawnSync(process.execPath,['scripts/elitebridge-windows-doctor.mjs','--execute-orders'],
    {encoding:'utf8',env,timeout:10000});
  assert.equal(unsafe.status,2);
  assert.doesNotMatch(unsafe.stdout+unsafe.stderr,/do-not-leak-me/);
  const script=readFileSync(new URL('../scripts/elitebridge-windows-doctor.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(script,/order_send\s*\(|realOrder\s*\(|demoOrder\s*\(/);
  assert.doesNotMatch(script,/https?:\/\/.*api\/elitebridge\/telemetry/);
});
