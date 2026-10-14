// Read-only preflight validations for temporary Android/Termux worker hosting.
// Do not print, log or return private values from process.env.
export function termuxConfigIssues(env,nodeVersion='24.18.0') {
  const problems=[];
  const [major,minor,patch]=String(nodeVersion).replace(/^v/,'').split('.').map(Number);
  if (!Number.isInteger(major)||major!==24||minor<12||(minor===12&&patch<0))
    problems.push('Install Node.js 24.12.0 or later in the Node 24 series: pkg install nodejs-lts');
  if (env.SUPABASE_URL!=='https://cgpvhayfwnpipktyltho.supabase.co')
    problems.push('SUPABASE_URL must point to the existing EliteTrade Supabase project.');
  if (!String(env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY||'').trim())
    problems.push('SUPABASE_SECRET_KEY is missing. Create a new server-side sb_secret_ key for Termux, not a publishable/anon key.');
  if (!String(env.METAAPI_TOKEN||'').trim())
    problems.push('METAAPI_TOKEN is missing. Enter the same token that owns the connected MetaApi DEMO account.');
  if (env.METAAPI_REGION && !/^[a-z][a-z0-9-]{0,30}$/.test(env.METAAPI_REGION))
    problems.push('METAAPI_REGION must be a supported MetaApi region identifier, e.g. london.');
  if (!['true','false'].includes(env.DEMO_EXECUTION_ENABLED))
    problems.push('DEMO_EXECUTION_ENABLED must be false during setup, then true only when you are ready to start demo monitoring.');
  return problems;
}
