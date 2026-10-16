import {createServer} from 'node:http';
import {spawn} from 'node:child_process';

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
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{shell:false,stdio:['ignore','pipe','ignore'],
      env:Object.fromEntries(['PATH','HOME','WINEPREFIX','WINEDEBUG','WINEDLLOVERRIDES','DISPLAY','XAUTHORITY','LANG']
        .filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]))});
    let output='',forced=false,done=false;
    const abort=()=>{forced=true;child.kill('SIGKILL');};
    const timer=setTimeout(abort,timeoutMs);
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      error?reject(Error('SDK_COMPATIBILITY_FAILED')):resolve(value);};
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.stdout.on('data',part=>{output+=part;if(output.length>8192)abort();});
    child.on('error',()=>finish(true));
    child.on('close',code=>{
      if(forced||code!==0)return finish(true);
      try{finish(false,validateSdkCompatibility(JSON.parse(output)));}catch{finish(true);}
    });
  });
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
