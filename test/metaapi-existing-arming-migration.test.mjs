import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/20261014223600_accept_metaapi_existing_account_bindings.sql',import.meta.url),'utf8');
test('DEMO arming accepts strict existing-host MetaApi account ids without weakening other gates',()=>{
 for(const guard of ['SECURITY DEFINER','auth.uid()','auth.mfa_factors','elitetrade_engine_heartbeat','elitetrade_engine_leases','elitetrade_engine_orders','elitetrade_engine_runs','p_running','account_id','user_id','connected','metaapi:%','metaapi-existing:'])assert.ok(migration.includes(guard),guard);
 assert.match(migration,/metaapi-existing:\[0-9a-f\]/);
 assert.match(migration,/status.*connected/s);
 assert.match(migration,/another bot already monitors this account/);
});
