// Phase 6: Independent EliteBridge, MetaAPI-like READ-ONLY terminal report.
// A signed claim from an MT5 companion is not independent BROKER verification.
// Never advertise provider availability for trading or simulate missing data.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYMBOL=/^[A-Za-z0-9._-]{3,30}$/;
const fail=(text)=>{throw new Error('EliteBridge gateway: '+text)};
const sanitizeId=(id)=>typeof id==='string'&&UUID.test(id)?id.toLowerCase():fail('invalid identifier');

export function createOwnMt5ReadOnlyGateway({db,clock=()=>Date.now()}={}){
  if(!db||typeof db.rpc!=='function')fail('trusted Supabase store required');
  if(typeof clock!=='function')fail('clock is required');
  return Object.freeze({
    provider:'elitebridge',
    mode:'terminal-telemetry-only',
    // Deliberately NO market(), margin(), demoOrder(), or account connection.
    async probe({ownerId,accountId,deviceId,symbol='XAUUSDm'}={}){
      const owner=sanitizeId(ownerId),account=sanitizeId(accountId),device=sanitizeId(deviceId);
      if(typeof symbol!=='string'||!SYMBOL.test(symbol))fail('invalid symbol');
      const now=clock();
      if(!Number.isSafeInteger(now)||now<1)fail('invalid clock');
      const stored=await db.rpc('elitetrade_bridge_snapshot',{
        p_owner_id:owner,p_account_id:account,p_device_id:device
      });
      const base={
        provider:'elitebridge',mode:'terminal-telemetry-only',
        readOnly:true,demoOnly:true,brokerVerified:false,
        executionEnabled:false,actionsAllowed:false,ordersEnabled:false,
        independentMT5Connected:false,
        checkedAt:new Date(now).toISOString()
      };
      if(stored===null||stored===undefined)
        return {...base,state:'no-approved-terminal',terminal:{state:'not-enrolled'},
          market:{state:'not-checked'}};
      if(!stored||typeof stored!=='object'||Array.isArray(stored)||
         stored.accountId?.toLowerCase()!==account||stored.deviceId?.toLowerCase()!==device||
         !Number.isSafeInteger(Number(stored.lastSequence))||Number(stored.lastSequence)<0)
        fail('invalid scoped Supabase snapshot');
      const last=Date.parse(stored.lastReceivedAt??'');
      const beat=Date.parse(stored.heartbeatAt??'');
      const ageMs=now-beat;
      const heartbeatFresh=Number.isFinite(beat)&&ageMs>=-30000&&ageMs<=90000;
      const reporting=heartbeatFresh&&stored.terminalConnectedClaim===true;
      const terminal={
        state:!heartbeatFresh?'stale':reporting?'reporting':'disconnected-claimed',
        connectedClaim:stored.terminalConnectedClaim===true,
        heartbeatAt:Number.isFinite(beat)?new Date(beat).toISOString():null,
        lastReceivedAt:Number.isFinite(last)?new Date(last).toISOString():null,
        lastSequence:Number(stored.lastSequence)
      };
      const raw=stored.quote;
      let market={state:'not-available'};
      if(reporting&&raw&&typeof raw==='object'&&!Array.isArray(raw)){
        const bid=Number(raw.bid),ask=Number(raw.ask);
        const quoteTime=Number(raw.observedAt);
        const quoteAge=now-quoteTime;
        if(raw.symbol===symbol&&Number.isFinite(bid)&&bid>0&&
          Number.isFinite(ask)&&ask>=bid&&Number.isSafeInteger(quoteTime)&&
          quoteAge>=-30000&&quoteAge<=180000){
          market={state:'terminal-reported',symbol,bid,ask,
            observedAt:new Date(quoteTime).toISOString(),
            ageSeconds:Math.max(0,Math.floor(quoteAge/1000)),
            independentlyVerified:false};
        }else market={state:'stale-or-invalid'};
      }
      return {...base,state:reporting?'terminal-reported':'terminal-unavailable',
        terminal,market,note:'This is signed device telemetry, not proof of a broker-authenticated MT5 session. Trading is disabled.'};
    }
  });
}
