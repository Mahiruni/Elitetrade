#!/usr/bin/env node
// Phase 9. No network, MT5 login, trade execution, or key generation.
// Optional --probe launches ONLY the existing read-only Python broker probe.
import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessWindowsBridgeReadiness,formatWindowsBridgeReadiness} from '../src/elitebridge-windows-readiness.mjs';
import {validateTerminalObservation} from '../src/elitebridge-terminal-uplink.mjs';

function pythonDetails(){
  const result=spawnSync('python',['-c',
    'import json,struct,sys,importlib.util;print(json.dumps({"version":".".join(map(str,sys.version_info[:3])),"bits":struct.calcsize("P")*8,"sdk":importlib.util.find_spec("MetaTrader5") is not None}))'],{
    encoding:'utf8',timeout:6000,maxBuffer:2048,windowsHide:true,shell:false
  });
  if(result.status!==0||result.error)return {};
  try{
    const details=JSON.parse(result.stdout);
    return {pythonVersion:details.version,pythonBits:details.bits,
      mt5SdkAvailable:details.sdk===true};
  }catch{return {};}
}
function localIdentityPresent(){
  const home=process.env.ELITEBRIDGE_LOCAL_HOME ||
    join(homedir(),'.elitetrade','bridge-terminal');
  try{
    return ['private.pem','identity-state.json'].every(filename=>{
      const p=join(home,filename);
      return existsSync(p)&&lstatSync(p).isFile()&&!lstatSync(p).isSymbolicLink();
    });
  }catch{return false;}
}
function readOnlyProbe(){
  const path=fileURLToPath(new URL('../companion/mt5_readonly_probe.py',import.meta.url));
  const result=spawnSync('python',[path],{
    encoding:'utf8',timeout:25000,maxBuffer:4096,shell:false,windowsHide:true,
    env:process.env
  });
  if(result.status!==0 || result.error)return false;
  try{
    const snapshot=JSON.parse(result.stdout);
    validateTerminalObservation(snapshot,{
      mode:process.env.ELITEBRIDGE_MT5_EXPECT_MODE,nowMs:Date.now()
    });
    return true;
  }catch{return false;}
}
function main(){
  const options=process.argv.slice(2);
  if(options.length>1 || options.some(v=>v!=='--probe'))
    throw Error('Supported usage: npm run bridge:windows:check [-- --probe]');
  const python=pythonDetails();
  const input={
    platform:process.platform,arch:process.arch,nodeVersion:process.version,...python,
    mode:process.env.ELITEBRIDGE_MT5_EXPECT_MODE,
    expectedLogin:process.env.ELITEBRIDGE_MT5_EXPECT_LOGIN,
    expectedServer:process.env.ELITEBRIDGE_MT5_EXPECT_SERVER,
    symbol:process.env.ELITEBRIDGE_MT5_SYMBOL||'XAUUSDm',
    accountId:process.env.ELITEBRIDGE_ACCOUNT_ID,
    terminalId:process.env.ELITEBRIDGE_TERMINAL_ID,
    localIdentityReady:localIdentityPresent(),
    terminalApproved:false,cloudReceiptVerified:false,probeVerified:false
  };
  let report=assessWindowsBridgeReadiness(input);
  // --probe explicitly reaches a local terminal only after host setup
  // passes. It DOES NOT publish telemetry or authorize order execution.
  if(options.includes('--probe') && report.readyForLocalProbe){
    input.probeVerified=readOnlyProbe();
    report=assessWindowsBridgeReadiness(input);
  }
  console.log(formatWindowsBridgeReadiness(report));
  if(!report.readyForLocalProbe || (options.includes('--probe')&&!input.probeVerified))
    process.exitCode=2;
}
try{main();}catch(e){
  // Never leak credentials, private keys, broker login or HTTP tokens in CLI errors.
  console.error('ELITEBRIDGE PREFLIGHT: Invalid option or unavailable local checks.');
  process.exitCode=2;
}
