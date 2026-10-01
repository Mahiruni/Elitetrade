import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../src/app.mjs';
import { openDatabase } from '../src/database.mjs';
import { decrypt, totp } from '../src/security.mjs';

const PASSWORD = 'Valid password 42!';
async function fixture(t, extras = {}) {
  const db = openDatabase(':memory:');
  const app = createApplication({ db, key:randomBytes(32), env:{APP_ORIGIN:'http://localhost:3000'}, ...extras });
  await new Promise(resolve => app.server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); db.close(); });
  function client() {
    const jar = new Map(); let csrf = '';
    return { jar, async call(path, method = 'GET', body = {}, headers = {}) {
      const response = await fetch(base + path, { method, headers:{ Cookie:[...jar].map(([k,v]) => `${k}=${v}`).join('; '), ...(method === 'GET' ? {} : { 'Content-Type':'application/json', 'X-CSRF-Token':csrf }), ...headers }, body:method === 'GET' ? undefined : JSON.stringify(body) });
      for (const cookie of response.headers.getSetCookie()) { const [key,value] = cookie.split(';')[0].split('='); jar.set(key,value); }
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : await response.text();
      if (data && Object.hasOwn(data,'csrf')) csrf = data.csrf;
      return { status:response.status,data,headers:response.headers };
    } };
  }
  async function signup(c, email, extra = {}) {
    const r = await c.call('/api/auth/signup','POST',{name:'Test Member',email,password:PASSWORD,...extra});
    assert.equal(r.status,201,JSON.stringify(r.data)); return r.data.user;
  }
  async function administrator() {
    const c = client(), u = await signup(c,'admin@example.test');
    db.prepare("UPDATE users SET role='admin',active=1 WHERE id=?").run(u.id);
    return c;
  }
  async function method(admin) {
    assert.equal((await admin.call('/api/admin/payment-methods','POST',{name:'Bank transfer',kind:'bank',details:'Test recipient account',enabled:true})).status,200);
    return (await admin.call('/api/payment-methods')).data.methods[0];
  }
  return { app,db,base,client,signup,administrator,method };
}

test('registration, durable profile, login/logout and CSRF authorization', async t => {
  const f = await fixture(t), member = f.client(), outsider = f.client();
  const u = await f.signup(member,'member@example.test',{password:'  space password 42!  '});
  assert.equal((await member.call('/api/profile','PATCH',{name:'Mahir Aman'})).status,200);
  assert.equal((await member.call('/api/me')).data.user.name,'Mahir Aman');
  assert.equal((await member.call('/api/admin/overview')).status,403);
  assert.equal((await outsider.call('/api/accounts')).status,401);
  assert.equal((await member.call('/api/profile','PATCH',{name:'Wrong'},{'X-CSRF-Token':'wrong'})).status,403);
  assert.equal((await outsider.call('/api/auth/signup','POST',{name:'Bad',email:'x@example.test',password:PASSWORD},{Origin:'https://evil.example'})).status,403);
  assert.equal((await member.call('/api/auth/logout','POST')).status,200);
  assert.equal((await member.call('/api/me')).data.user,null);
  assert.equal((await member.call('/api/auth/login','POST',{email:'member@example.test',password:'space password 42!'})).status,401);
  const signedIn = await member.call('/api/auth/login','POST',{email:'member@example.test',password:'  space password 42!  '});
  assert.equal(signedIn.status,200); assert.equal(signedIn.data.user.id,u.id);
  assert.equal(signedIn.data.user.name,'Mahir Aman');
  assert.equal((await member.call('/api/auth/signup','POST',{name:'Duplicate',email:'member@example.test',password:PASSWORD})).status,409);
  assert.equal((await outsider.call('/api/auth/signup','POST',{name:'Weak',email:'weak@example.test',password:'short'})).status,400);
});

test('password recovery delivers a single-use expiring token and revokes sessions', async t => {
  const sent = [];
  const f = await fixture(t,{mailer:{sendReset:async (email,link) => sent.push({email,link})}});
  const member = f.client(), recovery = f.client(); await f.signup(member,'reset@example.test');
  assert.equal((await recovery.call('/api/auth/forgot-password','POST',{email:'reset@example.test'})).status,200);
  assert.equal(sent.length,1);
  const token = new URLSearchParams(new URL(sent[0].link).hash.slice(1)).get('token');
  assert.equal((await recovery.call('/api/auth/reset-password','POST',{token,password:'Replacement password 42!'})).status,200);
  assert.equal((await member.call('/api/me')).data.user,null);
  assert.equal((await recovery.call('/api/auth/reset-password','POST',{token,password:PASSWORD})).status,400);
  assert.equal((await recovery.call('/api/auth/login','POST',{email:'reset@example.test',password:'Replacement password 42!'})).status,200);
  assert.equal((await recovery.call('/api/auth/password','POST',{currentPassword:'Replacement password 42!',password:'Another new password 42!'})).status,200);
  assert.equal((await recovery.call('/api/me')).data.user,null);
});

test('MFA enrollment, challenge, replay protection and disable change real account security', async t => {
  const f = await fixture(t), member = f.client(); const u = await f.signup(member,'mfa@example.test');
  const setup = await member.call('/api/auth/mfa/enroll','POST'); assert.match(setup.data.qr,/^data:image\/png;base64,/);
  const count = Math.floor(Date.now()/30000), code = totp(setup.data.secret,count);
  assert.equal((await member.call('/api/auth/mfa/enable','POST',{code:'abcdef'})).status,400);
  assert.equal((await member.call('/api/auth/mfa/enable','POST',{code})).status,200);
  assert.equal((await member.call('/api/me')).data.user.mfaEnabled,true);
  await member.call('/api/auth/logout','POST');
  const login = await member.call('/api/auth/login','POST',{email:'mfa@example.test',password:PASSWORD});
  assert.equal(login.data.requiresMfa,true); assert.equal(login.data.user,null);
  assert.equal((await member.call('/api/accounts')).status,401);
  assert.equal((await member.call('/api/auth/mfa/login','POST',{code})).status,400);
  assert.equal((await member.call('/api/auth/mfa/login','POST',{code:totp(setup.data.secret,count+1)})).status,200);
  // Move the last accepted counter back to exercise disable without a real-time wait.
  f.db.prepare('UPDATE users SET mfa_counter=? WHERE id=?').run(count-1,u.id);
  assert.equal((await member.call('/api/auth/mfa/disable','POST',{password:PASSWORD,code})).status,200);
  assert.equal((await member.call('/api/me')).data.user.mfaEnabled,false);
});

test('payment approval activates access exactly once and credits actual referral commissions', async t => {
  const f = await fixture(t), admin = await f.administrator(), method = await f.method(admin);
  const referrer = f.client(); await f.signup(referrer,'referrer@example.test');
  const referral = (await referrer.call('/api/referrals')).data;
  const member = f.client(); await f.signup(member,'buyer@example.test',{referral:referral.code});
  assert.equal((await member.call('/api/accounts','POST',{broker:'Broker',login:'123',server:'Broker-Demo',password:PASSWORD})).status,403);
  assert.equal((await member.call('/api/payments','POST',{methodId:method.id,reference:'txn-12345'})).status,201);
  assert.equal((await member.call('/api/me')).data.user.active,false);
  assert.equal((await member.call('/api/payments','POST',{methodId:method.id,reference:'txn-12345'})).status,409);
  const payment = (await admin.call('/api/admin/overview')).data.payments[0];
  assert.equal((await member.call(`/api/admin/payments/${payment.id}/review`,'POST',{status:'approved'})).status,403);
  assert.equal((await admin.call(`/api/admin/payments/${payment.id}/review`,'POST',{status:'approved',note:'Verified in bank ledger'})).status,200);
  assert.equal((await admin.call(`/api/admin/payments/${payment.id}/review`,'POST',{status:'approved'})).status,409);
  assert.equal((await member.call('/api/me')).data.user.active,true);
  assert.equal((await referrer.call('/api/referrals')).data.earnedCents,2800);
  assert.equal((await referrer.call('/api/referrals/payout','POST')).status,200);
  assert.equal((await referrer.call('/api/referrals/payout','POST')).status,400);
  const payout = (await admin.call('/api/admin/overview')).data.payouts[0];
  assert.equal((await admin.call(`/api/admin/payouts/${payout.id}/review`,'POST',{status:'paid',reference:'bank-out-123'})).status,200);
  assert.equal((await referrer.call('/api/referrals')).data.availableCents,0);
});

test('pool contributions, review status, and reported results persist', async t => {
  const f = await fixture(t), admin = await f.administrator(), method = await f.method(admin), member = f.client();
  const u = await f.signup(member,'pool@example.test'); f.db.prepare('UPDATE users SET active=1 WHERE id=?').run(u.id);
  assert.equal((await admin.call('/api/admin/rounds','POST',{name:'October round',goal:1000,profit:0,status:'open',startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()})).status,200);
  const round = (await member.call('/api/pool')).data.rounds[0];
  assert.equal((await member.call('/api/payments','POST',{kind:'pool',roundId:round.id,methodId:method.id,amount:100,reference:'pool-txn-123'})).status,201);
  assert.equal((await member.call('/api/pool')).data.rounds[0].allocation_cents,0);
  const payment = (await admin.call('/api/admin/overview')).data.payments[0];
  await admin.call(`/api/admin/payments/${payment.id}/review`,'POST',{status:'approved'});
  const updated = (await member.call('/api/pool')).data.rounds[0];
  assert.equal(updated.raised_cents,10000); assert.equal(updated.allocation_cents,10000); assert.equal(updated.traders,1);
});

test('guest and member support is private, persistent, and reply-capable', async t => {
  const f = await fixture(t), admin = await f.administrator(), guest = f.client(), outsider = f.client();
  const start = await guest.call('/api/support','POST',{name:'Guest customer',email:'guest@example.test'}); assert.equal(start.status,201);
  const chat = start.data.id;
  assert.equal((await guest.call(`/api/support/${chat}/messages`,'POST',{message:'Please help with activation.'})).status,201);
  assert.equal((await outsider.call(`/api/support/${chat}`)).status,404);
  assert.equal((await outsider.call('/api/support')).data.conversations.length,0);
  assert.equal((await admin.call('/api/admin/support')).data.conversations.length,1);
  assert.equal((await admin.call(`/api/support/${chat}/messages`,'POST',{message:'We received your request.'})).status,201);
  const messages = (await guest.call(`/api/support/${chat}`)).data.messages;
  assert.equal(messages.length,2); assert.equal(messages[1].sender,'admin');
  assert.equal((await admin.call(`/api/support/${chat}/close`,'POST')).status,200);
  assert.equal((await guest.call(`/api/support/${chat}/messages`,'POST',{message:'Closed?'})).status,409);
});

test('missing integrations fail clearly without pretending email or trading succeeded', async t => {
  const f = await fixture(t), admin = await f.administrator(), member = f.client();
  const u = await f.signup(member,'no-gateway@example.test'); f.db.prepare('UPDATE users SET active=1 WHERE id=?').run(u.id);
  assert.equal((await member.call('/api/auth/forgot-password','POST',{email:u.email})).status,503);
  assert.equal((await member.call('/api/accounts','POST',{broker:'Test Broker',login:'12345',server:'Demo',password:PASSWORD})).status,201);
  const account = (await member.call('/api/accounts')).data.accounts[0]; assert.equal(account.status,'pending'); assert.equal(account.password_encrypted,undefined);
  assert.equal((await admin.call(`/api/admin/accounts/${account.id}/review`,'POST',{decision:'approve'})).status,503);
  const bot = (await member.call('/api/bots')).data.bots[0];
  assert.equal((await member.call(`/api/bots/${bot.id}/control`,'POST',{running:true})).status,503);
  assert.equal((await member.call('/api/bots')).data.bots[0].status,'stopped');
  const encrypted = f.db.prepare('SELECT password_encrypted FROM accounts WHERE id=?').get(account.id).password_encrypted;
  assert.notEqual(encrypted,PASSWORD); assert.equal(decrypt(encrypted,f.app.key),PASSWORD);
});

test('gateway contract requires acknowledgments, preserves stopping after deactivation, and isolates accounts', async t => {
  let connected = false, rejectControl = false, controls = [];
  const gateway = { connect:async a => { assert.equal(a.password,PASSWORD); connected = true; return {accountId:'gateway-id',connected:true}; }, snapshot:async () => ({connected,balance:1250,equity:1240,currency:'USD'}), botState:async () => { if (rejectControl) throw new Error('Network timeout'); return {running:controls.at(-1) || false}; }, disconnect:async () => { connected = false; return {disconnected:true}; }, control:async (accountId,bot,running) => { controls.push(running); if (rejectControl) throw new Error('Network timeout'); return {running}; } };
  const f = await fixture(t,{gateway}), admin = await f.administrator(), member = f.client(), outsider = f.client();
  const u = await f.signup(member,'trader@example.test'); await f.signup(outsider,'other@example.test'); f.db.prepare('UPDATE users SET active=1 WHERE id=?').run(u.id);
  await member.call('/api/accounts','POST',{broker:'Broker',login:'12345',server:'Broker-Demo',password:PASSWORD});
  const account = (await member.call('/api/accounts')).data.accounts[0];
  assert.equal((await outsider.call(`/api/accounts/${account.id}`,'DELETE')).status,404);
  assert.equal((await admin.call(`/api/admin/accounts/${account.id}/review`,'POST',{decision:'approve'})).status,200);
  assert.equal((await member.call('/api/accounts')).data.accounts[0].snapshot.balance,1250);
  const bot = (await member.call('/api/bots')).data.bots[0];
  const config = {accountId:account.id,name:'Configured bot',strategy:'trend',symbol:'XAUUSD',riskPercent:1,stopLoss:1,takeProfit:2,maxDrawdown:10,dailyLoss:3,lotSize:.01};
  assert.equal((await member.call(`/api/bots/${bot.id}`,'PATCH',config)).status,200);
  assert.equal((await outsider.call(`/api/bots/${bot.id}`,'PATCH',config)).status,404);
  assert.equal((await member.call(`/api/bots/${bot.id}/control`,'POST',{running:true})).status,200);
  assert.equal((await member.call(`/api/bots/${bot.id}`,'PATCH',config)).status,409);
  assert.equal((await member.call(`/api/accounts/${account.id}`,'DELETE')).status,409);
  f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(u.id);
  assert.equal((await member.call(`/api/bots/${bot.id}/control`,'POST',{running:false})).status,200);
  assert.equal((await member.call(`/api/bots/${bot.id}/control`,'POST',{running:true})).status,403);
  f.db.prepare('UPDATE users SET active=1 WHERE id=?').run(u.id); rejectControl = true;
  assert.equal((await member.call(`/api/bots/${bot.id}/control`,'POST',{running:true})).status,502);
  assert.equal((await member.call('/api/bots')).data.bots[0].status,'unknown');
  rejectControl = false;
  await member.call(`/api/bots/${bot.id}/control`,'POST',{running:false});
  assert.equal((await member.call(`/api/accounts/${account.id}`,'DELETE')).status,200);
  assert.equal((await member.call('/api/bots')).data.bots[0].account_id,null);
  assert.deepEqual(controls,[true,false,true,false]);
});

test('source routes, static assets and headers load; unknown routes do not serve the app', async t => {
  const f = await fixture(t), c = f.client();
  for (const path of ['/','/login','/signup','/forgot-password','/reset-password','/logout','/mt5','/dashboard','/bots','/subscription','/subscribe','/pool','/referrals','/settings','/support','/admin','/admin/support','/app.js','/styles.css','/favicon.svg']) {
    const r = await c.call(path); assert.equal(r.status,200,path); assert.equal(r.headers.get('x-content-type-options'),'nosniff');
  }
  assert.equal((await c.call('/.env')).status,404);
  assert.equal((await c.call('/missing')).status,404);
  assert.equal((await c.call('/api/not-real')).status,404);
});

test('accounts and settings survive a real database close and reopen', async t => {
  const dir = mkdtempSync(join(tmpdir(),'elite-persistence-')), path = join(dir,'data.sqlite');
  t.after(() => rmSync(dir,{recursive:true,force:true}));
  const db = openDatabase(path); db.prepare("UPDATE settings SET value='19500' WHERE key='price_cents'").run(); db.close();
  const reopened = openDatabase(path); assert.equal(reopened.prepare("SELECT value FROM settings WHERE key='price_cents'").get().value,'19500'); reopened.close();
});

test('hosted account review retains pending binding, retries approval and rejects trading', async t => {
  let ready=false, controls=0, removals=0;
  const gateway={mode:'account-data',tradingEnabled:false,
    connect:async a=>({accountId:`metaapi:${a.accountId}:remote`,connected:ready,pending:!ready}),
    snapshot:async()=>({connected:true,balance:100,equity:100,currency:'USD'}),
    control:async()=>{controls++;return {running:true};},
    disconnect:async()=>{removals++;return {disconnected:true};}};
  const f=await fixture(t,{gateway}),admin=await f.administrator(),member=f.client(),outsider=f.client();
  const u=await f.signup(member,'hosted@example.test');await f.signup(outsider,'outsider@example.test');
  f.db.prepare('UPDATE users SET active=1 WHERE id=?').run(u.id);
  await member.call('/api/accounts','POST',{broker:'Broker',login:'12345',server:'Broker-Live',password:PASSWORD});
  const account=(await member.call('/api/accounts')).data.accounts[0];
  const review=`/api/admin/accounts/${account.id}/review`;
  assert.equal((await member.call(review,'POST',{decision:'approve'})).status,403);
  assert.equal((await admin.call(review,'POST',{decision:'approve'})).status,200);
  assert.equal(f.db.prepare('SELECT status FROM accounts WHERE id=?').get(account.id).status,'pending');
  ready=true;
  assert.equal((await admin.call(review,'POST',{decision:'approve'})).status,200);
  assert.equal(f.db.prepare('SELECT status FROM accounts WHERE id=?').get(account.id).status,'connected');
  assert.equal((await outsider.call('/api/accounts')).data.accounts.length,0);
  const config=(await member.call('/api/config')).data;assert.equal(config.tradingEnabled,false);
  const bot=(await member.call('/api/bots')).data.bots[0];
  assert.equal((await member.call(`/api/bots/${bot.id}/control`,'POST',{running:true})).status,503);
  assert.equal(controls,0);
  assert.equal((await member.call(`/api/accounts/${account.id}`,'DELETE')).status,200);assert.equal(removals,1);
});
