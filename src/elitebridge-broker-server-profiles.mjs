// Broker-reported server labels are identifiers, not authenticated endpoints.
export const BROKER_SERVER_PROFILES = Object.freeze({
  exness:Object.freeze({
    broker:'Exness',platform:'mt5',
    demo:Object.freeze({serverPattern:'^Exness-MT5Trial[0-9]+$',tradingEnabled:false}),
    real:Object.freeze({serverPattern:'^Exness-MT5Real[0-9]+$',tradingEnabled:false})
  })
});
export const EXNESS_MT5_SERVER_OPTIONS = Object.freeze(
  ['demo','real'].flatMap(mode=>Array.from({length:20},(_,index)=>{
    const number=index+1;
    const server=`Exness-MT5${mode==='demo'?'Trial':'Real'}${number}`;
    return Object.freeze({
      value:server,label:`${server} — ${mode==='demo'?'Demo':'Real'}`,
      server,mode,isDemo:mode==='demo',broker:'exness'
    });
  }))
);
export function listMt5ServerOptions(broker,mode){
  if(typeof broker!=='string'||broker.trim().toLowerCase()!=='exness')return [];
  if(mode!=null&&!['demo','real'].includes(mode))throw Error('Invalid MT5 account mode');
  return EXNESS_MT5_SERVER_OPTIONS.filter(option=>!mode||option.mode===mode);
}
export function resolveMt5ServerProfile({broker,mode,server}={}){
  if(typeof broker!=='string'||typeof server!=='string')throw Error('Broker and MT5 server required');
  if(mode!=='demo'&&mode!=='real')throw Error('Explicit demo or real account mode required');
  const id=broker.trim().toLowerCase(),value=server.trim();
  if(!value||value.length>128||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))
    throw Error('Invalid MT5 server label');
  if(id==='exness'){
    const pattern=mode==='demo'?/^Exness-MT5Trial[0-9]+$/i:/^Exness-MT5Real[0-9]+$/i;
    if(!pattern.test(value))throw Error('Exness MT5 server does not match selected account mode');
  }
  return Object.freeze({broker:id,platform:'mt5',mode,server:value,
    brokerAuthenticated:false,marketDataVerified:false,orderExecutionAuthorized:false});
}
