import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createApplication } from '../src/app.mjs';
import { createSupabaseApplication } from '../src/supabase-app.mjs';
import { openDatabase } from '../src/database.mjs';
import { EBOOK } from '../src/ebook.mjs';

const pdf = readFileSync(new URL('../public/ebooks/elitebot-strategy-preview.pdf', import.meta.url));
const methodId = '00000000-0000-4000-8000-000000000001';
const method = { id:methodId, name:'Bank transfer', kind:'bank', details:'Test account', network:'', instructions:'', enabled:true };

async function listen(t, app) {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  return `http://127.0.0.1:${app.server.address().port}`;
}

test('ebook payments stay at $50, require approval, isolate buyers, and never activate membership', async t => {
  const db = openDatabase(':memory:');
  const app = createApplication({ db, key:randomBytes(32), ebookPdf:pdf, gateway:null, telegram:null, env:{ APP_ORIGIN:'http://localhost:3000' } });
  const base = await listen(t, app);
  t.after(() => db.close());
  function client() {
    let cookie = '', csrf = '';
    return async (path, method = 'GET', body) => {
      const response = await fetch(base + path, { method,
        headers:{ Cookie:cookie, ...(method === 'GET' ? {} : { 'Content-Type':'application/json', 'X-CSRF-Token':csrf }) },
        body:method === 'GET' ? undefined : JSON.stringify(body || {}) });
      const session = response.headers.getSetCookie().find(value => value.startsWith('elite_session='));
      if (session) cookie = session.split(';')[0];
      const data = (response.headers.get('content-type') || '').includes('application/json') ? await response.json() : Buffer.from(await response.arrayBuffer());
      if (data?.csrf) csrf = data.csrf;
      return { status:response.status, data, headers:response.headers };
    };
  }
  const admin = client(), buyer = client(), other = client();
  async function signup(call, email) {
    const r = await call('/api/auth/signup', 'POST', { name:'Ebook Test', email, password:'Valid password 42!' });
    assert.equal(r.status, 201); return r.data.user;
  }
  const administrator = await signup(admin, 'ebook-admin@example.test');
  db.prepare("UPDATE users SET role='admin',active=1 WHERE id=?").run(administrator.id);
  const user = await signup(buyer, 'ebook-buyer@example.test');
  await signup(other, 'ebook-other@example.test');
  await admin('/api/admin/payment-methods', 'POST', method);
  const available = (await buyer('/api/ebook')).data;
  const selected = available.methods[0].id;
  assert.equal(available.product.priceCents, 5000);
  assert.equal((await buyer('/api/ebook/download')).status, 403);
  assert.equal((await fetch(base + '/api/ebook/download')).status, 401);

  let submitted = await buyer('/api/ebook/orders', 'POST', { methodId:selected, reference:'EBOOK-TRANSACTION-ONE', amount:1, priceCents:100, productId:'another-book', userId:administrator.id });
  assert.equal(submitted.status, 201);
  let order = db.prepare('SELECT * FROM ebook_orders').get();
  assert.equal(order.user_id, user.id);
  assert.equal(order.amount_cents, 5000);
  assert.equal(order.product_id, EBOOK.id);
  assert.equal((await buyer('/api/ebook/download')).status, 403);
  assert.equal((await buyer('/api/ebook/orders', 'POST', { methodId:selected, reference:'SECOND-TRANSACTION' })).status, 409);
  assert.equal((await other('/api/payments', 'POST', { methodId:selected, reference:'ebook-transaction-one' })).status, 409);
  assert.equal((await other('/api/admin/payments/' + order.id + '/review', 'POST', { status:'approved' })).status, 403);
  assert.equal((await admin('/api/admin/payments/' + order.id + '/review', 'POST', { status:'rejected', note:'Funds not received' })).status, 200);
  assert.equal((await buyer('/api/ebook/download')).status, 403);

  submitted = await buyer('/api/ebook/orders', 'POST', { methodId:selected, reference:'EBOOK-TRANSACTION-TWO' });
  assert.equal(submitted.status, 201);
  const overview = (await admin('/api/admin/overview')).data;
  order = overview.payments.find(p => p.id === submitted.data.paymentId);
  assert.equal(order.kind, 'ebook');
  assert.equal((await admin('/api/admin/payments/' + order.id + '/review', 'POST', { status:'approved' })).status, 200);
  assert.equal((await admin('/api/admin/payments/' + order.id + '/review', 'POST', { status:'approved' })).status, 409);
  assert.equal(db.prepare('SELECT active FROM users WHERE id=?').get(user.id).active, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM commissions').get().n, 0);
  const download = await buyer('/api/ebook/download');
  assert.equal(download.status, 200);
  assert.deepEqual(download.data, pdf);
  assert.equal(download.headers.get('cache-control'), 'private, no-store');
  assert.match(download.headers.get('content-disposition'), /attachment; filename="EliteBot_Strategy_Rulebook\.pdf"/);
  assert.equal((await other('/api/ebook/download')).status, 403);
  assert.equal((await buyer('/api/ebook/orders', 'POST', { methodId:selected, reference:'THIRD-TRANSACTION' })).status, 409);
});

test('Supabase ebook API uses caller authority and never accepts client price, product, recipient, or buyer', async t => {
  const orders = new Map(), calls = [];
  const db = {
    authUser:async token => ({ id:token, email:`${token}@example.test`, factors:[] }),
    one:async (table, search, token) => {
      if (table === 'elitetrade_profiles') return { id:token, email:`${token}@example.test`, full_name:'Test', role:'user', disabled:false, active:false };
      if (table === 'elitetrade_payments') {
        assert.match(search, new RegExp(`user_id=eq\.${token}&kind=eq\.ebook`));
        assert.match(search, /status=eq\.approved&amount_cents=eq\.5000/);
        return orders.get(token)?.status === 'approved' ? { id:orders.get(token).id } : null;
      }
      return null;
    },
    query:async (table, search, token) => {
      if (table === 'elitetrade_payment_methods') return [method];
      assert.equal(table, 'elitetrade_payments');
      assert.match(search, new RegExp(`user_id=eq\.${token}&kind=eq\.ebook&product_id=eq\.${EBOOK.id}`));
      return orders.has(token) ? [orders.get(token)] : [];
    },
    rpc:async (name, args, token) => {
      calls.push({ name, args, token });
      if (name === 'elitetrade_ebook_submit_payment') { orders.set(token, { id:'order-1', amount_cents:5000, status:'pending', reference:args.p_reference }); return 'order-1'; }
      if (name === 'elitetrade_ebook_download') return { pdf_base64:pdf.toString('base64'), sha256:createHash('sha256').update(pdf).digest('hex') };
      return null;
    }
  };
  const base = await listen(t, createSupabaseApplication({ db, gateway:null, telegram:null, env:{ APP_ORIGIN:'http://localhost:3000', SUPABASE_URL:'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY:'test' } }));
  const headers = { Authorization:'Bearer buyer', 'Content-Type':'application/json' };
  assert.equal((await fetch(base + '/api/ebook')).status, 401);
  assert.equal((await fetch(base + '/api/ebook/download', { headers })).status, 403);
  const submitted = await fetch(base + '/api/ebook/orders', { method:'POST', headers, body:JSON.stringify({ methodId, reference:'EBOOK-TX', amount:1, priceCents:1, userId:'other', productId:'other', recipient:'wrong-wallet' }) });
  assert.equal(submitted.status, 201);
  assert.deepEqual(calls.find(c => c.name === 'elitetrade_ebook_submit_payment'), { name:'elitetrade_ebook_submit_payment', args:{ p_method_id:methodId, p_reference:'EBOOK-TX' }, token:'buyer' });
  assert.equal((await fetch(base + '/api/ebook/download', { headers })).status, 403);
  orders.get('buyer').status = 'approved';
  const download = await fetch(base + '/api/ebook/download', { headers });
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), pdf);
  assert.deepEqual(calls.find(c => c.name === 'elitetrade_ebook_download'), { name:'elitetrade_ebook_download', args:{}, token:'buyer' });
  assert.equal((await fetch(base + '/api/ebook/download', { headers:{ Authorization:'Bearer other' } })).status, 403);
  assert.equal((await fetch(base + '/api/ebook/orders', { method:'POST', headers, body:JSON.stringify({ methodId, reference:'trc20:reserved' }) })).status, 400);
});

for (const [name, create] of [['local', createApplication], ['supabase', createSupabaseApplication]]) {
  test(`${name} exposes only the free preview and guards the full PDF`, async t => {
    const options = { gateway:null, telegram:null, env:{ APP_ORIGIN:'http://localhost:3000' } };
    if (name === 'local') { options.db = openDatabase(':memory:'); options.key = randomBytes(32); t.after(() => options.db.close()); }
    const base = await listen(t, create(options));
    for (const path of ['/ebook', '/ebook.js', '/ebook.css', EBOOK.previewUrl]) assert.equal((await fetch(base + path)).status, 200, path);
    assert.equal((await fetch(base + '/ebooks/EliteBot_Strategy_Rulebook.pdf')).status, 404);
    assert.equal((await fetch(base + '/api/ebook/download')).status, 401);
  });
}
