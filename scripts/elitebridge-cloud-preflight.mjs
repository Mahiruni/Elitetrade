#!/usr/bin/env node
// Cloud-first EliteBridge preflight. Never connects to a broker or places orders.
const checks = [
  ['Cloud API endpoint', process.env.ELITEBRIDGE_TELEMETRY_URL || 'https://elitetradee.vercel.app/api/elitebridge/telemetry'],
  ['Supabase project', process.env.SUPABASE_URL],
  ['Supabase service credential', process.env.SUPABASE_SERVICE_ROLE_KEY],
];
const results=checks.map(([name,value])=>{
  let configured=Boolean(value && String(value).trim());
  if(name==='Cloud API endpoint'){
    try {const u=new URL(value);configured=u.protocol==='https:' && !u.username && !u.password && !u.hash;}catch{configured=false;}
  }
  return {name,configured};
});
const modes={demo:process.env.DEMO_EXECUTION_ENABLED==='true',real:process.env.REAL_EXECUTION_ENABLED==='true'};
const report={service:'EliteBridge',kind:'cloud-preflight',brokerVerified:false,terminalConnected:false,ordersEnabled:false,
  checks:results,executionConfiguration:{demoRequested:modes.demo,realRequested:modes.real},
  warning:'Configuration checks do not establish broker connectivity, trading authorization, or operational readiness.'};
console.log(JSON.stringify(report,null,2));
if(modes.real){console.error('REAL execution flag detected: preflight does not authorize or validate live trading.');process.exitCode=2;}
else if(results.some(x=>!x.configured))process.exitCode=1;
