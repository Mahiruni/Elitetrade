import {createServer} from 'node:http';
import {runJsonSubprocess} from './json-subprocess.mjs';

const version=value=>typeof value==='string'&&/^\d{1,3}(\.\d{1,8}){1,3}$/.test(value);
export function validateSdkCompatibility(data){
  if(data?.platform!=='win32'||data.pointerBits!==64||data.sdkImportable!==true||
    data.terminalPresent!==false||data.brokerAuthenticated!==false||data.executionEnabled!==false||
    !version(data.pythonVersion)||!version(data.sdkVersion)||!version(data.numpyVersion))
    throw Error('SDK compatibility result rejected');
  return {platform:'win32',pointerBits:64,pythonVersion:data.pythonVersion,
    sdkVersion:data.sdkVersion,numpyVersion:data.numpyVersion,sdkImportable:true,
    terminalPresent:false,brokerAuthenticated:false,executionEnabled:false};
}

export function probeSdkCompatibility({signal,executable='/usr/bin/wine',
  args=['/opt/winpython/python.exe','Z:\\opt\\elitetrade\\companion\\mt5_sdk_compatibility.py'],timeoutMs=90000}={}){
  return runJsonSubprocess({executable,args,timeoutMs,maxBytes:8192,signal,
    env:Object.fromEntries(['PATH','HOME','WINEPREFIX','WINEDEBUG','WINEDLLOVERRIDES','DISPLAY','XAUTHORITY','LANG']
      .filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))})
    .then(validateSdkCompatibility).catch(()=>{throw Error('SDK_COMPATIBILITY_FAILED');});
}

export function createEliteEngineProRuntime({probe=probeSdkCompatibility,audit=()=>{}}={}){
  let state='checking-sdk',details=null,closed=false;
  const cancellation=new AbortController();
  const status=()=>({service:'EliteEnginePro',mode:'compatibility',state,
    sdkCompatibility:state==='sdk-compatible'?'passed':state==='blocked'?'failed':'pending',
    terminalPresent:false,brokerAuthenticated:false,executionEnabled:false,
    persistenceVerified:false,phoneProcessRequired:false});
  const server=createServer((req,res)=>{
    let url;
    try{url=new URL(req.url,'http://localhost');}catch{
      res.writeHead(400,{'Content-Type':'application/json','Cache-Control':'no-store'});
      res.end(JSON.stringify({error:'INVALID_REQUEST'}));return;
    }
    const health=req.method==='GET'&&['/','/health','/healthz'].includes(url.pathname);
    res.writeHead(health?200:404,{'Content-Type':'application/json','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(health?status():{error:'COMPATIBILITY_ONLY_NO_BROKER_GATEWAY',
      brokerAuthenticated:false,executionEnabled:false}));
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.maxHeadersCount=20;
  let check;
  return {server,status,
    start(){
      if(check)return check;
      check=(async()=>{
        try{details=validateSdkCompatibility(await probe({signal:cancellation.signal}));
          if(closed)return status();state='sdk-compatible';
          audit({event:'eliteenginepro.compatibility',state,...details});
        }catch{if(closed)return status();state='blocked';
          audit({event:'eliteenginepro.compatibility',state,code:'SDK_COMPATIBILITY_FAILED'});}
        return status();
      })();return check;
    },
    async close(){closed=true;state='stopped';cancellation.abort();await check;
      await new Promise(r=>server.listening?server.close(r):r());}
  };
}
