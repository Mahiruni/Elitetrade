import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(path,'utf8');
test('app entry loads premium responsive tokens and install manifest', () => {
  const page=read('public/index.html');
  assert.match(page,/href="\/mobile-premium\.css"/);
  assert.match(page,/rel="manifest"/);
  const manifest=JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.display,'standalone');
  assert.equal(manifest.start_url,'/dashboard');
});
test('navigation remains actual authenticated application and admin-gated', () => {
  const app=read('public/app.js');
  assert.match(app,/state\.user\.role === 'admin'/);
  assert.match(app,/class="bottom-nav"/);
  assert.match(app,/aria-expanded="false"/);
});
test('mobile UI preserves status-bar safe areas and accessible controls', () => {
  const css=read('public/mobile-premium.css');
  assert.match(css,/safe-area-inset-top/);
  assert.match(css,/safe-area-inset-bottom/);
  assert.match(css,/prefers-reduced-transparency/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(css,/min-height:\s*55px/);
});
test('trading snapshots cannot authorize live trading', () => {
  const cache=read('public/navigation-data.js');
  assert.match(cache,/Memory-only snapshots/);
  assert.match(cache,/snapshots = new Map/);
});

test('home overview avoids duplicating the dedicated subscription screen', () => {
  const workspace=read('public/workspace.js');
  const app=read('public/app.js');
  assert.doesNotMatch(workspace,/aria-label="Subscription active"/);
  assert.doesNotMatch(workspace,/class="card billing-cta"/);
  assert.match(app,/Your subscription is active/);
  assert.match(app,/id="payment-methods"/);
});
test('every signed-in route has an accessible circular real-data refresh above the mobile footer', () => {
  const app=read('public/app.js');
  const css=read('public/dashboard.css');
  assert.match(app,/class="workspace-refresh-button"/);
  assert.match(app,/aria-label=\\"Refresh backend data\\"/);
  assert.match(app,/if \(refreshInProgress\) return;/);
  assert.match(app,/await identity\(\);\s*await render\(\{quiet:true\}\);/);
  assert.match(css,/bottom: calc\(80px \+ env\(safe-area-inset-bottom/);
  assert.match(css,/prefers-reduced-motion:reduce/);
});
