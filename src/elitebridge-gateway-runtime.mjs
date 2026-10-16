import {spawn} from 'node:child_process';
import {createHash,timingSafeEqual} from 'node:crypto';
import {validateGatewaySnapshot} from './elitebridge-gateway-snapshot.mjs';
import {resolveMt5ServerProfile} from './elitebridge-broker-server-profiles.mjs';

const failures=new Set(['REAL_ACCOUNT_LOCKED','LOGIN_INVALID','SERVER_MODE_MISMATCH','BINDING_INVALID',
  'CREDENTIAL_MISSING','SYMBOL_INVALID','TERMINAL_PATH_INVALID','AUTHENTICATION_OR_TERMINAL_UNAVAILABLE',
  'BROKER_DISCONNECTED','ACCOUNT_UNAVAILABLE','ACCOUNT_IDENTITY_MISMATCH','BROKER_SERVER_MISMATCH',
  'BROKER_IDENTITY_MISMATCH','ACCOUNT_CHANGED_DURING_SNAPSHOT','WINDOWS_PYTHON_REQUIRED_USE_WINE',
  'SDK_PACKAGE_UNAVAILABLE','SDK_CAPABILITY_MISSING','PYTHON_X64_REQUIRED','TERMINAL_BINARY_MISSING']);
const fatal=new Set(['REAL_ACCOUNT_LOCKED','ACCOUNT_IDENTITY_MISMATCH','BROKER_SERVER_MISMATCH',
  'BROKER_IDENTITY_MISMATCH','ACCOUNT_CHANGED_DURING_SNAPSHOT','WINDOWS_PYTHON_REQUIRED_USE_WINE']);
export function validateGatewayConfig(config) {
  const fail=()=>{throw Error('Invalid private DEMO gateway configuration');};
  if(!config||config.mode!=='demo'||config.broker!=='Exness'||
    typeof config.accountId!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(config.accountId)||
    typeof config.login!=='string'||!/^[1-9][0-9]{0,15}$/.test(config.login)||
    typeof config.password!=='string'||config.password.length<1||config.password.length>128||
    typeof config.symbol!=='string'||!/^[A-Za-z0-9._-]{3,30}$/.test(config.symbol)||
    typeof config.terminalPath!=='string'||!config.terminalPath.toLowerCase().endsWith('terminal64.exe')||
    typeof config.token!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(config.token))fail();
  resolveMt5ServerProfile(config);
  return config;
}

// The fixed, reviewed process runs Windows Python directly or under Wine. No
// shell, passwords in argv/env, remote command endpoint, or execution adapter.
export function sdkCollector({executable,args=[],config,timeoutMs=15000}) {
  validateGatewayConfig(config);
  // token is service-to-service only and is NEVER passed to MT5.
  const {token,...request}=config;
  return sdkProcess({executable,args,request,timeoutMs});
}

// Only paths, never credentials, are supplied to a runtime inspection. It
// imports the SDK and checks installed capabilities without initialize/login.
export async function inspectGatewayRuntime({executable,args=[],terminalPath,signal}) {
  if(typeof terminalPath!=='string'||!terminalPath.toLowerCase().endsWith('terminal64.exe'))
    throw Error('Terminal path required for runtime inspection');
  const result=await sdkProcess({executable,args:[...args,'--doctor'],request:{terminalPath},timeoutMs:20000})(signal);
  if(result?.mode!=='runtime-inspection'||result?.platform!=='win32'||result?.pointerBits!==64||
    result?.terminalPresent!==true||result?.brokerAuthenticated!==false||result?.tradingEnabled!==false||
    typeof result?.sdkVersion!=='string'||!/^\d{1,3}(\.\d{1,8}){1,3}$/.test(result.sdkVersion)||
    typeof result?.pythonVersion!=='string'||!/^3\.\d{1,3}\.\d{1,3}$/.test(result.pythonVersion))
    throw Error('Private runtime inspection rejected');
  return {mode:'runtime-inspection',platform:'win32',pointerBits:64,terminalPresent:true,
    sdkVersion:result.sdkVersion,pythonVersion:result.pythonVersion,
    brokerAuthenticated:false,tradingEnabled:false};
}

function sdkProcess({executable,args,request,timeoutMs}) {
  return async signal=>new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],
      env:Object.fromEntries(['PATH','HOME','WINEPREFIX','WINEDEBUG','DISPLAY','XAUTHORITY','LANG','SYSTEMROOT','TEMP']
        .filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))});
    let output='',settled=false,forcedError=null;
    const fail=code=>{forcedError=code;child.kill('SIGKILL');};
    const timer=setTimeout(()=>fail('SDK_TIMEOUT'),timeoutMs);
    const cancel=()=>fail('STOPPED');
    const finish=(code,data)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);
      code?reject(Object.assign(Error(code),{code})):resolve(data);
    };
    signal?.addEventListener('abort',cancel,{once:true});
    child.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>262144)fail('SDK_OUTPUT_LIMIT');});
    child.stdin.on('error',()=>{});
    child.on('error',()=>finish('SDK_RUNTIME_UNAVAILABLE'));
    child.on('close',exitCode=>{
      if(forcedError)return finish(forcedError);
      try{
        const data=JSON.parse(output);
        if(data.error)return finish(failures.has(data.error)?data.error:'SDK_COLLECTION_FAILED');
        if(exitCode!==0)return finish('SDK_COLLECTION_FAILED');
        finish(null,data);
      }catch{finish('SDK_COLLECTION_FAILED');}
    });
    if(signal?.aborted)cancel();else child.stdin.end(JSON.stringify(request));
  });
}

export function createGatewaySupervisor({config,collect,clock=Date.now,audit=()=>{}}) {
  validateGatewayConfig(config);
  let packet=null,state='not-configured',lastError=null,failuresCount=0,inflight=null;
  const cancellation=new AbortController();
  const status=()=>{
    let reportedState=state;
    if(state==='connected'){
      try{validateGatewaySnapshot(packet,config,clock);}catch{reportedState='stale';}
    }
    return {state:reportedState,lastError,failures:failuresCount,readOnly:true,tradingEnabled:false,
      lastBrokerVerification:packet?.observedAt||null,phoneProcessRequired:false};
  };
  const refresh=()=>{
    if(inflight)return inflight;
    if(state==='stopped'||state==='blocked')return Promise.resolve(status());
    state='authenticating';
    inflight=(async()=>{
      try{
        const next=await collect(cancellation.signal);
        if(cancellation.signal.aborted)return status();
        validateGatewaySnapshot(next,config,clock);
        packet=next;state='connected';lastError=null;failuresCount=0;
        audit({event:'elitebridge.gateway',state,code:'SNAPSHOT_ACCEPTED'});
      }catch(error){
        packet=null;
        if(cancellation.signal.aborted)return status();
        lastError=failures.has(error?.code)||['SDK_TIMEOUT','SDK_OUTPUT_LIMIT','SDK_RUNTIME_UNAVAILABLE'].includes(error?.code)?error.code:'SNAPSHOT_REJECTED';
        failuresCount++;
        state=fatal.has(lastError)||failuresCount>=8?'blocked':'interrupted';
        audit({event:'elitebridge.gateway',state,code:lastError});
      }finally{inflight=null;}
      return status();
    })();
    return inflight;
  };
  return {refresh,status,
    delay:()=>Math.min(60000,5000*2**Math.min(failuresCount,4)),
    snapshot(){
      if(!packet||state!=='connected')throw Error('Gateway not broker verified');
      // Revalidate age on EVERY read, even if the loop/host has stalled.
      validateGatewaySnapshot(packet,config,clock);
      return packet;
    },
    async stop(){state='stopped';packet=null;cancellation.abort();await inflight;}
  };
}

export function gatewayHttpHandler({config,supervisor,audit=()=>{}}) {
  const expected=createHash('sha256').update('Bearer '+config.token).digest();
  return (req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
    const provided=createHash('sha256').update(String(req.headers.authorization||'')).digest();
    if(!timingSafeEqual(expected,provided))return send(401,{error:'SERVICE_AUTH_REQUIRED'});
    // Only explicit read operations are available. No account import or orders.
    if(req.method!=='GET')return send(405,{error:'READ_ONLY_GATEWAY'});
    let url;
    try{url=new URL(req.url,'http://localhost');}catch{return send(400,{error:'INVALID_REQUEST'});}
    if(url.pathname==='/healthz')return send(200,supervisor.status());
    if(url.pathname!=='/snapshot')return send(404,{error:'NOT_FOUND'});
    if(url.searchParams.getAll('accountId').length!==1||url.searchParams.getAll('mode').length!==1||
      url.searchParams.get('accountId')!==config.accountId||url.searchParams.get('mode')!=='demo')
      return send(403,{error:'ACCOUNT_SCOPE_REJECTED'});
    try{
      const snapshot=supervisor.snapshot();
      audit({event:'elitebridge.gateway.read',code:'SNAPSHOT_READ'});
      return send(200,snapshot);
    }catch{return send(503,{error:'BROKER_SNAPSHOT_UNAVAILABLE',...supervisor.status()});}
  };
}
