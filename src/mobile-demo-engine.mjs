import { processDemoRun } from './demo-engine.mjs';

// Server-side only. A signed-in admin can pulse ONLY their own existing
// broker-demo sessions. No trading instructions or credentials come from the
// Android client. DB leases/orders enforce exactly-once trading safeguards.
const q=encodeURIComponent;
export async function mobileEnginePulse({db,gateway,userId,processor=processDemoRun,clock=()=>new Date().toISOString()}) {
  if(!/^[a-f0-9-]{36}$/i.test(String(userId||'')))
    throw new Error('A valid authenticated account is required.');
  if(gateway?.mode!=='account-data')throw new Error('Broker account-data gateway is required.');
  const runs=await db.query('elitetrade_engine_runs',
    `user_id=eq.${q(userId)}&enabled=eq.true&select=*&order=updated_at.asc&limit=1`);
  if(!Array.isArray(runs)||runs.some(run=>run.user_id!==userId))
    throw new Error('The worker received a response outside the authenticated account scope.');
  // Heartbeat first, so an upstream MetaApi response delay doesn't incorrectly
  // report the Android engine offline during a normal evaluation cycle.
  const time=clock();
  await db.upsert('elitetrade_engine_heartbeat','on_conflict=id',{id:true,updated_at:time});
  for(const run of runs)await processor({db,gateway,run});
  const last=clock();
  if(runs.length) await db.upsert('elitetrade_engine_heartbeat','on_conflict=id',{id:true,updated_at:last});
  return {evaluated:runs.length,armed:runs.length>0,heartbeatAt:last};
}
