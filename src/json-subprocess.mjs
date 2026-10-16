import {spawn} from 'node:child_process';

// One JSON line, then successful process exit. Descendants (notably Wine's
// helper processes) may retain stdout after the SDK process itself has exited.
// Neither success nor a deadline may depend on every descendant closing a pipe.
export function runJsonSubprocess({executable,args,env,request,timeoutMs,
  maxBytes=262144,signal,allowErrorResult=false}){
  if(signal?.aborted)return Promise.reject(Object.assign(Error('Child cancelled'),{code:'STOPPED'}));
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore'],env});
    let output='',settled=false,exited=false,exitCode=null,ended=false;
    const finish=(code,value)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      child.stdout.destroy();
      if(code){child.kill('SIGKILL');reject(Object.assign(Error('Child JSON request failed'),{code}));}
      else resolve(value);
    };
    const abort=()=>finish('STOPPED');
    const timer=setTimeout(()=>finish('SDK_TIMEOUT'),timeoutMs);
    const accept=()=>{
      if(!exited)return;
      if(exitCode!==0&&!allowErrorResult)return finish('SDK_COLLECTION_FAILED');
      if(!output.includes('\n')&&!ended)return;
      try{
        const data=JSON.parse(output);
        if(exitCode!==0&&typeof data?.error!=='string')return finish('SDK_COLLECTION_FAILED');
        finish(null,data);
      }catch{finish('SDK_COLLECTION_FAILED');}
    };
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.on('data',chunk=>{
      output+=chunk.toString('utf8');
      if(Buffer.byteLength(output,'utf8')>maxBytes)return finish('SDK_OUTPUT_LIMIT');
      accept();
    });
    child.stdout.on('end',()=>{ended=true;accept();});
    child.stdout.on('error',()=>finish('SDK_COLLECTION_FAILED'));
    child.stdin.on('error',()=>{});
    child.once('error',()=>finish('SDK_RUNTIME_UNAVAILABLE'));
    child.once('exit',code=>{exited=true;exitCode=code;accept();});
    child.once('close',code=>{if(!settled){exited=true;exitCode=code;ended=true;accept();}});
    child.stdin.end(request===undefined?undefined:JSON.stringify(request));
  });
}
