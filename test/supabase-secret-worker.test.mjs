import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseData} from '../src/supabase-data.mjs';
test('new sb_secret API key uses only apikey, never Authorization Bearer for unattended worker reads',async t=>{
 const requests=[];
 t.mock.method(globalThis,'fetch',async (url,options)=>{
  requests.push({url,headers:options.headers});
  return Response.json([]);
 });
 const db=createSupabaseData({url:'https://example.supabase.co',key:'sb_secret_EXAMPLE_NOT_REAL'});
 await db.query('elitetrade_accounts','select=id&limit=1');
 assert.equal(requests.length,1);
 assert.equal(requests[0].headers.apikey,'sb_secret_EXAMPLE_NOT_REAL');
 assert.equal('Authorization' in requests[0].headers,false);
});
test('explicit signed-in user bearer is preserved with new sb_secret backend key',async t=>{
 let auth;
 t.mock.method(globalThis,'fetch',async (_,options)=>{auth=options.headers.Authorization;return Response.json([]);});
 const db=createSupabaseData({url:'https://example.supabase.co',key:'sb_secret_EXAMPLE_NOT_REAL'});
 await db.query('elitetrade_accounts','select=id','a.signed.user.jwt');
 assert.equal(auth,'Bearer a.signed.user.jwt');
});
test('legacy service_role JWT retains existing bearer behavior during migration',async t=>{
 let auth;
 t.mock.method(globalThis,'fetch',async (_,options)=>{auth=options.headers.Authorization;return Response.json([]);});
 const db=createSupabaseData({url:'https://example.supabase.co',key:'legacy-service-role-jwt-placeholder'});
 await db.query('elitetrade_accounts','select=id');
 assert.equal(auth,'Bearer legacy-service-role-jwt-placeholder');
});
test('Termux doctor and worker accept new SUPABASE_SECRET_KEY variable',()=>{
 const doctor=requireSource('../scripts/termux-doctor.mjs');
 const worker=requireSource('../scripts/demo-worker.mjs');
 assert.match(doctor,/env.SUPABASE_SECRET_KEY/);
 assert.match(worker,/env.SUPABASE_SECRET_KEY/);
});
import {readFileSync} from 'node:fs';
function requireSource(path){return readFileSync(new URL(path,import.meta.url),'utf8');}
