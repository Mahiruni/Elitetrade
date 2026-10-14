// EliteBridge Phase 1: provider-neutral, READ-ONLY gateway metadata.
// This module intentionally does not connect, import credentials, or place orders.

const PROVIDERS = Object.freeze({
  metaapi:Object.freeze({id:'metaapi',label:'MetaApi',kind:'hosted',implemented:true}),
  elitebridge:Object.freeze({id:'elitebridge',label:'EliteBridge Direct MT5',kind:'self-hosted',implemented:false}),
});
const accountState=new Set(['connected','pending','disconnected','unknown']);
const acceptedGatewayId=id=>typeof id==='string' &&
  (/^metaapi:[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/.test(id) ||
   /^metaapi-existing:[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/.test(id));

export function bridgeProviderForBinding(id) {
  return acceptedGatewayId(id)?'metaapi':null;
}

// Future providers must implement this execution contract before ANY switch.
// There is NO fallback to an unimplemented bridge, and no adapter supplied yet.
export function assertDemoGatewayContract(provider) {
  if(!provider || typeof provider !== 'object')throw new Error('Broker gateway is missing.');
  if(provider.mode!=='account-data')throw new Error('A broker DEMO account-data gateway is required.');
  for(const op of ['connectionHealth','snapshot','previewMarket','market','margin','demoOrder']){
    if(typeof provider[op]!=='function')throw new Error('Broker gateway is missing required capability: '+op);
  }
  return true;
}

const maskLogin=login=>{
  const value=String(login||'');
  return /^\d{4,30}$/.test(value)?'••••'+value.slice(-3):'Private MT5 account';
};

export function eliteBridgeStatus({gateway,accounts=[],workerReady=false}={}) {
  if(!Array.isArray(accounts))throw new Error('Invalid account records');
  const configured=gateway?.mode==='account-data';
  const accountSummaries=accounts.slice(0,30).map(account=>{
    const provider=bridgeProviderForBinding(account.gateway_id);
    const status=accountState.has(account.status)?account.status:'unknown';
    return {
      provider:provider||'unverified',
      account:maskLogin(account.login),
      broker:typeof account.broker==='string'?account.broker.slice(0,60):'MT5',
      status,
      // Connected here refers only to stored registration state,
      // NOT a new broker terminal verification.
      storedConnection:status==='connected'&&provider==='metaapi',
      verification:'saved-binding-only'
    };
  });
  return {
    phase:1,readOnly:true,
    executionEnabledByBridge:false,
    activeProvider:configured?'metaapi':gateway?'legacy-gateway':null,
    workerHeartbeatFresh:workerReady===true,
    providers:[
      {...PROVIDERS.metaapi,status:configured?'configured':'not-configured',
        description:'Current hosted MT5 connection. Existing EliteTrade broker verification remains required for any demo trade.'},
      {...PROVIDERS.elitebridge,status:'not-connected',
        description:'A future adapter requiring a real MT5 terminal or officially supported broker API. Android alone is not a terminal.'}
    ],
    accounts:accountSummaries,
    note:'Read-only connection inventory; saved account status is not proof of a live broker connection. No provider change or order request is possible on this page.'
  };
}
