// EliteBridge Phase 9: operational checks only. Never authorizes trading.
// Pure evaluator used by the Windows doctor and the offline Termux simulator.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYMBOL=/^[A-Za-z0-9._-]{3,30}$/;
const LOGIN=/^[1-9][0-9]{0,15}$/;
const SAFE_SERVER=/^[A-Za-z0-9][A-Za-z0-9 ._:-]{1,127}$/;
function version(value){
  const x=String(value||'').trim().match(/^(?:v|Python )?(\d+)\.(\d+)(?:\.(\d+))?/);
  return x?{major:Number(x[1]),minor:Number(x[2]),patch:Number(x[3]||0)}:null;
}
function check(id,passed,detail,required=true){
  return {id,passed:passed===true,detail,required};
}
export function assessWindowsBridgeReadiness(input={}){
  const mode=input.mode;
  const ver=version(input.nodeVersion);
  const py=version(input.pythonVersion);
  const checks=[
    check('windows-x64',input.platform==='win32'&&input.arch==='x64',
      'Windows x64 (remote desktop is optional; native MT5 terminal is required)'),
    check('node24',!!ver&&ver.major===24&&ver.minor>=12,
      'Node.js 24.12+; the publisher is constrained to major v24'),
    check('python64',!!py&&(py.major>3||(py.major===3&&py.minor>=11))&&input.pythonBits===64,
      '64-bit Python 3.11+ available locally'),
    check('mt5-sdk',input.mt5SdkAvailable===true,
      'Official MetaTrader5 Python SDK installed on Windows'),
    check('account-mode',mode==='demo'||mode==='real',
      'Explicit DEMO or REAL observation mode (not trading authorization)'),
    check('broker-login',typeof input.expectedLogin==='string'&&LOGIN.test(input.expectedLogin),
      'Expected MT5 login ID set locally; no password required'),
    check('broker-server',typeof input.expectedServer==='string'&&
      SAFE_SERVER.test(input.expectedServer)&&input.expectedServer.trim()===input.expectedServer,
      'Expected broker server set locally; exact match required'),
    check('market-symbol',typeof input.symbol==='string'&&SYMBOL.test(input.symbol),
      'Broker instrument symbol validated'),
    check('cloud-account-uuid',typeof input.accountId==='string'&&UUID.test(input.accountId),
      'Owner-scoped EliteTrade MT5 account UUID configured'),
    check('approved-terminal-uuid',typeof input.terminalId==='string'&&UUID.test(input.terminalId),
      'Approved signed terminal registration UUID configured'),
    check('terminal-private-identity',input.localIdentityReady===true,
      'Private Ed25519 key and sequence identity marker exist on Windows host'),
    check('terminal-approved',input.terminalApproved===true,
      'Admin approval must be independently checked through trusted server',false),
    check('broker-readonly-probe',input.probeVerified===true,
      'Expected account and fresh quote observed by read-only local MT5 probe',false),
    check('cloud-receipt',input.cloudReceiptVerified===true,
      'Signed telemetry accepted by approved backend; no connection guarantee',false)
  ];
  const baseReady=checks.filter(x=>x.required).every(x=>x.passed);
  const state=!baseReady?'blocked':input.probeVerified!==true?
    'ready-for-local-probe':input.terminalApproved!==true?
      'awaiting-explicit-approval':input.cloudReceiptVerified!==true?
        'ready-for-test-publish':'read-only-observations-received';
  // Do NOT derive independently broker-verified or broker trade permission
  // from terminal attestation, local MT5 API or the cloud acknowledgment.
  return {phase:9,state,readyForLocalProbe:baseReady,accountMode:mode==='real'?'real':
    mode==='demo'?'demo':null,checks,
    readOnly:true,brokerVerified:false,ordersEnabled:false,realOrdersEnabled:false,
    message:baseReady?
      'Host preflight passed. This is not independent broker verification or approval for order execution.':
      'Host provisioning or identity pairing is incomplete. No broker data transmitted.'};
}
export function formatWindowsBridgeReadiness(result){
  if(!result||!Array.isArray(result.checks))throw Error('Invalid readiness report');
  const lines=[
    'ELITEBRIDGE WINDOWS READINESS · PHASE 9',
    'STATE: '+result.state.toUpperCase(),
    ...result.checks.map(x=>(x.passed?'PASS':'WAIT')+' '+x.id+' - '+x.detail+
      (x.required?'':' [verification step]')),
    'BROKER VERIFIED: NO · REAL ORDERS: DISABLED · METAAPI: UNCHANGED'
  ];
  return lines.join('\n');
}
