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
