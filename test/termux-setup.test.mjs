import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync(new URL('../scripts/termux-setup.sh',import.meta.url),'utf8');
test('Termux installer does not echo secrets, enables no trading, and strips copied Unicode marks',()=>{
 assert.match(source,/read -r -s service_key/);
 assert.match(source,/read -r -s metaapi_token/);
 assert.match(source,/umask 077/);
 assert.match(source,/mode:0o600/);
 assert.match(source,/DEMO_EXECUTION_ENABLED=false/);
 assert.match(source,/u200e/);
 assert.match(source,/sb_secret_/);
 assert.match(source,/SUPABASE_SECRET_KEY=/);
 assert.doesNotMatch(source,/SUPABASE_SERVICE_ROLE_KEY=/);
 assert.match(source,/NEW_KEYS_CREATED/);
 assert.doesNotMatch(source,/DEMO_EXECUTION_ENABLED=true|demoOrder\(|demoEngineTick\(|\/trade\b/);
});
