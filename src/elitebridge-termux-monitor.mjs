// Safe phone-side EliteBridge availability observation.
// Does not need credentials, account IDs or database access.
// IMPORTANT: HTTP health != broker connectivity, active positions or trade authority.
export const BRIDGE_HEALTH_URL = 'https://elitetradee.vercel.app/health';
export const MIN_WATCH_INTERVAL_MS = 30000;
export const DEFAULT_WATCH_INTERVAL_MS = 60000;

export function termuxMonitorReadiness({platform=process.platform,nodeVersion=process.versions.node}={}) {
  const [major,minor]=String(nodeVersion).replace(/^v/,'').split('.').map(Number);
  const supportedNode=Number.isInteger(major) && (major>20 || (major===20&&minor>=0));
  return {
    runtimeReady:supportedNode,
    isAndroid:platform==='android'||platform==='linux',
    canMonitorCloud:supportedNode,
    hasBrokerSession:false,
    canRunWindowsMT5:false,
    ordersEnabled:false,
    message:supportedNode
      ? 'Phone can monitor HTTPS availability; no independent MT5 terminal, broker quote or order capability.'
      : 'Install Node 20+ in Termux to run the secret-free cloud monitor.'
  };
}

// Only read the public, fixed HTTPS health endpoint.
// Never request privileged /api/elitebridge routes or pass cookies/bearer tokens.
export async function checkEliteBridgeCloud({fetcher=fetch}={}) {
  const started=Date.now();
  const base={endpoint:'EliteTrade public /health',brokerVerified:false,
    positionsVerified:false,ordersEnabled:false};
  try {
    const response=await fetcher(BRIDGE_HEALTH_URL,{
      method:'GET',redirect:'error',cache:'no-store',credentials:'omit',
      headers:{Accept:'application/json'},signal:AbortSignal.timeout(8000)
    });
    if(!response || response.ok!==true || response.redirected===true ||
       response.url!==BRIDGE_HEALTH_URL || response.status!==200 ||
       !String(response.headers?.get('content-type')||'').toLowerCase().includes('application/json'))
      return {...base,cloudState:'unavailable',httpOk:false,checkedAt:new Date().toISOString()};
    let body;
    try{body=await response.json();}catch{return {...base,cloudState:'unavailable',httpOk:false,checkedAt:new Date().toISOString()};}
    if(!body || typeof body!=='object' || Array.isArray(body) || body.ok!==true)
      return {...base,cloudState:'unavailable',httpOk:false,checkedAt:new Date().toISOString()};
    return {...base,cloudState:'reachable',httpOk:true,
      latencyMs:Math.max(0,Date.now()-started),checkedAt:new Date().toISOString()};
  }catch{
    // Never relay raw exception text, headers, response bodies or tokens to logs.
    return {...base,cloudState:'unavailable',httpOk:false,checkedAt:new Date().toISOString()};
  }
}
export function formatTermuxCloudHealth(value) {
  if(!value || !['reachable','unavailable'].includes(value.cloudState))
    throw Error('Invalid EliteBridge health observation');
  return '[ELITEBRIDGE] Cloud HTTP: '+(value.httpOk?'REACHABLE':'UNAVAILABLE')+
    ' | Independent MT5: NOT CONNECTED BY THIS MONITOR'+
    ' | Quotes/positions: NOT VERIFIED | Orders: DISABLED';
}
