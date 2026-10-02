import {createSupabaseData} from '../../../src/supabase-data.mjs';
import {createTronReader,scanUsdtInvoices} from '../../../src/tron-payments.mjs';
const db=createSupabaseData({url:Deno.env.get('SUPABASE_URL'),key:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')});
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'Use POST.'},405);
 try {
  const job=req.headers.get('x-elitetrade-job')||'';
  if(!/^[a-f0-9]{64}$/.test(job)||!(await db.rpc('elitetrade_crypto_scheduler_valid',{p_token:job})))return reply({error:'Unauthorized.'},401);
  const apiKey=Deno.env.get('TRONGRID_API_KEY')||await db.rpc('elitetrade_crypto_provider_key',{});
  const reader=createTronReader({apiKey});
  return reply(await scanUsdtInvoices({db,reader}));
 }catch {return reply({error:'Payment verification unavailable; no unverified account was activated.'},503);}
});
