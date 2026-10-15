#!/usr/bin/env node
// Termux-friendly synthetic diagnostics: no MT5, MetaApi, HTTP or REAL orders.
import {randomUUID} from 'node:crypto';
import {diagnoseBridgeTerminals} from '../src/elitebridge-diagnostics.mjs';

const now=Date.now(),iso=age=>new Date(now-age*1000).toISOString();
const sample=(label,mode,status,heartbeatAge,quoteAge,connected='true')=>({
  id:randomUUID(),label,account_mode:mode,status,
  proof_verified_at:iso(1800),
  last_heartbeat_at:heartbeatAge===null?null:iso(heartbeatAge),
  last_quote_at:quoteAge===null?null:iso(quoteAge),
  heartbeat_connected_claim:connected
});
const scenarios=[
  sample('DEMO telemetry','demo','approved',10,18),
  sample('REAL observer','real','approved',15,140),
  sample('Windows sleeping','demo','approved',240,270),
  sample('Awaiting pairing','real','pending',null,null),
  sample('Disconnected claim','real','approved',4,8,'false')
];
const report=diagnoseBridgeTerminals(scenarios,{nowMs:now});
for(const entry of report.terminals){
  console.log(entry.accountMode.toUpperCase().padEnd(5)+' | '+
    entry.label.padEnd(19)+' | '+entry.state+' | orders=DISABLED');
}
if(report.counts.receiving!==1||report.counts.needsAttention!==3||
   report.counts.pending!==1||
   report.terminals.some(t=>t.brokerVerified||t.ordersEnabled))
  throw Error('Unsafe diagnostics sandbox result');
console.log('PASS: mode isolation, stale recovery and disconnected indications');
console.log('SYNTHETIC DATA ONLY · BROKER VERIFIED: NO · REAL ORDERS: DISABLED');
