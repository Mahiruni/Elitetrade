// A bounded, sequential read-only publisher supervisor. No queue of old quotes
// and no packet retry: publish() must collect anew and reserve new sequences.
import {setTimeout as pause} from 'node:timers/promises';
import {openSync,closeSync,unlinkSync,lstatSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';

export const DEFAULT_PUBLISH_INTERVAL_MS=15000;
export const MAX_CONSECUTIVE_FAILURES=8;
const TRANSIENT_PROBE_CODES=new Set(['TERMINAL_UNAVAILABLE','TERMINAL_OR_ACCOUNT_MISSING',
  'TERMINAL_DISCONNECTED','QUOTE_UNAVAILABLE','QUOTE_STALE_OR_FUTURE']);
export function retryableProbeFailure(child){
  // Exact allowlist only. An identity/mode mismatch is operator-action-required.
  return !child?.error&&child?.status===2&&typeof child.stderr==='string'&&
    TRANSIENT_PROBE_CODES.has(child.stderr.trim());
}

export function acquireTerminalWatchLock(directory){
  if(typeof directory!=='string'||!isAbsolute(directory))throw Error('Absolute identity directory required.');
  const stat=lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Local identity directory required.');
  const path=join(directory,'watch.lock');
  let fd;
  try{fd=openSync(path,'wx',0o600);}
  catch{throw Error('Terminal watch locked. Inspect the existing process before removing a stale lock.');}
  let released=false;
  return ()=>{
    if(released)return;
    released=true;
    closeSync(fd);unlinkSync(path);
  };
}

export function telemetryRetryDelay(failures,{intervalMs=DEFAULT_PUBLISH_INTERVAL_MS,random=Math.random}={}){
  const jitter=random();
  if(!Number.isSafeInteger(failures)||failures<1||!Number.isFinite(jitter)||jitter<0||jitter>=1)
    throw Error('Invalid retry policy input.');
  return Math.min(300000,Math.round(Math.min(300000,intervalMs*2**Math.min(failures-1,8))*(.8+.4*jitter)));
}

export async function superviseTerminalTelemetry({publish,signal,
  intervalMs=DEFAULT_PUBLISH_INTERVAL_MS,maxFailures=MAX_CONSECUTIVE_FAILURES,
  maxCycles=Infinity,wait=(ms,s)=>pause(ms,undefined,{signal:s}),
  random=Math.random,onStatus=()=>{}}={}){
  if(typeof publish!=='function'||!Number.isSafeInteger(intervalMs)||intervalMs<10000||intervalMs>300000||
     !Number.isSafeInteger(maxFailures)||maxFailures<1||maxFailures>20||
     !(maxCycles===Infinity||(Number.isSafeInteger(maxCycles)&&maxCycles>=1)))
    throw Error('Invalid telemetry supervisor configuration.');
  let cycles=0,consecutiveFailures=0,acceptedCycles=0;
  const report=(state,extra={})=>onStatus({state,cycles,acceptedCycles,consecutiveFailures,
    readOnly:true,brokerVerified:false,ordersEnabled:false,...extra});
  while(!signal?.aborted && cycles<maxCycles){
    cycles++;
    let delay=intervalMs;
    try{
      // No overlap and no unbounded buffer. Result contains only a completion
      // marker; never forward raw child output, credentials or quote values.
      const result=await publish({signal});
      if(signal?.aborted)break;
      if(result?.accepted!==true)throw Object.assign(Error('Publisher did not confirm delivery.'),{retryable:false});
      consecutiveFailures=0;acceptedCycles++;
      report('receipts-confirmed');
    }catch(error){
      if(signal?.aborted)break;
      consecutiveFailures++;
      if(error?.retryable!==true||consecutiveFailures>=maxFailures){
        report('blocked',{reason:error?.retryable===true?'retry-budget-exhausted':'operator-action-required'});
        return {state:'blocked',cycles,acceptedCycles,consecutiveFailures};
      }
      delay=telemetryRetryDelay(consecutiveFailures,{intervalMs,random});
      report('backoff',{retryInMs:delay});
    }
    if(cycles>=maxCycles)break;
    try{await wait(delay,signal);}catch(error){if(!signal?.aborted)throw error;}
  }
  report('stopped');
  return {state:'stopped',cycles,acceptedCycles,consecutiveFailures};
}
