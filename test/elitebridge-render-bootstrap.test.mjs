import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRenderDevelopmentUrl,classifyPsqlFailure} from '../scripts/elitebridge-render-dev-bootstrap.mjs';

const base='postgresql://elitebridge_dev_v2:nonprod-test-only-password@dpg-db7vjjnavr4c73bke1pg-a.frankfurt-postgres.render.com/elitebridge_postgres_dev';
test('only the explicitly approved Render Frankfurt dev database connection is valid',()=>{
 const conn=parseRenderDevelopmentUrl(base);
 assert.equal(conn.database,'elitebridge_postgres_dev');
 assert.equal(conn.user,'elitebridge_dev_v2');
 assert.equal(conn.host,'dpg-db7vjjnavr4c73bke1pg-a.frankfurt-postgres.render.com');
 assert.equal(conn.port,'5432');
 assert.equal(conn.password,'nonprod-test-only-password');
});
test('percent-encoded credentials parse safely and never enter the command line',()=>{
 const conn=parseRenderDevelopmentUrl(base.replace('nonprod-test-only-password','local%40only%3Apassword'));
 assert.equal(conn.password,'local@only:password');
});
test('reject wrong hosts, production DB, alternate regions, public IP and unapproved users',()=>{
 for(const s of [
  base.replace('frankfurt-postgres.render.com','oregon-postgres.render.com'),
  base.replace('dpg-db7vjjnavr4c73bke1pg-a','dpg-untrusted-a'),
  base.replace('elitebridge_dev_v2','postgres'),
  base.replace('/elitebridge_postgres_dev','/production_elitetrade'),
  base.replace('dpg-db7vjjnavr4c73bke1pg-a.frankfurt-postgres.render.com','127.0.0.1'),
  base.replace('postgresql://','http://'),
  base+'#attack',
  'not a URL'
 ])assert.throws(()=>parseRenderDevelopmentUrl(s),/Invalid Render development database URL/);
});
test('reject blank, multiline or missing passwords',()=>{
 for(const s of ['',base.replace(':nonprod-test-only-password@',':@'),
   base.replace('nonprod-test-only-password','unsafe%0Apassword')])
  assert.throws(()=>parseRenderDevelopmentUrl(s),/Invalid Render development database URL/);
});

test('connection diagnostics distinguish root causes without leaking details',()=>{
 const samples=[
  ['psql: error: connection to server timed out','NETWORK_TIMEOUT'],
  ['FATAL: password authentication failed for user "secret-user"','PASSWORD_REJECTED'],
  ['no pg_hba.conf entry for host "10.0.0.1"','NETWORK_RULE_OR_TLS_DENIED'],
  ['could not translate host name "secret.example.com"','DNS_FAILURE'],
  ['connection refused','CONNECTION_REFUSED'],
  ['SSL SYSCALL error','TLS_FAILURE'],
  ['some unknown error with user=secret-user','OTHER_PSQL_FAILURE']
 ];
 for(const [message,prefix] of samples){
   const result=classifyPsqlFailure(message,'',2);
   assert.ok(result.startsWith(prefix),prefix+' : '+result);
   assert.ok(!result.includes('secret-user'));
   assert.ok(!result.includes('10.0.0.1'));
   assert.ok(!result.includes('secret.example.com'));
 }
 assert.match(classifyPsqlFailure('', 'ENOENT',null),/^PSQL_CLIENT_MISSING/);
});
