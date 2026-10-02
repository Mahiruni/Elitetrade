import { createSupabaseData } from '../src/supabase-data.mjs';
import { createMetaApiGateway } from '../src/metaapi-gateway.mjs';
import { demoEngineTick } from '../src/demo-engine.mjs';
const env=process.env;
if(env.DEMO_EXECUTION_ENABLED!=='true'||!env.SUPABASE_SERVICE_ROLE_KEY||!env.METAAPI_TOKEN||!env.SUPABASE_URL)throw new Error('Configure the private worker variables listed in docs/DEMO_ENGINE.md.');
const db=createSupabaseData({url:env.SUPABASE_URL,key:env.SUPABASE_SERVICE_ROLE_KEY});
const gateway=createMetaApiGateway(env);
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{stopping=true;});
while(!stopping) {
  try {await demoEngineTick({db,gateway});console.log('Demo evaluation cycle completed.');}
  catch {console.error('Demo worker cycle failed. Check database and provider configuration.');}
  if(!stopping)await new Promise(resolve=>setTimeout(resolve,15000));
}
