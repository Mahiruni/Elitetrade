#!/usr/bin/env node
// Termux-safe operator sidecar. No .env, API keys, broker logins or execution.
import {setTimeout as sleep} from 'node:timers/promises';
import {checkEliteBridgeCloud,formatTermuxCloudHealth,termuxMonitorReadiness,
  DEFAULT_WATCH_INTERVAL_MS} from '../src/elitebridge-termux-monitor.mjs';

const mode=process.argv[2]||'once';
if(!['once','watch'].includes(mode) || process.argv.length>3){
  console.error('Usage: node scripts/elitebridge-termux-monitor.mjs [once|watch]');
  process.exitCode=2;
}else{
  const readiness=termuxMonitorReadiness();
  console.log('ELITEBRIDGE / TERMUX / READ-ONLY');
  console.log(readiness.message);
  console.log('No credentials needed. The app\'s current MetaApi and Windows bridge are unchanged.');
  if(!readiness.runtimeReady){
    process.exitCode=2;
  }else if(mode==='once'){
    const state=await checkEliteBridgeCloud();
    console.log(formatTermuxCloudHealth(state));
    if(!state.httpOk)process.exitCode=1;
  }else{
    const controller=new AbortController();
    const stop=()=>controller.abort();
    process.once('SIGINT',stop);
    process.once('SIGTERM',stop);
    console.log('Checking public HTTPS availability every 60 seconds. Ctrl+C to stop.');
    let previous,checks=0;
    try{
      while(!controller.signal.aborted){
        const state=await checkEliteBridgeCloud();
        checks++;
        if(state.cloudState!==previous || checks%5===0)
          console.log(new Date().toISOString()+' '+formatTermuxCloudHealth(state));
        previous=state.cloudState;
        try{await sleep(DEFAULT_WATCH_INTERVAL_MS,undefined,{signal:controller.signal});}
        catch(error){if(error?.name!=='AbortError')throw error;}
      }
    }finally{
      process.removeListener('SIGINT',stop);
      process.removeListener('SIGTERM',stop);
      console.log('Termux health monitor stopped. Broker trading was never started.');
    }
  }
}
