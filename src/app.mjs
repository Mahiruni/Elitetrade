import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import QRCode from 'qrcode';
import { openDatabase, transaction } from './database.mjs';
import { token, digest, hashPassword, verifyPassword, encrypt, decrypt, base32, verifyTotp, cookies } from './security.mjs';
import { createMailer, createGateway, createTelegram } from './services.mjs';

const now = () => Date.now();
const id = () => randomUUID();
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const string = (value, label, min = 1, max = 300) => {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) fail(400, `${label} must be ${min}–${max} characters.`);
  return value.trim();
};
const emailValue = (value) => {
  const email = string(value, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) fail(400, 'Enter a valid email address.');
  return email;
};
const passwordValue = value => { if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'Use a password with 12–128 characters.'); return value; };
const credential = (value, label = 'Password') => { if (typeof value !== 'string' || !value.length || value.length > 128) fail(400, `${label} must be 1–128 characters.`); return value; };
const number = (value, label, min, max) => { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) fail(400, `${label} must be between ${min} and ${max}.`); return n; };
const cents = (value) => Math.round(number(value, 'Amount', 1, 10000000) * 100);
const choice = (value, values, label) => { if (!values.includes(value)) fail(400, `Choose a valid ${label}.`); return value; };
const publicUser = u => u ? { id: u.id, email: u.email, name: u.name, role: u.role, active: !!u.active, mfaEnabled: !!u.mfa_secret, createdAt: u.created_at } : null;
const publicAccount = ({ password_encrypted, gateway_id, ...safe }) => safe;

export function createApplication(options = {}) {
  const env = options.env || process.env;
  const production = env.NODE_ENV === 'production';
  if (production && !env.APP_ORIGIN) throw new Error('APP_ORIGIN is required in production');
  const origin = new URL(env.APP_ORIGIN || 'http://localhost:3000').origin;
  if (production && !origin.startsWith('https://')) throw new Error('Production APP_ORIGIN must use HTTPS');
  const dbPath = env.SQLITE_PATH || './data/elitetrade.sqlite';
  const db = options.db || openDatabase(dbPath);
  let key = options.key || (env.ENCRYPTION_KEY ? Buffer.from(env.ENCRYPTION_KEY, 'base64') : null);
  if (!key) {
    if (production) throw new Error('ENCRYPTION_KEY is required in production');
    const keyPath = join(dirname(resolve(dbPath)), '.encryption-key'); mkdirSync(dirname(keyPath), { recursive: true, mode: 0o700 });
    if (existsSync(keyPath)) key = Buffer.from(readFileSync(keyPath, 'utf8'), 'base64');
    else { key = randomBytes(32); writeFileSync(keyPath, key.toString('base64'), { mode: 0o600 }); }
  }
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  const mailer = options.mailer === undefined ? createMailer(env) : options.mailer;
  const gateway = options.gateway === undefined ? createGateway(env) : options.gateway;
  const telegram = options.telegram === undefined ? createTelegram(env) : options.telegram;
  const clients = new Set();
  let tradingMutation = false;
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const setting = name => get('SELECT value FROM settings WHERE key=?', name)?.value;
  const setSetting = (name, value) => run('INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', name, String(value));
  const audit = (actor, action, target) => run('INSERT INTO audit_log VALUES (?,?,?,?,?)', id(), actor, action, target, now());
  const cookie = (res, name, value, seconds) => {
    const existing = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...existing, `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${origin.startsWith('https:') ? '; Secure' : ''}`]);
  };
  const newSession = (res, user, verified = true) => {
    const raw = token(), csrf = token();
    run('INSERT INTO sessions VALUES (?,?,?,?,?,?)', digest(raw), user.id, csrf, verified ? 1 : 0, now() + (verified ? 86400000 : 300000), now());
    cookie(res, 'elite_session', raw, verified ? 86400 : 300);
    return csrf;
  };
  const readSession = req => {
    const raw = cookies(req.headers.cookie).elite_session;
    if (!raw) return null;
    const session = get('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?', digest(raw), now());
    if (!session) return null;
    const user = get('SELECT * FROM users WHERE id=? AND disabled=0', session.user_id);
    return user ? { session, user } : null;
  };
  const needUser = context => { if (!context?.session.verified) fail(401, 'Sign in to continue.'); return context.user; };
  const needAdmin = context => { const u = needUser(context); if (u.role !== 'admin') fail(403, 'Administrator access is required.'); return u; };
  const activeUser = context => { const u = needUser(context); if (!u.active && u.role !== 'admin') fail(403, 'Activate your subscription first.'); return u; };
  const own = (table, value, user) => { const row = get(`SELECT * FROM ${table} WHERE id=? AND user_id=?`, value, user.id); if (!row) fail(404, 'Record not found.'); return row; };
  const rateLimit = (name, max = 20, windowMs = 60000) => {
    const start = Math.floor(now() / windowMs) * windowMs;
    run('INSERT INTO rate_limits VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN window=excluded.window THEN hits+1 ELSE 1 END, window=excluded.window', name, start);
    if (get('SELECT hits FROM rate_limits WHERE key=?', name).hits > max) fail(429, 'Too many attempts. Please wait and try again.');
  };
  const broadcast = (userId = null, guestHash = null) => {
    for (const client of clients) if (client.role === 'admin' || (userId && client.userId === userId) || (guestHash && client.guestHash === guestHash)) client.res.write('event: refresh\ndata: {}\n\n');
  };
  const notifyAdmin = text => { const chat = setting('telegram_chat'); if (telegram && chat) telegram(chat, text).catch(() => console.error('Telegram notification delivery failed')); };
  const json = (res, value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  const safeBody = async req => {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Use JSON for this request.');
    let bytes = 0, chunks = [];
    for await (const part of req) { bytes += part.length; if (bytes > 65536) fail(413, 'The request is too large.'); chunks.push(part); }
    try { const data = JSON.parse(Buffer.concat(chunks).toString()); if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Invalid JSON object.'); return data; }
    catch (error) { if (error.status) throw error; fail(400, 'Invalid JSON.'); }
  };
  const paymentMethods = () => all('SELECT * FROM payment_methods WHERE enabled=1 ORDER BY created_at');
  const canReadChat = (chat, context, guest) => context?.session.verified && (context.user.role === 'admin' || chat.user_id === context.user.id) || guest && chat.guest_hash === digest(guest);
  const safeSnapshot = snapshot => {
    if (typeof snapshot !== 'object' || snapshot === null || typeof snapshot.connected !== 'boolean') fail(502, 'The gateway returned an invalid account response.');
    const data = { connected: snapshot.connected, currency: /^[A-Z]{3}$/.test(snapshot.currency || '') ? snapshot.currency : 'USD', updatedAt: now() };
    for (const name of ['balance','equity','profit']) if (Number.isFinite(snapshot[name])) data[name] = snapshot[name];
    data.history = Array.isArray(snapshot.history) ? snapshot.history.slice(-100).filter(p => Number.isFinite(p.value) && Number.isFinite(p.time)).map(p => ({ value: p.value, time: p.time })) : [];
    return data;
  };

  async function handleApi(req, res, url, context, body) {
    const path = url.pathname, method = req.method, guest = cookies(req.headers.cookie).elite_guest;
    const ip = env.TRUST_PROXY === 'true' ? String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() : req.socket.remoteAddress;
    if (method !== 'GET') rateLimit(`write:${ip}`, 90);
    if (path === '/api/config' && method === 'GET') return json(res, { priceCents: Number(setting('price_cents')), emailConfigured: !!mailer, gatewayConfigured: !!gateway, telegramConfigured: !!telegram });
    if (path === '/api/me' && method === 'GET') return json(res, { user: context?.session.verified ? publicUser(context.user) : null, requiresMfa: !!context && !context.session.verified, csrf: context?.session.csrf || null });
    if (path === '/api/auth/signup' && method === 'POST') {
      rateLimit(`signup:${ip}`, 10, 900000);
      const email = emailValue(body.email), password = passwordValue(body.password), name = string(body.name, 'Name', 2, 64);
      if (get('SELECT id FROM users WHERE email=?', email)) fail(409, 'An account with this email already exists.');
      const referrer = body.referral ? get('SELECT id FROM users WHERE referral_code=?', string(body.referral, 'Referral code', 3, 30).toUpperCase()) : null;
      if (body.referral && !referrer) fail(400, 'That referral code was not found.');
      const userId = id(), hash = await hashPassword(password);
      transaction(db, () => {
        run('INSERT INTO users (id,email,name,password_hash,referral_code,referrer_id,created_at) VALUES (?,?,?,?,?,?,?)', userId, email, name, hash, randomBytes(6).toString('hex').toUpperCase(), referrer?.id || null, now());
        run('INSERT INTO bots (id,user_id,name,strategy,symbol,risk_percent,stop_loss,take_profit,max_drawdown,daily_loss,lot_size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', id(), userId, 'Elite Bot', 'trend', 'XAUUSD', 1, 1, 2, 10, 3, 0.01, now());
      });
      const user = get('SELECT * FROM users WHERE id=?', userId); const csrf = newSession(res, user);
      return json(res, { user: publicUser(user), csrf }, 201);
    }
    if (path === '/api/auth/demo' && method === 'POST') {
      if (env.DEMO_MODE !== 'true') fail(404, 'Demo access is disabled.');
      let user = get("SELECT * FROM users WHERE email='demo@elitetrade.local' AND disabled=0");
      if (!user) {
        const userId = id();
        transaction(db, () => {
          run('INSERT INTO users (id,email,name,password_hash,role,active,disabled,referral_code,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
            userId, 'demo@elitetrade.local', 'Demo Trader', 'demo-only-no-password', 'user', 1, 0, randomBytes(6).toString('hex').toUpperCase(), now());
          run('INSERT INTO bots (id,user_id,name,strategy,symbol,risk_percent,stop_loss,take_profit,max_drawdown,daily_loss,lot_size,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            id(), userId, 'Elite Bot', 'trend', 'XAUUSD', 1, 1, 2, 10, 3, 0.01, now());
        });
        user = get('SELECT * FROM users WHERE id=?', userId);
      }
      const csrf = newSession(res, user);
      return json(res, { user: publicUser(user), csrf, demo: true });
    }
    if (path === '/api/auth/login' && method === 'POST') {
      rateLimit(`login:${ip}`, 10, 900000);
      const email = emailValue(body.email), password = credential(body.password);
      rateLimit(`login-email:${digest(email)}`, 10, 900000);
      const user = get('SELECT * FROM users WHERE email=? AND disabled=0', email);
      // Do a real password derivation for missing accounts to reduce timing disclosure.
      const valid = await verifyPassword(password, user?.password_hash || 'scrypt:00000000000000000000000000000000:' + '0'.repeat(128));
      if (!user || !valid) fail(401, 'Email or password is incorrect.');
      if (context) run('DELETE FROM sessions WHERE token_hash=?', context.session.token_hash);
      const csrf = newSession(res, user, !user.mfa_secret);
      return json(res, { user: user.mfa_secret ? null : publicUser(user), requiresMfa: !!user.mfa_secret, csrf });
    }
    if (path === '/api/auth/mfa/login' && method === 'POST') {
      if (!context || context.session.verified || !context.user.mfa_secret) fail(401, 'Start a new sign-in attempt.');
      rateLimit(`mfa:${context.user.id}`, 5, 300000);
      const counter = verifyTotp(decrypt(context.user.mfa_secret, key), String(body.code), context.user.mfa_counter);
      if (counter === null) fail(400, 'The code is invalid, expired, or already used.');
      run('UPDATE users SET mfa_counter=? WHERE id=?', counter, context.user.id);
      run('DELETE FROM sessions WHERE token_hash=?', context.session.token_hash);
      const csrf = newSession(res, context.user); return json(res, { user: publicUser(context.user), csrf });
    }
    if (path === '/api/auth/logout' && method === 'POST') {
      if (context) run('DELETE FROM sessions WHERE token_hash=?', context.session.token_hash);
      cookie(res, 'elite_session', '', 0); return json(res, { ok: true });
    }
    if (path === '/api/auth/forgot-password' && method === 'POST') {
      rateLimit(`reset:${ip}`, 5, 900000);
      const email = emailValue(body.email);
      if (!mailer) fail(503, 'Password recovery is unavailable until email delivery is configured. Contact your administrator.');
      const user = get('SELECT id FROM users WHERE email=? AND disabled=0', email);
      if (user) {
        const raw = token();
        transaction(db, () => { run('DELETE FROM reset_tokens WHERE user_id=?', user.id); run('INSERT INTO reset_tokens VALUES (?,?,?)', digest(raw), user.id, now() + 1800000); });
        try { await mailer.sendReset(email, `${origin}/reset-password#token=${encodeURIComponent(raw)}`); }
        catch { run('DELETE FROM reset_tokens WHERE token_hash=?', digest(raw)); fail(503, 'Email delivery is temporarily unavailable. Please try again later.'); }
      }
      return json(res, { message: 'If this account exists, a recovery link has been sent.' });
    }
    if (path === '/api/auth/reset-password' && method === 'POST') {
      rateLimit(`reset-confirm:${ip}`, 10, 900000);
      const raw = string(body.token, 'Reset token', 20, 128), password = passwordValue(body.password);
      const reset = get('SELECT * FROM reset_tokens WHERE token_hash=? AND expires_at>?', digest(raw), now());
      if (!reset) fail(400, 'This reset link has expired or has already been used.');
      const hash = await hashPassword(password);
      transaction(db, () => { const consumed = run('DELETE FROM reset_tokens WHERE token_hash=? AND expires_at>?', digest(raw), now()); if (!consumed.changes) fail(400, 'This reset link is no longer valid.'); run('UPDATE users SET password_hash=? WHERE id=?', hash, reset.user_id); run('DELETE FROM sessions WHERE user_id=?', reset.user_id); });
      cookie(res, 'elite_session', '', 0); return json(res, { ok: true });
    }
    if (path === '/api/profile' && method === 'PATCH') {
      const user = needUser(context), name = string(body.name, 'Name', 2, 64);
      run('UPDATE users SET name=? WHERE id=?', name, user.id); return json(res, { user: publicUser(get('SELECT * FROM users WHERE id=?', user.id)) });
    }
    if (path === '/api/auth/password' && method === 'POST') {
      const user = needUser(context); rateLimit(`password:${user.id}`, 5, 900000);
      if (!await verifyPassword(credential(body.currentPassword, 'Current password'), user.password_hash)) fail(400, 'Current password is incorrect.');
      if (user.mfa_secret) {
        const counter = verifyTotp(decrypt(user.mfa_secret, key), String(body.code), user.mfa_counter);
        if (counter === null) fail(400, 'Enter a fresh authenticator code.');
        run('UPDATE users SET mfa_counter=? WHERE id=?', counter, user.id);
      }
      const hash = await hashPassword(passwordValue(body.password));
      transaction(db, () => { run('UPDATE users SET password_hash=? WHERE id=?', hash, user.id); run('DELETE FROM sessions WHERE user_id=?', user.id); run('DELETE FROM reset_tokens WHERE user_id=?', user.id); });
      cookie(res, 'elite_session', '', 0); return json(res, { ok: true });
    }
    if (path === '/api/auth/mfa/enroll' && method === 'POST') {
      const user = needUser(context); if (user.mfa_secret) fail(409, 'Two-factor authentication is already enabled.');
      const secret = base32(randomBytes(20)); run('UPDATE users SET mfa_pending=? WHERE id=?', encrypt(secret, key), user.id);
      const uri = `otpauth://totp/EliteBot:${encodeURIComponent(user.email)}?secret=${secret}&issuer=EliteBot&digits=6&period=30`;
      return json(res, { secret, qr: await QRCode.toDataURL(uri, { width: 240, margin: 2 }) });
    }
    if (path === '/api/auth/mfa/enable' && method === 'POST') {
      const user = needUser(context); if (!user.mfa_pending || user.mfa_secret) fail(400, 'Start authenticator setup first.');
      rateLimit(`mfa-enable:${user.id}`, 5, 300000);
      const counter = verifyTotp(decrypt(user.mfa_pending, key), String(body.code)); if (counter === null) fail(400, 'Enter the current six-digit authenticator code.');
      transaction(db, () => { run('UPDATE users SET mfa_secret=mfa_pending,mfa_pending=NULL,mfa_counter=? WHERE id=?', counter, user.id); run('DELETE FROM sessions WHERE user_id=? AND token_hash<>?', user.id, context.session.token_hash); });
      return json(res, { ok: true });
    }
    if (path === '/api/auth/mfa/disable' && method === 'POST') {
      const user = needUser(context); rateLimit(`mfa-disable:${user.id}`, 5, 300000);
      if (!user.mfa_secret || !await verifyPassword(credential(body.password), user.password_hash) || verifyTotp(decrypt(user.mfa_secret, key), String(body.code), user.mfa_counter) === null) fail(400, 'Enter your password and a fresh authenticator code.');
      run('UPDATE users SET mfa_secret=NULL,mfa_pending=NULL,mfa_counter=-1 WHERE id=?', user.id); return json(res, { ok: true });
    }
    if (path === '/api/payment-methods' && method === 'GET') return json(res, { methods: paymentMethods(), priceCents: Number(setting('price_cents')) });
    if (path === '/api/payments' && method === 'GET') { const user = needUser(context); return json(res, { payments: all('SELECT id,kind,round_id,reference,amount_cents,status,note,created_at FROM payments WHERE user_id=? ORDER BY created_at DESC', user.id) }); }
    if (path === '/api/payments' && method === 'POST') {
      const user = needUser(context); rateLimit(`payment:${user.id}`, 10, 900000);
      const paymentMethod = get('SELECT * FROM payment_methods WHERE id=? AND enabled=1', string(body.methodId, 'Payment method', 1, 100)); if (!paymentMethod) fail(400, 'Choose an available payment method.');
      const reference = string(body.reference, 'Transaction reference', 6, 200).replace(/\s/g, '').toLowerCase();
      if (get('SELECT id FROM payments WHERE reference=?', reference)) fail(409, 'This transaction reference has already been submitted.');
      const kind = choice(body.kind || 'subscription', ['subscription','pool'], 'payment type'); let amount = Number(setting('price_cents')), round = null;
      if (kind === 'subscription' && user.active) fail(409, 'Your lifetime subscription is already active.');
      if (kind === 'subscription' && get("SELECT id FROM payments WHERE user_id=? AND kind='subscription' AND status='pending'", user.id)) fail(409, 'Your subscription payment is already awaiting review.');
      if (kind === 'pool') { activeUser(context); round = get("SELECT * FROM pool_rounds WHERE id=? AND status='open' AND starts_at<=? AND ends_at>?", string(body.roundId, 'Pool round', 1, 100), now(), now()); if (!round) fail(400, 'This pool round is not open for contributions.'); amount = cents(body.amount); }
      run('INSERT INTO payments (id,user_id,method_id,reference,amount_cents,kind,round_id,method_snapshot,created_at) VALUES (?,?,?,?,?,?,?,?,?)', id(), user.id, paymentMethod.id, reference, amount, kind, round?.id || null, JSON.stringify(paymentMethod), now());
      broadcast(user.id); notifyAdmin(`New ${kind} payment submitted for review: ${user.email}. Verify funds before approval.`);
      return json(res, { ok: true, message: 'Payment submitted for administrator verification.' }, 201);
    }
    if (path === '/api/referrals' && method === 'GET') {
      const user = needUser(context);
      const earned = get('SELECT COALESCE(SUM(amount_cents),0) AS amount FROM commissions WHERE user_id=?', user.id).amount;
      const reserved = get("SELECT COALESCE(SUM(amount_cents),0) AS amount FROM payouts WHERE user_id=? AND status IN ('pending','paid')", user.id).amount;
      return json(res, { code: user.referral_code, link: `${origin}/signup?ref=${user.referral_code}`, earnedCents: earned, availableCents: earned - reserved,
        team: all('SELECT u.name,u.created_at,COALESCE(SUM(c.amount_cents),0) AS earned_cents FROM users u LEFT JOIN commissions c ON c.referred_id=u.id AND c.user_id=? WHERE u.referrer_id=? GROUP BY u.id ORDER BY u.created_at DESC', user.id, user.id), payouts: all('SELECT * FROM payouts WHERE user_id=? ORDER BY created_at DESC', user.id) });
    }
    if (path === '/api/referrals/payout' && method === 'POST') {
      const user = needUser(context);
      transaction(db, () => { const earned = get('SELECT COALESCE(SUM(amount_cents),0) AS n FROM commissions WHERE user_id=?', user.id).n;
        const reserved = get("SELECT COALESCE(SUM(amount_cents),0) AS n FROM payouts WHERE user_id=? AND status IN ('pending','paid')", user.id).n;
        if (earned - reserved < 100) fail(400, 'There are no available earnings to request.');
        run('INSERT INTO payouts (id,user_id,amount_cents,created_at) VALUES (?,?,?,?)', id(), user.id, earned - reserved, now()); });
      return json(res, { ok: true });
    }
    if (path === '/api/pool' && method === 'GET') {
      const user = needUser(context); return json(res, { rounds: all(`SELECT r.*,COALESCE(SUM(CASE WHEN p.status='approved' THEN p.amount_cents ELSE 0 END),0) AS raised_cents,
        COUNT(DISTINCT CASE WHEN p.status='approved' THEN p.user_id END) AS traders,
        COALESCE(SUM(CASE WHEN p.status='approved' AND p.user_id=? THEN p.amount_cents ELSE 0 END),0) AS allocation_cents
        FROM pool_rounds r LEFT JOIN payments p ON p.round_id=r.id GROUP BY r.id ORDER BY r.created_at DESC`, user.id) });
    }
    if (path === '/api/accounts' && method === 'GET') {
      const user = needUser(context), rows = all('SELECT * FROM accounts WHERE user_id=? ORDER BY created_at DESC', user.id), result = [];
      for (const account of rows) {
        const safe = publicAccount(account);
        if (gateway && account.gateway_id && ['connected','unknown','disconnected'].includes(account.status)) {
          try { safe.snapshot = safeSnapshot(await gateway.snapshot(account.gateway_id)); safe.status = safe.snapshot.connected ? 'connected' : 'disconnected'; run('UPDATE accounts SET status=? WHERE id=?', safe.status, account.id); }
          catch { safe.status = 'unknown'; safe.note = 'The gateway is unavailable. Connection status cannot be confirmed.'; run("UPDATE accounts SET status='unknown' WHERE id=?", account.id); }
        }
        result.push(safe);
      }
      return json(res, { accounts: result, gatewayConfigured: !!gateway });
    }
    if (path === '/api/accounts' && method === 'POST') {
      const user = activeUser(context), broker = string(body.broker, 'Broker', 2, 100), login = string(body.login, 'MT5 login', 1, 30), server = string(body.server, 'MT5 server', 2, 100), password = credential(body.password, 'MT5 password');
      if (!/^\d+$/.test(login)) fail(400, 'MT5 login must contain only digits.');
      if (get('SELECT id FROM accounts WHERE user_id=? AND login=? AND server=?', user.id, login, server)) fail(409, 'This account is already saved.');
      run('INSERT INTO accounts (id,user_id,broker,login,server,password_encrypted,created_at) VALUES (?,?,?,?,?,?,?)', id(), user.id, broker, login, server, encrypt(password, key), now());
      broadcast(user.id); return json(res, { ok: true, message: 'MT5 details saved for administrator review. Connection is not active yet.' }, 201);
    }
    const accountDelete = path.match(/^\/api\/accounts\/([^/]+)$/);
    if (accountDelete && method === 'DELETE') {
      const user = needUser(context), account = own('accounts', accountDelete[1], user);
      if (get("SELECT id FROM bots WHERE account_id=? AND status<>'stopped'", account.id)) fail(409, 'Confirm that every bot is stopped before removing this account.');
      if (account.gateway_id) { if (!gateway) fail(503, 'Reconnect the gateway before removing this account.'); const ack = await gateway.disconnect(account.gateway_id); if (ack.disconnected !== true) fail(502, 'The gateway did not confirm disconnection.'); }
      transaction(db, () => { run('UPDATE bots SET account_id=NULL WHERE account_id=?', account.id); run('DELETE FROM accounts WHERE id=?', account.id); }); return json(res, { ok: true });
    }
    if (path === '/api/bots' && method === 'GET') {
      const user = needUser(context), bots = all('SELECT * FROM bots WHERE user_id=? ORDER BY created_at', user.id);
      for (const bot of bots) {
        if (bot.status === 'stopped' || tradingMutation) continue;
        const account = get('SELECT gateway_id FROM accounts WHERE id=?', bot.account_id);
        try {
          if (!gateway?.botState || !account?.gateway_id) throw new Error('Gateway unavailable');
          const status = await gateway.botState(account.gateway_id, bot.id);
          if (typeof status?.running !== 'boolean') throw new Error('Invalid bot state');
          bot.status = status.running ? 'running' : 'stopped';
        } catch { bot.status = 'unknown'; }
        // Do not let a concurrent read overwrite an in-flight command.
        if (!tradingMutation) run('UPDATE bots SET status=? WHERE id=?', bot.status, bot.id);
      }
      return json(res, { bots });
    }
    const botSave = path.match(/^\/api\/bots\/([^/]+)$/);
    if (botSave && method === 'PATCH') {
      const user = needUser(context), bot = own('bots', botSave[1], user); if (bot.status !== 'stopped') fail(409, 'Stop the bot before changing its configuration.');
      const account = body.accountId ? own('accounts', body.accountId, user) : null;
      const name = string(body.name, 'Bot name', 2, 64), strategy = choice(body.strategy, ['trend','scalping','breakout'], 'strategy'), symbol = string(body.symbol, 'Symbol', 3, 30).toUpperCase();
      if (!/^[A-Z0-9._-]+$/.test(symbol)) fail(400, 'Enter a valid broker symbol.');
      const risk = number(body.riskPercent, 'Risk', 0.1, 5), sl = number(body.stopLoss, 'Stop loss', 0.1, 20), tp = number(body.takeProfit, 'Take profit', 0.1, 50), draw = number(body.maxDrawdown, 'Drawdown', 1, 30), daily = number(body.dailyLoss, 'Daily loss', 0.1, 10), lot = number(body.lotSize, 'Lot size', 0.01, 10);
      run('UPDATE bots SET account_id=?,name=?,strategy=?,symbol=?,risk_percent=?,stop_loss=?,take_profit=?,max_drawdown=?,daily_loss=?,lot_size=? WHERE id=?', account?.id || null, name, strategy, symbol, risk, sl, tp, draw, daily, lot, bot.id); return json(res, { ok: true });
    }
    const botControl = path.match(/^\/api\/bots\/([^/]+)\/control$/);
    if (botControl && method === 'POST') {
      const user = needUser(context), bot = own('bots', botControl[1], user);
      if (typeof body.running !== 'boolean') fail(400, 'Choose start or stop.');
      // Stopping remains available after a subscription is revoked.
      if (body.running) activeUser(context);
      if (!gateway) fail(503, 'Live trading requires a configured MT5 gateway.');
      if (!bot.account_id) fail(409, 'Select an MT5 account in the bot configuration first.');
      const account = own('accounts', bot.account_id, user); if (!account.gateway_id || body.running && account.status !== 'connected') fail(409, 'Confirm the MT5 connection first.');
      if (body.running) { let snapshot; try { snapshot = safeSnapshot(await gateway.snapshot(account.gateway_id)); } catch { fail(502, 'The MT5 gateway could not verify this account.'); } if (!snapshot.connected) fail(409, 'The MT5 gateway reports that this account is disconnected.'); }
      try {
        const ack = await gateway.control(account.gateway_id, bot, body.running);
        if (ack.running !== body.running) fail(502, 'The gateway did not confirm the requested bot state.');
        run('UPDATE bots SET status=? WHERE id=?', body.running ? 'running' : 'stopped', bot.id); audit(user.id, body.running ? 'bot.start' : 'bot.stop', bot.id);
      } catch (error) { run("UPDATE bots SET status='unknown' WHERE id=?", bot.id); if (error.status) throw error; fail(502, 'Gateway confirmation is unavailable. Check the terminal before trying again.'); }
      return json(res, { ok: true });
    }
    if (path === '/api/support' && method === 'GET') {
      const user = context?.session.verified ? context.user : null;
      const conversations = user ? all('SELECT * FROM conversations WHERE user_id=? ORDER BY updated_at DESC', user.id) : guest ? all('SELECT * FROM conversations WHERE guest_hash=? ORDER BY updated_at DESC', digest(guest)) : [];
      return json(res, { conversations });
    }
    if (path === '/api/support' && method === 'POST') {
      rateLimit(`chat-create:${ip}`, 5, 900000);
      const user = context?.session.verified ? context.user : null, name = user?.name || string(body.name, 'Name', 2, 64), email = user?.email || (body.email ? emailValue(body.email) : '');
      const raw = guest || token(), chatId = id(), guestHash = user ? null : digest(raw);
      if (!user) cookie(res, 'elite_guest', raw, 2592000);
      run('INSERT INTO conversations (id,user_id,guest_hash,name,email,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', chatId, user?.id || null, guestHash, name, email, now(), now());
      broadcast(user?.id, guestHash); return json(res, { id: chatId }, 201);
    }
    const chatRoute = path.match(/^\/api\/support\/([^/]+)(?:\/(messages|close))?$/);
    if (chatRoute) {
      const chat = get('SELECT * FROM conversations WHERE id=?', chatRoute[1]); if (!chat || !canReadChat(chat, context, guest)) fail(404, 'Conversation not found.');
      if (method === 'GET') return json(res, { conversation: chat, messages: all('SELECT id,sender,body,created_at FROM messages WHERE conversation_id=? ORDER BY created_at,rowid', chat.id) });
      if (method === 'POST' && chatRoute[2] === 'messages') {
        if (chat.status !== 'open') fail(409, 'This conversation is closed. Start a new one for more help.');
        rateLimit(`chat-message:${ip}`, 20);
        run('INSERT INTO messages VALUES (?,?,?,?,?)', id(), chat.id, context?.session.verified && context.user.role === 'admin' ? 'admin' : 'customer', string(body.message, 'Message', 1, 4000), now());
        run('UPDATE conversations SET updated_at=? WHERE id=?', now(), chat.id); broadcast(chat.user_id, chat.guest_hash); return json(res, { ok: true }, 201);
      }
      if (method === 'POST' && chatRoute[2] === 'close') { needAdmin(context); run("UPDATE conversations SET status='closed' WHERE id=?", chat.id); broadcast(chat.user_id, chat.guest_hash); return json(res, { ok: true }); }
    }
    if (path === '/api/events' && method === 'GET') {
      if (!context?.session.verified && !guest) fail(401, 'Start a conversation or sign in first.');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      const client = { res, userId: context?.session.verified ? context.user.id : null, role: context?.session.verified ? context.user.role : 'guest', guestHash: guest ? digest(guest) : null }; clients.add(client);
      const heartbeat = setInterval(() => { if (client.userId && !readSession(req)?.session.verified) { res.end(); return; } res.write(': heartbeat\n\n'); }, 15000);
      res.on('close', () => { clearInterval(heartbeat); clients.delete(client); }); return;
    }
    if (path.startsWith('/api/admin')) {
      const admin = needAdmin(context);
      if (path === '/api/admin/overview' && method === 'GET') return json(res, {
        users: all('SELECT id,email,name,role,active,disabled,created_at FROM users ORDER BY created_at DESC'),
        payments: all('SELECT p.*,u.email FROM payments p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC'),
        methods: all('SELECT * FROM payment_methods ORDER BY created_at'), accounts: all('SELECT a.id,a.user_id,a.broker,a.login,a.server,a.status,a.note,a.created_at,u.email FROM accounts a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC'),
        payouts: all('SELECT p.*,u.email FROM payouts p JOIN users u ON u.id=p.user_id ORDER BY p.created_at DESC'),
        rounds: all('SELECT * FROM pool_rounds ORDER BY created_at DESC'), priceCents: Number(setting('price_cents')), telegramChat: setting('telegram_chat'),
        audit: all('SELECT a.*,u.email FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100') });
      if (path === '/api/admin/support' && method === 'GET') return json(res, { conversations: all('SELECT id,name,email,status,created_at,updated_at FROM conversations ORDER BY updated_at DESC') });
      if (path === '/api/admin/settings' && method === 'POST') {
        const amount = cents(body.price), chat = body.telegramChat ? string(body.telegramChat, 'Telegram chat', 1, 100) : '';
        if (chat && !/^-?\d+$/.test(chat)) fail(400, 'Enter a numeric Telegram chat ID.');
        transaction(db, () => { setSetting('price_cents', amount); setSetting('telegram_chat', chat); audit(admin.id, 'settings.update', 'price,telegram'); }); return json(res, { ok: true });
      }
      if (path === '/api/admin/telegram-test' && method === 'POST') { if (!telegram || !setting('telegram_chat')) fail(503, 'Configure the Telegram bot token and chat ID first.'); await telegram(setting('telegram_chat'), 'Elite Bot: your administrator alerts are connected.'); return json(res, { ok: true }); }
      const userRoute = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (userRoute && method === 'PATCH') {
        const user = get('SELECT * FROM users WHERE id=?', userRoute[1]); if (!user) fail(404, 'User not found.');
        const role = choice(body.role, ['user','admin'], 'role'); if (typeof body.active !== 'boolean' || typeof body.disabled !== 'boolean') fail(400, 'Choose valid access settings.');
        if (user.id === admin.id && (role !== 'admin' || body.disabled)) fail(400, 'You cannot remove your own administrator access.');
        if (body.disabled && get("SELECT id FROM bots WHERE user_id=? AND status<>'stopped'", user.id)) fail(409, 'The member must stop all bots before their account can be disabled.');
        transaction(db, () => { run('UPDATE users SET role=?,active=?,disabled=? WHERE id=?', role, body.active ? 1 : 0, body.disabled ? 1 : 0, user.id); if (body.disabled || user.role !== role) run('DELETE FROM sessions WHERE user_id=?', user.id); audit(admin.id, 'user.access.update', user.id); }); broadcast(user.id); return json(res, { ok: true });
      }
      const review = path.match(/^\/api\/admin\/payments\/([^/]+)\/review$/);
      if (review && method === 'POST') {
        const status = choice(body.status, ['approved','rejected'], 'review decision'), note = body.note ? string(body.note, 'Review note', 1, 500) : '';
        const payment = get('SELECT * FROM payments WHERE id=?', review[1]); if (!payment) fail(404, 'Payment not found.');
        transaction(db, () => {
          const changed = run("UPDATE payments SET status=?,note=?,reviewed_at=?,reviewer_id=? WHERE id=? AND status='pending'", status, note, now(), admin.id, payment.id);
          if (!changed.changes) fail(409, 'This payment has already been reviewed.');
          if (status === 'approved' && payment.kind === 'subscription') {
            run('UPDATE users SET active=1 WHERE id=?', payment.user_id);
            const user = get('SELECT referrer_id FROM users WHERE id=?', payment.user_id);
            if (user.referrer_id) run('INSERT INTO commissions VALUES (?,?,?,?,?,?)', id(), user.referrer_id, payment.user_id, payment.id, Math.floor(payment.amount_cents * Number(setting('commission_percent')) / 100), now());
          }
          audit(admin.id, `payment.${status}`, payment.id);
        }); broadcast(payment.user_id); return json(res, { ok: true });
      }
      const methodRoute = path.match(/^\/api\/admin\/payment-methods(?:\/([^/]+))?$/);
      if (methodRoute && method === 'POST') {
        const methodId = methodRoute[1] || id(), name = string(body.name, 'Payment name', 2, 100), kind = choice(body.kind, ['crypto','bank','mobile_money'], 'payment method'), details = string(body.details, 'Payment details', 3, 500), network = body.network ? string(body.network, 'Network', 1, 100) : '', instructions = body.instructions ? string(body.instructions, 'Instructions', 1, 1000) : '';
        if (kind === 'crypto' && !network) fail(400, 'Specify the exact crypto network.');
        if (typeof body.enabled !== 'boolean') fail(400, 'Choose method availability.');
        if (methodRoute[1] && !get('SELECT id FROM payment_methods WHERE id=?', methodId)) fail(404, 'Payment method not found.');
        run('INSERT INTO payment_methods VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,details=excluded.details,network=excluded.network,instructions=excluded.instructions,enabled=excluded.enabled', methodId, name, kind, details, network, instructions, body.enabled ? 1 : 0, now()); audit(admin.id, 'payment-method.save', methodId); return json(res, { ok: true });
      }
      const accountReview = path.match(/^\/api\/admin\/accounts\/([^/]+)\/review$/);
      if (accountReview && method === 'POST') {
        const account = get('SELECT * FROM accounts WHERE id=?', accountReview[1]); if (!account) fail(404, 'Account not found.');
        const decision = choice(body.decision, ['approve','reject'], 'decision'), note = body.note ? string(body.note, 'Note', 1, 500) : '';
        if (decision === 'reject') { if (account.gateway_id) fail(409, 'Disconnect this account before rejecting its details.'); run("UPDATE accounts SET status='rejected',note=? WHERE id=?", note, account.id); }
        else {
          if (!gateway) fail(503, 'Configure the MT5 gateway before approving connections.');
          const owner = get('SELECT active,role,disabled FROM users WHERE id=?', account.user_id);
          if (owner.disabled || !owner.active && owner.role !== 'admin') fail(409, 'Activate the member account before connecting MT5.');
          if (account.gateway_id) fail(409, 'This account already has a gateway connection. Refresh its status.');
          const response = await gateway.connect({ accountId: account.id, broker: account.broker, login: account.login, server: account.server, password: decrypt(account.password_encrypted, key) });
          if (typeof response.accountId !== 'string' || !response.accountId || response.connected !== true) fail(502, 'The gateway did not confirm a connected account.');
          run("UPDATE accounts SET status='connected',gateway_id=?,note=? WHERE id=?", response.accountId, note, account.id);
        }
        audit(admin.id, `account.${decision}`, account.id); broadcast(account.user_id); return json(res, { ok: true });
      }
      const roundRoute = path.match(/^\/api\/admin\/rounds(?:\/([^/]+))?$/);
      if (roundRoute && method === 'POST') {
        const roundId = roundRoute[1] || id(), name = string(body.name, 'Round name', 2, 100), goal = cents(body.goal), profit = Math.round(number(body.profit || 0, 'Reported profit', -10000000, 10000000) * 100), status = choice(body.status, ['open','trading','closed'], 'round status');
        const starts = Date.parse(body.startsAt), ends = Date.parse(body.endsAt); if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) fail(400, 'Choose a start and a later end date.');
        if (roundRoute[1] && !get('SELECT id FROM pool_rounds WHERE id=?', roundId)) fail(404, 'Round not found.');
        run('INSERT INTO pool_rounds VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,goal_cents=excluded.goal_cents,profit_cents=excluded.profit_cents,status=excluded.status,starts_at=excluded.starts_at,ends_at=excluded.ends_at', roundId, name, goal, profit, status, starts, ends, now()); audit(admin.id, 'pool-round.save', roundId); return json(res, { ok: true });
      }
      const payoutRoute = path.match(/^\/api\/admin\/payouts\/([^/]+)\/review$/);
      if (payoutRoute && method === 'POST') {
        const status = choice(body.status, ['paid','rejected'], 'payout decision'), reference = status === 'paid' ? string(body.reference, 'Payout transaction reference', 6, 200) : '';
        const changed = run("UPDATE payouts SET status=?,reference=?,reviewed_at=? WHERE id=? AND status='pending'", status, reference, now(), payoutRoute[1]);
        if (!changed.changes) fail(409, 'Payout not found or already reviewed.'); audit(admin.id, `payout.${status}`, payoutRoute[1]); return json(res, { ok: true });
      }
    }
    fail(404, 'This API route was not found.');
  }

  const publicPath = resolve(options.publicPath || new URL('../public/', import.meta.url).pathname);
  const pages = new Set(['/', '/login', '/signup', '/forgot-password', '/reset-password', '/logout', '/mt5', '/dashboard', '/bots', '/subscription', '/subscribe', '/settings', '/pool', '/referrals', '/support', '/admin', '/admin/support']);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/health') return json(res, { ok: true });
      if (url.pathname.startsWith('/api/')) {
        let context = readSession(req);
        let body = {};
        if (req.method !== 'GET') {
          if (req.headers.origin && req.headers.origin !== origin || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'This request origin is not allowed.');
          if (context && req.headers['x-csrf-token'] !== context.session.csrf) fail(403, 'Refresh the page and try again.');
          body = await safeBody(req);
          // A slow request body must not retain authority after logout or role revocation.
          context = readSession(req);
          if (context && req.headers['x-csrf-token'] !== context.session.csrf) fail(403, 'Refresh the page and try again.');
        }
        const locksTrading = req.method !== 'GET' && /^\/api\/(?:admin\/)?(?:accounts|bots)(?:\/|$)/.test(url.pathname);
        if (locksTrading && tradingMutation) fail(409, 'A trading connection command is in progress. Wait for confirmation before trying again.');
        if (locksTrading) tradingMutation = true;
        try { return await handleApi(req, res, url, context, body); }
        finally { if (locksTrading) tradingMutation = false; }
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed.');
      const files = { '/app.js': ['app.js','text/javascript'], '/styles.css': ['styles.css','text/css'], '/favicon.svg': ['favicon.svg','image/svg+xml'], '/logo.jpg': ['logo.jpg','image/jpeg'] };
      const entry = files[url.pathname] || (pages.has(url.pathname) ? ['index.html','text/html'] : null);
      if (!entry) fail(404, 'Page not found.');
      res.setHeader('Content-Type', entry[1]); res.end(req.method === 'HEAD' ? '' : readFileSync(join(publicPath, entry[0])));
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      if (!error.status) console.error('Request failed:', error.name, error.message);
      json(res, { error: error.status ? error.message : 'The request could not be completed. Please try again.' }, error.status || 500);
    }
  });
  const cleanup = setInterval(() => {
    run('DELETE FROM sessions WHERE expires_at<?', now()); run('DELETE FROM reset_tokens WHERE expires_at<?', now()); run('DELETE FROM rate_limits WHERE window<?', now() - 86400000);
  }, 600000); cleanup.unref();
  return { server, db, key, close: async () => { clearInterval(cleanup); for (const client of clients) client.res.end(); await new Promise(resolve => server.listening ? server.close(resolve) : resolve()); if (!options.db) db.close(); } };
}
