import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ORIGINAL_EX5, ORIGINAL_EX5_ID, isOriginalEx5} from '../src/original-ex5.mjs';
import {evaluateStrategy} from '../src/trading-strategies.mjs';
const source = p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('the original Ex5 catalog preserves supplied checksum and no execution claims',()=>{
  assert.equal(ORIGINAL_EX5_ID,'scalpin-ss-ex5');
  assert.equal(ORIGINAL_EX5.filename,'Scalpin SS .ex5');
  assert.equal(ORIGINAL_EX5.bytes,77796);
  assert.equal(ORIGINAL_EX5.sha256,'812d951ed273c8898990af8a9ce40b0287aaeee7b6cd956002e748f723e506e5');
  assert.equal(ORIGINAL_EX5.runtime,'windows-mt5');
  assert.equal(ORIGINAL_EX5.executionAvailable,false);
  assert.equal(ORIGINAL_EX5.performanceVerified,false);
  assert.ok(isOriginalEx5('scalpin-ss-ex5'));
  assert.ok(!isOriginalEx5('scalping-m1'));
});
test('original EX5 never gets evaluated as an invented candle strategy',()=>{
  assert.throws(()=>evaluateStrategy(ORIGINAL_EX5_ID,[]),/Unknown strategy/);
});
test('both web backends save original strategy metadata but refuse external EA start',()=>{
  const server=source('src/supabase-app.mjs');
  assert.match(server,/ORIGINAL_EX5_ID\], 'strategy'/);
  assert.match(server,/body\.running && isOriginalEx5\(bot\.strategy\)/);
  assert.match(server,/if\(isOriginalEx5\(bot\.strategy\)\)return json\(res/);
  assert.match(server,/order:null/);
  const local=source('src/app.mjs');
  assert.match(local,/body\.running && isOriginalEx5\(bot\.strategy\)/);
  assert.match(local,/ORIGINAL_EX5_ID\], 'strategy'/);
});
test('app shows external EX5 in strategy picker and disables web bot start',()=>{
  const web=source('public/app.js');
  assert.match(web,/Scalpin SS · Original MT5 EX5 \(Windows only\)/);
  assert.match(web,/bot\.strategy==='scalpin-ss-ex5' \|\| engineOffline/);
  assert.match(web,/Original EX5 can only|Original EX5 requires a Windows MT5 terminal/);
  assert.match(web,/Original file registered/);
  assert.doesNotMatch(web,/\.ex5['"]\s*,\s*['"]data:image/);
});
test('SQL migration enforces external EA cannot arm worker even by direct RPC',()=>{
  const sql=source('supabase/migrations/20261015160000_original_external_ex5_strategy.sql');
  assert.match(sql,/create trigger elitetrade_reject_original_ex5_engine_start/i);
  assert.match(sql,/new\.enabled and exists/i);
  assert.match(sql,/create trigger elitetrade_reject_original_ex5_running_bot/i);
});
