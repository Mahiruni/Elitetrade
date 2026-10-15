#!/usr/bin/env node
// Stage 2: verify that OUR EliteBridge-issued status token is recognized
// over HTTPS. This does not upload terminal telemetry or place MT5 orders.
import {checkOwnEliteBridgeToken} from '../src/elitebridge-own-token-health-client.mjs';

async function main(){
  const result=await checkOwnEliteBridgeToken({
    token:process.env.ELITEBRIDGE_OWN_STATUS_TOKEN,
    serverUrl:process.env.ELITEBRIDGE_SERVER_URL
  });
  console.log('ELITEBRIDGE OWN API TOKEN: authenticated');
  console.log('SCOPE: '+result.scope);
  console.log('MT5 TERMINAL CONNECTED BY ELITEBRIDGE: NO');
  console.log('BROKER VERIFIED: NO | ORDERS ENABLED: NO');
  console.log('METAAPI EXISTING PROVIDER: PRESERVED');
}
main().catch(e=>{
  // Sanitized error codes; NEVER print token or transport response bodies.
  console.error(e.message.startsWith('EliteBridge token check:')?
    e.message:'EliteBridge token check: UNAVAILABLE');
  process.exitCode=1;
});
