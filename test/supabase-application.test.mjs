import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSupabaseApplication } from '../src/supabase-app.mjs';

async function fixture(t, extraEnv = {}) {
  const app = createSupabaseApplication({
    gateway: null,
    telegram: null,
    env: {
      NODE_ENV: 'test',
      APP_ORIGIN: 'http://localhost:3000',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
      ...extraEnv
    }
  });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  return base;
}

test('Supabase production backend boots and reports persistent storage', async t => {
  const base = await fixture(t);
  const health = await fetch(base + '/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok:true, database:'supabase' });

  const config = await fetch(base + '/api/config');
  assert.equal(config.status, 200);
  const body = await config.json();
  assert.equal(body.persistentData, true);
  assert.equal(body.credentialEncryptionConfigured, true);
  assert.equal(body.credentialVaultConfigured, true);
  assert.equal(body.supabaseUrl, 'https://example.supabase.co');
  assert.equal(body.demoMode, false);
});

test('Supabase backend serves app with Supabase allowed by CSP', async t => {
  const base = await fixture(t);
  const login = await fetch(base + '/login');
  assert.equal(login.status, 200);
  assert.match(login.headers.get('content-security-policy') || '', /connect-src 'self' https:\/\/example\.supabase\.co/);
  assert.match(await login.text(), /\/app\.js/);
});

test('unauthenticated identity is empty without contacting Supabase', async t => {
  const base = await fixture(t);
  const me = await fetch(base + '/api/me');
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user:null, requiresMfa:false });
});

test('marketing homepage and legal routes are public', async t => {
  const base = await fixture(t);
  for (const path of ['/', '/terms', '/privacy', '/risk-disclosure', '/refund-policy', '/cookies']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200, path);
    assert.match(await response.text(), /app\.js/);
  }
});



test('public canonical uses the Vercel site URL and auth callback uses the current origin', () => {
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8');
  const security = readFileSync(new URL('../public/security.txt', import.meta.url), 'utf8');
  assert.match(app, /AUTH_REDIRECT_ORIGIN = window\.location\.origin/);
  assert.match(app, /location\.hash && location\.pathname !== '\/reset-password'/);
  assert.match(index, /https:\/\/elitetradee\.vercel\.app\//);
  assert.match(robots, /https:\/\/elitetradee\.vercel\.app\/sitemap\.xml/);
  assert.match(security, /https:\/\/elitetradee\.vercel\.app\/\.well-known\/security\.txt/);
});
