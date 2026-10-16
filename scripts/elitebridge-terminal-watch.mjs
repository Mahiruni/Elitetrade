#!/usr/bin/env node
// Runs ONLY on an already configured Windows x64 MT5 host. Android remains
// the control surface. Every child invokes the existing read-only publisher.
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireTerminalWatchLock,superviseTerminalTelemetry} from '../src/elitebridge-supervisor.mjs';
import {checkedTelemetryEndpoint} from '../src/elitebridge-terminal-uplink.mjs';

const stop=new AbortController();
const onStop=()=>stop.abort();
async function main(){
  if(process.platform!=='win32'||process.arch!=='x64')
    throw Error('Windows x64 MT5 host required. Termux can monitor cloud availability only.');
  if(!['demo','real'].includes(process.env.ELITEBRIDGE_MT5_EXPECT_MODE)||
     !process.env.ELITEBRIDGE_MT5_EXPECT_LOGIN||!process.env.ELITEBRIDGE_MT5_EXPECT_SERVER||
     !process.env.ELITEBRIDGE_ACCOUNT_ID||!process.env.ELITEBRIDGE_TERMINAL_ID)
    throw Error('Configure the expected MT5 identity and approved account/terminal IDs first.');
  checkedTelemetryEndpoint(process.env.ELITEBRIDGE_TELEMETRY_URL||
    'https://elitetradee.vercel.app/api/elitebridge/telemetry');
  const intervalMs=process.env.ELITEBRIDGE_PUBLISH_INTERVAL_MS===undefined?15000:
    Number(process.env.ELITEBRIDGE_PUBLISH_INTERVAL_MS);
  const directory=process.env.ELITEBRIDGE_LOCAL_HOME||join(homedir(),'.elitetrade','bridge-terminal');
  const release=acquireTerminalWatchLock(directory);
  process.on('SIGINT',onStop);process.on('SIGTERM',onStop);
  try{
    const script=fileURLToPath(new URL('./elitebridge-terminal-uplink.mjs',import.meta.url));
    const result=await superviseTerminalTelemetry({signal:stop.signal,intervalMs,
      publish:({signal})=>new Promise((resolve,reject)=>{
        let child;
        try{child=spawn(process.execPath,[script,'publish'],{
          stdio:'ignore',shell:false,windowsHide:true,signal,timeout:50000
        });}catch{reject(Object.assign(Error('Publisher unavailable.'),{retryable:false}));return;}
        // 'close' follows 'error' and waits for child termination. Do not start
        // a new cycle or release the lifetime lock before the child is gone.
        let failed=false;
        child.on('error',()=>{failed=true;});
        child.on('close',code=>{
          if(!failed&&code===0)resolve({accepted:true});
          else reject(Object.assign(Error('Read-only publisher incomplete.'),{retryable:!failed&&code===75}));
        });
      }),
      onStatus:s=>console.log(JSON.stringify({...s,checkedAt:new Date().toISOString()}))
    });
    if(result.state==='blocked')process.exitCode=2;
  }finally{
    process.off('SIGINT',onStop);process.off('SIGTERM',onStop);release();
  }
}
main().catch(()=>{
  // Do not relay child output or environment values to service logs.
  console.error('EliteBridge watch unavailable. Check Windows host, local identity, configuration and lock. Orders remain disabled.');
  process.exitCode=2;
});
