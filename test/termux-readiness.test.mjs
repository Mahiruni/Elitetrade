import test from 'node:test';
import assert from 'node:assert/strict';
import {termuxConfigIssues} from '../src/termux-readiness.mjs';
import {readFileSync} from 'node:fs';
const correct={SUPABASE_URL:'https://cgpvhayfwnpipktyltho.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_TEST_KEY_NOT_LIVE',METAAPI_TOKEN:'mock-provider-token',METAAPI_REGION:'london',DEMO_EXECUTION_ENABLED:'false'};
test('Node 24.12+ and private variable presence are required',()=>{
 assert.deepEqual(termuxConfigIssues(correct,'24.18.0'),[]);
 assert.deepEqual(termuxConfigIssues(correct,'24.12.0'),[]);
 assert.ok(termuxConfigIssues(correct,'22.16.0').length);
 assert.ok(termuxConfigIssues({...correct,METAAPI_TOKEN:''},'24.18.0').some(x=>x.includes('METAAPI_TOKEN')));
 assert.ok(termuxConfigIssues({...correct,SUPABASE_URL:'https://example.com'},'24.18.0').some(x=>x.includes('SUPABASE_URL')));
});
test('preflight never invokes the worker or trade endpoints',()=>{
 const s=readFileSync(new URL('../scripts/termux-doctor.mjs',import.meta.url),'utf8');
 assert.ok(!/demoOrder\(|demoEngineTick\(|\/trade['"`]|db\.rpc\(|db\.upsert\(/.test(s));
 assert.match(s,/connectionHealth\(/);
 assert.match(s,/createSupabaseData/);
 assert.doesNotMatch(s,/console\.log\(.*(?:METAAPI_TOKEN|SERVICE_ROLE_KEY)/);
});
