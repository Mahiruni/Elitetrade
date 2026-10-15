#!/usr/bin/env node
// Android Termux demonstration: synthetic host fixtures. No network or broker.
import {assessWindowsBridgeReadiness,formatWindowsBridgeReadiness} from '../src/elitebridge-windows-readiness.mjs';
import {randomUUID} from 'node:crypto';
const fields={
  platform:'win32',arch:'x64',nodeVersion:'v24.12.0',pythonVersion:'3.13.6',
  pythonBits:64,mt5SdkAvailable:true,mode:'real',
  expectedLogin:'12345678',expectedServer:'Broker-MT5Live',
  symbol:'XAUUSDm',accountId:randomUUID(),terminalId:randomUUID(),
  localIdentityReady:true,
  terminalApproved:false,probeVerified:false,cloudReceiptVerified:false
};
const scenarios=[
  {label:'Android before VPS provisioning',fields:{...fields,platform:'android',arch:'arm64'},state:'blocked'},
  {label:'Windows provisioning incomplete',fields:{...fields,mt5SdkAvailable:false},state:'blocked'},
  {label:'Windows ready for MT5 probe',fields,state:'ready-for-local-probe'},
  {label:'Broker probe verified locally',fields:{...fields,probeVerified:true},state:'awaiting-explicit-approval'},
  {label:'Awaiting signed cloud receipt',fields:{...fields,probeVerified:true,terminalApproved:true},state:'ready-for-test-publish'},
  {label:'Cloud telemetry observed',fields:{...fields,probeVerified:true,terminalApproved:true,cloudReceiptVerified:true},state:'read-only-observations-received'}
];
for(const {label,fields:input,state} of scenarios){
  const r=assessWindowsBridgeReadiness(input);
  if(r.state!==state||r.ordersEnabled||r.realOrdersEnabled||r.brokerVerified||
      !r.readOnly)throw Error('Unsafe Windows preflight scenario: '+label);
  console.log('PASS: '+label+' => '+state);
}
const summary=formatWindowsBridgeReadiness(assessWindowsBridgeReadiness(fields));
if(!summary.includes('REAL ORDERS: DISABLED'))throw Error('Disabled-orders banner missing');
console.log('PASS: 6 simulated states; REAL and DEMO never gain order authority.');
console.log('SYNTHETIC WINDOWS FIXTURES ONLY. NO VPS, BROKER CONNECTION OR TRADES.');
