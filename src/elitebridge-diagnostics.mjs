// EliteBridge Phase 8: server-receipt diagnostics only.
// A signed heartbeat is evidence that an approved device signed a message;
// it is NOT independent broker authentication or trading authorization.

export const HEARTBEAT_FRESH_SECONDS=90;
export const QUOTE_FRESH_SECONDS=120;

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES=new Set(['demo','real']);
const STATUSES=new Set(['pending','approved','revoked']);
function fail(message){throw Error('EliteBridge diagnostics: '+message);}

function secondsSince(timestamp,now){
  if(timestamp==null)return null;
  if(typeof timestamp!=='string'||!timestamp) return null;
  const time=Date.parse(timestamp);
  if(!Number.isFinite(time)||time>now+5000)return null;
  return Math.max(0,Math.floor((now-time)/1000));
}
function asConnected(value){
  // PostgreSQL function returns the last signed terminal-reported boolean,
  // not a verified MT5 broker-connection assertion.
  return value===true||value==='true'?true:
    value===false||value==='false'?false:null;
}
export function diagnoseBridgeTerminals(rows,{nowMs=Date.now()}={}){
  if(!Array.isArray(rows)||rows.length>30||!Number.isSafeInteger(nowMs)||nowMs<0)
    fail('invalid privileged health result');
  const terminals=rows.map(row=>{
    if(!row||!UUID.test(row.id||'')||
       typeof row.label!=='string'||row.label.length>64||
       !MODES.has(row.account_mode)||!STATUSES.has(row.status))
      fail('malformed private terminal record');
    const heartbeatAgeSeconds=secondsSince(row.last_heartbeat_at,nowMs);
    const quoteAgeSeconds=secondsSince(row.last_quote_at,nowMs);
    const terminalReportedConnected=asConnected(row.heartbeat_connected_claim);
    let state,recovery;
    switch(row.status){
      case 'pending':
        state='awaiting-approval';
        recovery='Complete signed pairing and explicit administrator approval.';
        break;
      case 'revoked':
        state='revoked';
        recovery='Create a fresh key and re-enroll; revoked keys stay blocked.';
        break;
      default:
        if(heartbeatAgeSeconds===null){
          state=quoteAgeSeconds===null?'awaiting-telemetry':'incomplete-telemetry';
          recovery='Check approved Windows terminal identity and publish a fresh signed heartbeat.';
        }else if(heartbeatAgeSeconds>HEARTBEAT_FRESH_SECONDS){
          state='stale';
          recovery='Inspect Windows MT5 process, connection and uplink; retry with new sequence IDs.';
        }else if(terminalReportedConnected===false){
          state='terminal-reports-disconnected';
          recovery='Check the MT5 terminal locally; do not interpret a signed heartbeat as broker connectivity.';
        }else if(terminalReportedConnected!==true){
          state='incomplete-telemetry';
          recovery='Check heartbeat payload integrity; no broker connection is confirmed.';
        }else if(quoteAgeSeconds===null){
          state='awaiting-quote';
          recovery='Verify instrument selection and market hours; publish a new broker-derived quote.';
        }else if(quoteAgeSeconds>QUOTE_FRESH_SECONDS){
          state='recovering';
          recovery='Heartbeat is recent but quote is stale; wait for or manually publish a fresh quote.';
        }else {
          state='receiving';
          recovery='Signed heartbeat and quote are recent. Broker verification still pending.';
        }
    }
    return {
      terminalId:row.id,
      label:row.label,
      accountMode:row.account_mode,
      approvalStatus:row.status,
      pairingProofPresent:typeof row.proof_verified_at==='string'&&
        Number.isFinite(Date.parse(row.proof_verified_at)),
      state,
      heartbeatAgeSeconds,
      quoteAgeSeconds,
      terminalReportedConnected,
      recovery,
      // Never infer trading permission from terminal state, sequence
      // progress, or a signed tradeAllowed claim.
      brokerVerified:false,
      ordersEnabled:false,
      accountTradingAuthorized:false
    };
  });
  const counts={receiving:0,needsAttention:0,pending:0,revoked:0};
  for(const terminal of terminals){
    if(terminal.state==='receiving')counts.receiving++;
    else if(terminal.state==='awaiting-approval')counts.pending++;
    else if(terminal.state==='revoked')counts.revoked++;
    else counts.needsAttention++;
  }
  return {
    checkedAt:new Date(nowMs).toISOString(),
    thresholds:{heartbeatSeconds:HEARTBEAT_FRESH_SECONDS,quoteSeconds:QUOTE_FRESH_SECONDS},
    counts,terminals,
    observationOnly:true,brokerVerified:false,ordersEnabled:false,
    message:'Telemetry freshness reflects server receipt of signed packets, not an independently verified broker connection.'
  };
}
