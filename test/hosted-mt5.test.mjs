import test from 'node:test';
import assert from 'node:assert/strict';
import { hostedMt5Status, ELITETRADE_EA_SHA256 } from '../src/hosted-mt5-status.mjs';
import { createHostedMt5Workspace } from '../public/hosted-mt5.js';
import { readFileSync } from 'node:fs';

test('host status fails closed: no simulated Windows VPS, broker, or live trading', () => {
  const s=hostedMt5Status();
  assert.equal(s.schema,'hosted_mt5_readiness_v1');
  assert.equal(s.host.state,'not_provisioned');
  assert.equal(s.host.lastHeartbeatAt,null);
  assert.equal(s.broker.state,'not_verified');
  assert.equal(s.strategy.liveOrdersEnabled,false);
  assert.equal(s.strategy.realTickCoverageVerified,false);
  assert.equal(s.strategy.realTickBacktest,'not_verified');
  assert.equal(s.provisioning.availableInApp,false);
  assert.equal(s.research.referenceEquivalenceProven,false);
  assert.match(ELITETRADE_EA_SHA256,/^[a-f0-9]{64}$/);
  const all=JSON.stringify(s);
  assert.doesNotMatch(all,/password|secret|login\s*:/i);
});

test('hosted workspace renders authenticated read-only guidance and not a fake connection', async () => {
  const calls=[];
  const view=createHostedMt5Workspace({
    api: async path => {calls.push(path); return hostedMt5Status();},
    esc: value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  });
  const markup=await view.page();
  assert.deepEqual(calls,['/hosted-mt5/status']);
  assert.match(markup,/Hosted MT5/);
  assert.match(markup,/Not provisioned/);
  assert.match(markup,/Unverified/);
  assert.match(markup,/No Windows VPS has been connected or provisioned/);
  assert.match(markup,/Copy/);
  assert.match(markup,/Android Remote Desktop/);
  assert.doesNotMatch(markup,/type=["']password["']|Enter your MT5 password/i);
  assert.doesNotMatch(markup,/Live host connected|Trading is active/i);
});

test('hosted route has signed-in API guard and both server static mappings', () => {
  for(const file of ['src/app.mjs','src/supabase-app.mjs']) {
    const content=readFileSync(new URL('../'+file,import.meta.url),'utf8');
    assert.match(content,/\/api\/hosted-mt5\/status/);
    assert.match(content,/hostedMt5Status\(\)/);
    assert.match(content,/files\['\/hosted-mt5\.js'\]/);
    assert.match(content,/files\['\/hosted-mt5\.css'\]/);
    assert.match(content,/'\/hosted-mt5'/);
  }
  const browser=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(browser,/hostedMt5UI\.page/);
  assert.match(browser,/hostedMt5UI\.mount/);
  assert.match(browser,/Hosted MT5/);
});
