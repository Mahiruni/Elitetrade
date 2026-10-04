import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the actual completion flow with an Auth API contract that rejects
// GET /factors, just as the production provider does. No live credentials,
// accounts, browser sessions, or messages are used.
const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = source.indexOf('async function finishAuth(');
const end = source.indexOf('\nasync function sendDeviceEmail(', start);
assert.ok(start >= 0 && end > start);
const completion = source.slice(start, end);

function fixture({ factors = [], aal = 'aal1', device = false, next = '' } = {}) {
  const calls = [], navigation = [], screens = [];
  const state = { user: { id: 'isolated-member' }, requiresMfa: false,
    requiresDeviceVerification: device, deviceEmailSession: '' };
  const auth = { access_token: 'isolated-access-token', refresh_token: 'isolated-refresh-token' };
  const env = {
    state, ebookAuthReturn: () => next, saveAuth: session => { state.auth = session; },
    identity: async () => { state.requiresMfa = factors.some(f => f.status === 'verified') && aal !== 'aal2'; },
    decodeJwt: () => ({ aal, session_id: 'isolated-session' }),
    supabaseAuth: async (path, method, body, token) => {
      calls.push({ path, method, body, token });
      if (path === 'user' && method === 'GET') return { id: 'isolated-member', factors };
      if (path === 'factors') throw Object.assign(new Error('Method not allowed'), { status: 405 });
      if (path === 'factors/isolated-factor/challenge' && method === 'POST') return { id: 'isolated-challenge' };
      throw new Error('Unexpected Auth endpoint: ' + path);
    },
    sessionStorage: { setItem() {}, removeItem() {} },
    history: { replaceState: (_, __, path) => { screens.push(path); } },
    authPage: () => {}, sendDeviceEmail: async () => { calls.push({ path: 'device-email' }); },
    authUI: { fadeOut: async () => {}, deviceNotice: () => {} },
    navigate: path => { navigation.push(path); }
  };
  return { finish: runInNewContext('(' + completion + ')', env), auth, state, calls, navigation, screens };
}

test('password sign-in completes through the supported user endpoint', async () => {
  const f = fixture(); await f.finish(f.auth);
  assert.deepEqual(f.navigation, ['/dashboard']);
  assert.deepEqual(f.calls.map(c => [c.path, c.method, c.token]), [['user', 'GET', f.auth.access_token]]);
});

test('a completed signup session opens subscriptions', async () => {
  const f = fixture(); await f.finish(f.auth, '/subscription');
  assert.deepEqual(f.navigation, ['/subscription']);
});

test('a verified authenticator challenges before opening the workspace', async () => {
  const f = fixture({ factors: [{ id: 'isolated-factor', factor_type: 'totp', status: 'verified' }] });
  await f.finish(f.auth);
  assert.deepEqual(f.navigation, []);
  assert.deepEqual(f.screens, ['/login']);
  assert.equal(f.state.pendingMfa.factorId, 'isolated-factor');
  assert.equal(f.state.pendingMfa.challengeId, 'isolated-challenge');
  assert.deepEqual(f.calls.map(c => [c.path, c.method]), [['user', 'GET'], ['factors/isolated-factor/challenge', 'POST']]);
});

test('an aal2 session and an unverified authenticator do not request a challenge', async () => {
  for (const settings of [
    { aal: 'aal2', factors: [{ id: 'isolated-factor', factor_type: 'totp', status: 'verified' }] },
    { factors: [{ id: 'isolated-factor', factor_type: 'totp', status: 'unverified' }] }
  ]) {
    const f = fixture(settings); await f.finish(f.auth);
    assert.deepEqual(f.navigation, ['/dashboard']);
    assert.equal(f.calls.length, 1);
  }
});

test('ebook destinations survive completed sign-in and unfamiliar-browser checks', async () => {
  const f = fixture({ next: '/ebook' }); await f.finish(f.auth);
  assert.deepEqual(f.navigation, ['/ebook']);
  const g = fixture({ next: '/ebook', device: true }); await g.finish(g.auth);
  assert.deepEqual(g.navigation, []);
  assert.deepEqual(g.screens, ['/verify-device']);
  assert.equal(g.state.deviceDestination, '/ebook');
  assert.deepEqual(g.calls.map(c => c.path), ['device-email']);
});
