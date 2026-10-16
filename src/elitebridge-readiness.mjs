// Pre-Windows EliteBridge readiness. This is an operational checklist,
// not a broker connection check, VPS order, or trading authorization.
export const READINESS_SCHEMA='elitebridge-prewindows-v1';
const check=(id,title,state,note)=>{
  if(!['ready','pending','unavailable'].includes(state))throw new Error('Invalid readiness state.');
  return {id,title,state,note};
};
export function eliteBridgeReadiness({cloudEnabled=false,cloudInventory=null,accounts=[],
  isAdmin=false,nowMs=Date.now()}={}){
  if(!Array.isArray(accounts))throw new Error('Invalid owned accounts.');
  // null inventory means unknown/unavailable; [] means genuinely empty.
  const inventory=Array.isArray(cloudInventory)?cloudInventory:null;
  const approved=inventory?.filter(x=>x.status==='approved')||[];
  const proven=inventory?.filter(x=>x.proof_verified_at)||[];
  const receiving=approved.filter(x=>{
    const age=Number.isFinite(Date.parse(x.last_seen_at||''))?
      nowMs-Date.parse(x.last_seen_at):Infinity;
    return age>=0&&age<=90000;
  });
  const accountSaved=accounts.some(x=>x&&typeof x.id==='string');
  const checks=[
    check('protocol','Ed25519 signed protocol','ready',
      'Message schemas and signature verification implemented; this does not verify an MT5 session.'),
    check('cloud','Secure cloud ingestion',cloudEnabled?'ready':'pending',
      cloudEnabled?'Server-side ingestion configuration detected; database receipts must still be verified.':
        'Server-side EliteBridge ingestion is not activated.'),
    check('account','Owned account registration',accountSaved?'ready':'pending',
      accountSaved?'An MT5 account record exists; its stored status is not broker proof.':
        'Add your own MT5 account before enrolling a terminal.'),
    check('host','Dedicated Windows MT5 terminal','pending',
      'No independent Windows terminal is verified through this readiness endpoint.'),
    check('pairing','Approved Ed25519 terminal',
      !cloudEnabled?'pending':!isAdmin?'unavailable':inventory===null?'unavailable':
      approved.some(x=>x.proof_verified_at)?'ready':'pending',
      !isAdmin?'Only a device-verified administrator can inspect enrollment.':
      inventory===null?'Terminal registry check unavailable; enrollment status is unknown.':
      approved.some(x=>x.proof_verified_at)?
        'An owner-scoped terminal has approved key possession. This is not broker verification.':
        'Generate keys on Windows, prove device possession, and approve the terminal.'),
    check('telemetry','Fresh signed terminal telemetry',
      !cloudEnabled?'pending':!isAdmin?'unavailable':inventory===null?'unavailable':
      receiving.length?'ready':'pending',
      !isAdmin?'Administrator-only terminal telemetry visibility.':
      inventory===null?'Terminal registry unavailable: do not infer telemetry status.':
      receiving.length?'Recent signed packet observed; sender claims are not broker attestation.':
        'No recent signed telemetry observed for an approved terminal.'),
    check('broker','Independent broker verification','pending',
      'Windows MT5 login, exact server, XAUUSDm quote and broker permissions still require live verification.'),
    check('execution','Independent bridge order execution','pending',
      'Disabled until separate order signing, limits, reconciliation, kill switch and explicit approval exist.')
  ];
  const next=checks.find(x=>x.state==='pending'&&x.id!=='execution'&&x.id!=='protocol');
  return {schema:READINESS_SCHEMA,state:'preparing',
    checkedAt:new Date(nowMs).toISOString(),
    checks,readyCount:checks.filter(x=>x.state==='ready').length,
    totalChecks:checks.length,
    terminalRegistrations:isAdmin&&inventory!==null?inventory.length:null,
    provenTerminals:isAdmin&&inventory!==null?proven.length:null,
    approvedTerminals:isAdmin&&inventory!==null?approved.length:null,
    signedTelemetryRecent:isAdmin&&inventory!==null?receiving.length:null,
    nextStep:next?{id:next.id,title:next.title,note:next.note}:null,
    independentMT5Connected:false,brokerVerified:false,
    readOnly:true,realOrdersEnabled:false,ordersEnabled:false,
    note:'Preparation checklist only. The existing MetaApi integration is unchanged. No Windows host, real quote or order is implied by these checks.'};
}
