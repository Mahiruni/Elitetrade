// Termux preflight: verifies configuration, Supabase read access and broker DEMO identity.
// This utility cannot arm bots, place trades, alter database state, or publish a heartbeat.
import {createSupabaseData} from '../src/supabase-data.mjs';
import {createMetaApiGateway} from '../src/metaapi-gateway.mjs';
import {termuxConfigIssues} from '../src/termux-readiness.mjs';

const env=process.env;
const problems=termuxConfigIssues(env,process.versions.node);
console.log('EliteTrade Termux preflight — read only; no orders');
if(problems.length){
 for(const msg of problems)console.error('CHECK:',msg);
 process.exitCode=1;
}else{
 console.log('Node.js version and private configuration: present. Values not displayed.');
 try{
  const db=createSupabaseData({url:env.SUPABASE_URL,key:env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY});
  // Limits provider lookups and intentionally displays neither broker IDs nor passwords.
  const accounts=await db.query('elitetrade_accounts',
    'status=eq.connected&gateway_id=not.is.null&select=gateway_id&limit=8');
  if(!Array.isArray(accounts))throw new Error('Invalid database response');
  console.log('Connected EliteTrade bindings found:',accounts.length);
  if(!accounts.length)throw new Error('No connected EliteTrade account to verify. Check your MT5 account in the website.');
  const gateway=createMetaApiGateway(env);
  let demoCount=0;
  for(const row of accounts) {
   try {
    const result=await gateway.connectionHealth(row.gateway_id);
    if(result.brokerVerified && result.accountType==='demo'){
      demoCount++;
      console.log('A linked MT5 demo account is broker-verified; trading credentials allowed:',result.tradeAllowed===true?'yes':'not confirmed');
    }else{
      console.log('Linked account: MetaApi',result.hostingState,'/ MT5',result.connectionStatus,'/ account type',result.brokerVerified?result.accountType:'UNVERIFIED');
    }
   }catch(error){
    console.log('Could not verify a MetaApi connection. Check broker/provider status:',String(error?.message||'upstream failure').slice(0,160));
   }
  }
  if(!demoCount)throw new Error('No broker-verified demo connection. Do not arm bots until the provider confirms DEMO.');
  console.log('Demo accounts verified:',demoCount);
  console.log('Worker mode:',env.DEMO_EXECUTION_ENABLED==='true'?'execution enabled but no bot started by this preflight':'setup only; execution disabled');
  console.log('NEXT: If you accept DEMO orders and have checked limits, start the worker in tmux. This script did not run it.');
 }catch(error){
  // Do not pass provider error.details, HTTP bodies, tokens, or response headers into output.
  console.error('PREFLIGHT NOT READY:',String(error?.message||'connection failure').slice(0,180));
  process.exitCode=1;
 }
}
