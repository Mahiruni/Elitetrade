import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { digest, token, cookies } from './security.mjs';
import { createGateway, createTelegram } from './services.mjs';
import { createSupabaseData } from './supabase-data.mjs';
import { engineReady } from './demo-engine.mjs';
import { STRATEGIES,evaluateStrategy,planTrade } from './trading-strategies.mjs';
import {USDT_DESTINATION,usdtAmount} from './tron-payments.mjs';

const now = () => Date.now();
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
const credential = (value, label = 'Password') => {
  if (typeof value !== 'string' || !value.length || value.length > 128) fail(400, `${label} must be 1–128 characters.`);
  return value;
};
const passwordValue = value => {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, 'Use a password with 12–128 characters.');
  return value;
};
const numberValue = (value, label, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) fail(400, `${label} must be between ${min} and ${max}.`);
  return n;
};
const cents = value => Math.round(numberValue(value, 'Amount', 1, 10000000) * 100);
const choice = (value, values, label) => { if (!values.includes(value)) fail(400, `Choose a valid ${label}.`); return value; };
const q = value => encodeURIComponent(String(value));
const jwtPayload = jwt => {
  try {
    const raw = jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  } catch { return {}; }
};
const safeAccount = row => {
  if (!row) return row;
  const { gateway_id, ...safe } = row;
  return safe;
};
const cryptoHealth = row => ({
  ready:!!row?.provider_ok && Date.now()-Date.parse(row.updated_at || '') < 300000,
  message:row?.message || 'Automatic USDT verification is being configured.',
  updatedAt:row?.updated_at || null
});
const cryptoInvoice = row => row ? {...row,amount:usdtAmount(row.amount_units)} : null;

export function createSupabaseApplication(options = {}) {
  const env = options.env || process.env;
  const production = env.NODE_ENV === 'production';
  const origin = new URL(env.APP_ORIGIN || (env.VERCEL_URL ? `https://${env.VERCEL_URL}` : 'http://localhost:3000')).origin;
  const supabaseUrl = String(env.SUPABASE_URL || 'https://cgpvhayfwnpipktyltho.supabase.co').replace(/\/$/, '');
  const supabaseKey = env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_SNPQ5m9R3hv3Y7Uw-icxEQ_WSng7M8W';
  const db = options.db || createSupabaseData({ url:supabaseUrl, key:supabaseKey });


  const gateway = options.gateway === undefined ? createGateway(env) : options.gateway;
  const telegram = options.telegram === undefined ? createTelegram(env) : options.telegram;
  const rate = new Map();
  let tradingMutation = false;

  const rateLimit = (name, max = 20, windowMs = 60000) => {
    const start = Math.floor(now() / windowMs) * windowMs;
    const current = rate.get(name);
    const next = !current || current.start !== start ? { start, hits:1 } : { start, hits:current.hits + 1 };
    rate.set(name, next);
    if (next.hits > max) fail(429, 'Too many attempts. Please wait and try again.');
  };
  const cookie = (res, name, value, seconds) => {
    const existing = res.getHeader('Set-Cookie') || [];
    res.setHeader('Set-Cookie', [...existing, `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${seconds}${origin.startsWith('https:') ? '; Secure' : ''}`]);
  };
  const json = (res, value, status = 200) => {
    res.writeHead(status, { 'Content-Type':'application/json' });
    res.end(status === 204 ? '' : JSON.stringify(value));
  };
  const safeBody = async req => {
    if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'Use JSON for this request.');
    let bytes = 0, chunks = [];
    for await (const part of req) {
      bytes += part.length;
      if (bytes > 65536) fail(413, 'The request is too large.');
      chunks.push(part);
    }
    try {
      const data = JSON.parse(Buffer.concat(chunks).toString());
      if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Invalid JSON object.');
      return data;
    } catch (error) {
      if (error.status) throw error;
      fail(400, 'Invalid JSON.');
    }
  };

  async function authContext(req, optional = true, overrideToken = '') {
    const header = String(req.headers.authorization || '');
    const accessToken = overrideToken || (header.startsWith('Bearer ') ? header.slice(7).trim() : '');
    if (!accessToken) {
      if (optional) return null;
      fail(401, 'Sign in to continue.');
    }
    let authUser;
    try { authUser = await db.authUser(accessToken); }
    catch { if (optional) return null; fail(401, 'Your sign-in session has expired. Sign in again.'); }
    const profile = await db.one('elitetrade_profiles',
      `id=eq.${q(authUser.id)}&select=id,email,full_name,role,active,disabled,referral_code,referrer_id,created_at`, accessToken);
    if (!profile) fail(403, 'Your EliteTrade profile is not available.');
    if (profile.disabled) fail(403, 'This account has been disabled.');
    const factors = Array.isArray(authUser.factors) ? authUser.factors.filter(f => f.status === 'verified') : [];
    const payload = jwtPayload(accessToken);
    const requiresMfa = factors.length > 0 && payload.aal !== 'aal2';
    return {
      token:accessToken,
      authUser,
      profile,
      requiresMfa,
      user:{
        id:profile.id,
        email:profile.email || authUser.email || '',
        name:profile.full_name || authUser.user_metadata?.full_name || authUser.email?.split('@')[0] || 'Trader',
        role:profile.role,
        active:!!profile.active,
        mfaEnabled:factors.length > 0,
        createdAt:profile.created_at
      }
    };
  }
  const needUser = async req => {
    const ctx = await authContext(req, false);
    if (ctx.requiresMfa) fail(401, 'Complete two-factor authentication to continue.');
    return ctx;
  };
  const needAdmin = async req => {
    const ctx = await needUser(req);
    if (ctx.user.role !== 'admin') fail(403, 'Administrator access is required.');
    return ctx;
  };
  const activeUser = async req => {
    const ctx = await needUser(req);
    if (!ctx.user.active && ctx.user.role !== 'admin') fail(403, 'Activate your subscription first.');
    return ctx;
  };
  const setting = async (name, token) => (await db.one('elitetrade_settings', `key=eq.${q(name)}&select=value`, token))?.value;
  const audit = (ctx, action, target) => db.rpc('elitetrade_audit', { p_action:action, p_target:String(target) }, ctx.token).catch(() => {});
  const mapDbError = error => {
    if (error instanceof HttpError) return error;
    const message = String(error?.message || '').toLowerCase();
    if (error?.status === 401 || error?.status === 403) return new HttpError(error.status, error.message);
    if (/duplicate|already|unique|reviewed|awaiting|not open|cannot remove|must stop|in progress|reconciliation/.test(message)) return new HttpError(409, error.message);
    if (/not found/.test(message)) return new HttpError(404, error.message);
    if (/invalid|choose|activate|unavailable|required|sign in/.test(message)) return new HttpError(400, error.message);
    return error;
  };

  async function handleApi(req, res, url, body) {
    const path = url.pathname;
    const method = req.method;
    const guest = cookies(req.headers.cookie).elite_guest;

    if (path === '/api/config' && method === 'GET') {
      const ctx = await authContext(req, true);
      let priceCents = 14000;
      if (ctx) priceCents = Number(await setting('price_cents', ctx.token) || 14000);
      return json(res, {
        priceCents,
        emailConfigured:true,
        gatewayConfigured:!!gateway,
        connectionMode:gateway?.mode || (gateway ? 'execution' : 'unconfigured'),
        tradingEnabled:!!gateway && (gateway.mode === 'account-data' ? await engineReady(db) : gateway.tradingEnabled !== false),
        strategyPresets:STRATEGIES,
        telegramConfigured:!!telegram,
        demoMode:false,
        supabaseUrl,
        supabasePublishableKey:supabaseKey,
        persistentData:true,
        credentialEncryptionConfigured:true,
        credentialVaultConfigured:true,
        cryptoInvoicesSupported:true
      });
    }

    if (path === '/api/me' && method === 'GET') {
      const ctx = await authContext(req, true);
      return json(res, { user:ctx && !ctx.requiresMfa ? ctx.user : null, requiresMfa:!!ctx?.requiresMfa });
    }

    if (path === '/api/auth/supabase-session' && method === 'POST') {
      const accessToken = string(body.accessToken, 'Access token', 20, 10000);
      const ctx = await authContext(req, false, accessToken);
      return json(res, { user:ctx.requiresMfa ? null : ctx.user, requiresMfa:ctx.requiresMfa });
    }

    if (path === '/api/auth/logout' && method === 'POST') return json(res, { ok:true });

    if (path === '/api/profile' && method === 'PATCH') {
      const ctx = await needUser(req);
      const name = string(body.name, 'Name', 2, 64);
      await db.update('elitetrade_profiles', `id=eq.${q(ctx.user.id)}`, { full_name:name, updated_at:new Date().toISOString() }, ctx.token);
      return json(res, { user:{ ...ctx.user, name } });
    }

    if (path === '/api/auth/password' && method === 'POST') {
      const ctx = await needUser(req);
      rateLimit(`password:${ctx.user.id}`, 5, 900000);
      const currentPassword = credential(body.currentPassword, 'Current password');
      const password = passwordValue(body.password);
      try {
        await db.auth('token?grant_type=password', { body:{ email:ctx.user.email, password:currentPassword } });
      } catch { fail(400, 'Current password is incorrect.'); }
      await db.auth('user', { method:'PUT', token:ctx.token, body:{ password } });
      return json(res, { ok:true });
    }

    if (path === '/api/auth/mfa/enroll' && method === 'POST') {
      const ctx = await needUser(req);
      const enrolled = await db.auth('factors', { token:ctx.token, body:{ factor_type:'totp', friendly_name:'Elite Bot Authenticator' } });
      const challenge = await db.auth(`factors/${q(enrolled.id)}/challenge`, { token:ctx.token, body:{} });
      return json(res, {
        factorId:enrolled.id,
        challengeId:challenge.id,
        secret:enrolled.totp?.secret || '',
        qr:enrolled.totp?.qr_code || ''
      });
    }

    if (path === '/api/auth/mfa/enable' && method === 'POST') {
      const ctx = await authContext(req, false);
      const factorId = string(body.factorId, 'Factor', 10, 100);
      const challengeId = string(body.challengeId, 'Challenge', 10, 100);
      const code = string(body.code, 'Authenticator code', 6, 10);
      const session = await db.auth(`factors/${q(factorId)}/verify`, {
        token:ctx.token, body:{ challenge_id:challengeId, code }
      });
      return json(res, { ok:true, session });
    }

    if (path === '/api/auth/mfa/disable' && method === 'POST') {
      const ctx = await authContext(req, false);
      const password = credential(body.password);
      const code = string(body.code, 'Authenticator code', 6, 10);
      try { await db.auth('token?grant_type=password', { body:{ email:ctx.user.email, password } }); }
      catch { fail(400, 'Enter your current password and a fresh authenticator code.'); }
      const factorResponse = await db.auth('factors', { method:'GET', token:ctx.token });
      const factors = Array.isArray(factorResponse) ? factorResponse : [...(factorResponse?.totp || []), ...(factorResponse?.phone || [])];
      const factor = factors.find(f => f.status === 'verified' && (f.factor_type === 'totp' || f.type === 'totp')) || factors.find(f => f.status === 'verified');
      if (!factor) fail(400, 'No verified authenticator factor was found.');
      const challenge = await db.auth(`factors/${q(factor.id)}/challenge`, { token:ctx.token, body:{} });
      const verified = await db.auth(`factors/${q(factor.id)}/verify`, { token:ctx.token, body:{ challenge_id:challenge.id, code } });
      const access = verified.access_token || ctx.token;
      await db.auth(`factors/${q(factor.id)}`, { method:'DELETE', token:access });
      return json(res, { ok:true, session:verified });
    }

    if (path === '/api/payment-methods' && method === 'GET') {
      const ctx = await needUser(req);
      const [methods, price, health] = await Promise.all([
        db.query('elitetrade_payment_methods', 'enabled=eq.true&select=id,name,kind,details,network,instructions,enabled,created_at&order=created_at.asc', ctx.token),
        setting('price_cents', ctx.token),
        db.one('elitetrade_crypto_health','id=eq.true&select=provider_ok,message,updated_at',ctx.token)
      ]);
      return json(res, { methods:methods.map(m=>({...m,automatic:m.kind==='crypto'&&m.network==='TRC20'&&m.details===USDT_DESTINATION})), priceCents:Number(price || 14000),crypto:cryptoHealth(health) });
    }

    if (path === '/api/crypto-invoices' && method === 'GET') {
      const ctx=await needUser(req);
      const [invoices,health]=await Promise.all([
        db.query('elitetrade_crypto_invoices',`user_id=eq.${q(ctx.user.id)}&select=id,method_id,destination,price_cents,amount_units,created_at,expires_at,status,txid&order=created_at.desc&limit=10`,ctx.token),
        db.one('elitetrade_crypto_health','id=eq.true&select=provider_ok,message,updated_at',ctx.token)
      ]);
      return json(res,{invoices:invoices.map(cryptoInvoice),crypto:cryptoHealth(health)});
    }

    if (path === '/api/crypto-invoices' && method === 'POST') {
      const ctx=await needUser(req);
      rateLimit(`crypto-invoice:${ctx.user.id}`,5,900000);
      const methodId=string(body.methodId,'Payment method',36,36);
      if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(methodId))fail(400,'Invalid payment method.');
      const invoice=await db.rpc('elitetrade_crypto_invoice',{p_method_id:methodId},ctx.token);
      return json(res,{invoice:cryptoInvoice(invoice)},201);
    }

    if (path === '/api/payments' && method === 'GET') {
      const ctx = await needUser(req);
      const payments = await db.query('elitetrade_payments',
        `user_id=eq.${q(ctx.user.id)}&select=id,kind,round_id,reference,amount_cents,status,note,created_at&order=created_at.desc`, ctx.token);
      return json(res, { payments });
    }

    if (path === '/api/payments' && method === 'POST') {
      const ctx = await needUser(req);
      rateLimit(`payment:${ctx.user.id}`, 10, 900000);
      const methodId = string(body.methodId, 'Payment method', 10, 100);
      const reference = string(body.reference, 'Transaction reference', 6, 200);
      if(/^trc20:/i.test(reference))fail(400,'This reference is reserved for automatically verified USDT invoices.');
      const kind = choice(body.kind || 'subscription', ['subscription','pool'], 'payment type');
      const roundId = kind === 'pool' ? string(body.roundId, 'Pool round', 10, 100) : null;
      const amountCents = kind === 'pool' ? cents(body.amount) : null;
      await db.rpc('elitetrade_submit_payment', {
        p_method_id:methodId, p_reference:reference, p_kind:kind, p_round_id:roundId, p_amount_cents:amountCents
      }, ctx.token);
      await audit(ctx, 'payment.submit', kind);
      return json(res, { ok:true, message:'Payment submitted for administrator verification.' }, 201);
    }

    if (path === '/api/referrals' && method === 'GET') {
      const ctx = await needUser(req);
      const [commissions,payouts,team] = await Promise.all([
        db.query('elitetrade_commissions', `user_id=eq.${q(ctx.user.id)}&select=amount_cents,referred_id,created_at`, ctx.token),
        db.query('elitetrade_payouts', `user_id=eq.${q(ctx.user.id)}&select=*&order=created_at.desc`, ctx.token),
        db.query('elitetrade_profiles', `referrer_id=eq.${q(ctx.user.id)}&select=id,full_name,created_at&order=created_at.desc`, ctx.token)
      ]);
      const earnedCents = commissions.reduce((s,c) => s + Number(c.amount_cents || 0), 0);
      const reserved = payouts.filter(p => ['pending','paid'].includes(p.status)).reduce((s,p) => s + Number(p.amount_cents || 0), 0);
      const earnedByMember = new Map();
      for (const c of commissions) earnedByMember.set(c.referred_id, (earnedByMember.get(c.referred_id) || 0) + Number(c.amount_cents || 0));
      return json(res, {
        code:ctx.profile.referral_code,
        link:`${origin}/signup?ref=${ctx.profile.referral_code}`,
        earnedCents,
        availableCents:earnedCents-reserved,
        team:team.map(u => ({ name:u.full_name || 'Member', created_at:u.created_at, earned_cents:earnedByMember.get(u.id) || 0 })),
        payouts
      });
    }

    if (path === '/api/referrals/payout' && method === 'POST') {
      const ctx = await needUser(req);
      await db.rpc('elitetrade_request_payout', {}, ctx.token);
      await audit(ctx, 'payout.request', ctx.user.id);
      return json(res, { ok:true });
    }

    if (path === '/api/pool' && method === 'GET') {
      const ctx = await needUser(req);
      const rounds = await db.rpc('elitetrade_pool_summary', {}, ctx.token);
      return json(res, { rounds:rounds || [] });
    }

    if (path === '/api/accounts' && method === 'GET') {
      const ctx = await needUser(req);
      const rows = await db.query('elitetrade_accounts',
        `user_id=eq.${q(ctx.user.id)}&select=id,user_id,broker,login,server,gateway_id,status,note,created_at&order=created_at.desc`, ctx.token);
      const result = [];
      for (const account of rows) {
        const safe = safeAccount(account);
        if (gateway && account.gateway_id && ['connected','unknown','disconnected'].includes(account.status)) {
          try {
            const snapshot = await gateway.snapshot(account.gateway_id);
            safe.snapshot = {
              connected:!!snapshot.connected,
              currency:/^[A-Z]{3}$/.test(snapshot.currency || '') ? snapshot.currency : 'USD',
              updatedAt:now(),
              ...(gateway.mode === 'account-data' ? {accountType:snapshot.accountType} : {})
            };
            for (const name of ['balance','equity','profit']) if (Number.isFinite(snapshot[name])) safe.snapshot[name] = snapshot[name];
            safe.snapshot.history = Array.isArray(snapshot.history)
              ? snapshot.history.slice(-100).filter(p => Number.isFinite(p.value) && Number.isFinite(p.time)).map(p => ({ value:p.value,time:p.time }))
              : [];
            safe.status = safe.snapshot.connected ? 'connected' : 'disconnected';
          } catch {
            safe.status = 'unknown';
            safe.note = 'The gateway is unavailable. Connection status cannot be confirmed.';
          }
        }
        result.push(safe);
      }
      return json(res, { accounts:result, gatewayConfigured:!!gateway });
    }

    if (path === '/api/accounts' && method === 'POST') {
      const ctx = await activeUser(req);
      const broker = string(body.broker, 'Broker', 2, 100);
      const login = string(body.login, 'MT5 login', 1, 30);
      const server = string(body.server, 'MT5 server', 2, 100);
      const password = credential(body.password, 'MT5 password');
      if (!/^\d+$/.test(login)) fail(400, 'MT5 login must contain only digits.');
      await db.rpc('elitetrade_create_account', {
        p_broker:broker, p_login:login, p_server:server, p_password:password
      }, ctx.token);
      await audit(ctx, 'account.create', login);
      return json(res, { ok:true, message:'MT5 details saved for administrator review. Connection is not active yet.' }, 201);
    }

    const accountDelete = path.match(/^\/api\/accounts\/([^/]+)$/);
    if (accountDelete && method === 'DELETE') {
      const ctx = await needUser(req);
      const account = await db.one('elitetrade_accounts',
        `id=eq.${q(accountDelete[1])}&user_id=eq.${q(ctx.user.id)}&select=id,user_id,gateway_id,status`, ctx.token);
      if (!account) fail(404, 'Record not found.');
      const running = await db.one('elitetrade_bots',
        `account_id=eq.${q(account.id)}&user_id=eq.${q(ctx.user.id)}&status=neq.stopped&select=id`, ctx.token);
      if (running) fail(409, 'Confirm that every bot is stopped before removing this account.');
      if(gateway?.mode === 'account-data') await db.rpc('elitetrade_engine_forget_account',{p_account_id:account.id},ctx.token);
      if (account.gateway_id) {
        if (!gateway) fail(503, 'Reconnect the gateway before removing this account.');
        const ack = await gateway.disconnect(account.gateway_id);
        if (ack.disconnected !== true) fail(502, 'The gateway did not confirm disconnection.');
      }
      await db.remove('elitetrade_accounts', `id=eq.${q(account.id)}&user_id=eq.${q(ctx.user.id)}`, ctx.token);
      await audit(ctx, 'account.delete', account.id);
      return json(res, { ok:true });
    }

    if (path === '/api/bots' && method === 'GET') {
      const ctx = await needUser(req);
      const bots = await db.query('elitetrade_bots', `user_id=eq.${q(ctx.user.id)}&select=*&order=created_at.asc`, ctx.token);
      let engineRuns=[];
      if(gateway?.mode === 'account-data') engineRuns=await db.query('elitetrade_engine_runs',`user_id=eq.${q(ctx.user.id)}&select=bot_id,enabled,updated_at,message`,ctx.token).catch(()=>[]);
      const ready=gateway?.mode === 'account-data' ? await engineReady(db,ctx.token) : false;
      for (const bot of bots) {
        if(gateway?.mode === 'account-data') {
          const run=engineRuns.find(r=>r.bot_id===bot.id);
          bot.engineMessage=run?.message || 'Configure an account, preview the strategy, then start demo monitoring.';
          bot.engineUpdatedAt=run?.updated_at || null;
          if(run?.enabled)bot.status=ready?'running':'unknown';
          continue;
        }
        if (bot.status === 'stopped' || !bot.account_id || !gateway?.botState) continue;
        const account = await db.one('elitetrade_accounts', `id=eq.${q(bot.account_id)}&user_id=eq.${q(ctx.user.id)}&select=gateway_id`, ctx.token);
        try {
          if (!account?.gateway_id) throw new Error('Gateway unavailable');
          const status = await gateway.botState(account.gateway_id, bot.id);
          if (typeof status?.running !== 'boolean') throw new Error('Invalid bot state');
          bot.status = status.running ? 'running' : 'stopped';
        } catch { bot.status = 'unknown'; }
      }
      return json(res, { bots, ...(gateway?.mode === 'account-data' ? {engineReady:ready} : {}) });
    }

    const botSave = path.match(/^\/api\/bots\/([^/]+)$/);
    if (botSave && method === 'PATCH') {
      const ctx = await needUser(req);
      const bot = await db.one('elitetrade_bots', `id=eq.${q(botSave[1])}&user_id=eq.${q(ctx.user.id)}&select=*`, ctx.token);
      if (!bot) fail(404, 'Record not found.');
      if (bot.status !== 'stopped') fail(409, 'Stop the bot before changing its configuration.');
      let accountId = null;
      if (body.accountId) {
        const account = await db.one('elitetrade_accounts', `id=eq.${q(body.accountId)}&user_id=eq.${q(ctx.user.id)}&select=id`, ctx.token);
        if (!account) fail(404, 'Record not found.');
        accountId = account.id;
      }
      const name = string(body.name, 'Bot name', 2, 64);
      const strategy = choice(body.strategy, ['trend','scalping','breakout'], 'strategy');
      const symbol = string(body.symbol, 'Symbol', 3, 30);
      if (!/^[A-Za-z0-9._-]+$/.test(symbol)) fail(400, 'Enter a valid broker symbol.');
      const patch = {
        account_id:accountId,
        name,
        strategy,
        symbol,
        risk_percent:numberValue(body.riskPercent, 'Risk', .1, 5),
        stop_loss:numberValue(body.stopLoss, 'Stop loss', .1, 20),
        take_profit:numberValue(body.takeProfit, 'Take profit', .1, 50),
        max_drawdown:numberValue(body.maxDrawdown, 'Drawdown', 1, 30),
        daily_loss:numberValue(body.dailyLoss, 'Daily loss', .1, 10),
        lot_size:numberValue(body.lotSize, 'Lot size', .01, 10)
      };
      await db.update('elitetrade_bots', `id=eq.${q(bot.id)}&user_id=eq.${q(ctx.user.id)}`, patch, ctx.token);
      await audit(ctx, 'bot.update', bot.id);
      return json(res, { ok:true });
    }

    const botPreview=path.match(/^\/api\/bots\/([^/]+)\/preview$/);
    if(botPreview && method==='POST') {
      const ctx=await activeUser(req);
      const bot=await db.one('elitetrade_bots',`id=eq.${q(botPreview[1])}&user_id=eq.${q(ctx.user.id)}&select=*`,ctx.token);
      if(!bot)fail(404,'Record not found.');
      if(!gateway?.market)fail(503,'Configure MetaApi before previewing broker data.');
      const account=await db.one('elitetrade_accounts',`id=eq.${q(bot.account_id)}&user_id=eq.${q(ctx.user.id)}&select=gateway_id,status`,ctx.token);
      if(!account?.gateway_id||account.status!=='connected')fail(409,'Confirm the MT5 connection first.');
      const preset=STRATEGIES[bot.strategy];
      const market=await gateway.market(account.gateway_id,bot.symbol,preset.timeframe);
      const signal=evaluateStrategy(bot.strategy,market.candles);
      let order=null,riskMessage='No current entry signal.';
      if(signal.side)try {order=planTrade({bot,...market,side:signal.side});riskMessage='Preliminary risk check passed. Worker rechecks risk, exposure and margin before execution.';}
      catch(error){riskMessage=error.message;}
      return json(res,{signal,order,riskMessage,accountType:market.info.type==='ACCOUNT_TRADE_MODE_DEMO'?'demo':'real',message:'Preview only. No order sent.'});
    }

    const botControl = path.match(/^\/api\/bots\/([^/]+)\/control$/);
    if (botControl && method === 'POST') {
      const ctx = body.running ? await activeUser(req) : await needUser(req);
      if (typeof body.running !== 'boolean') fail(400, 'Choose start or stop.');
      const bot = await db.one('elitetrade_bots', `id=eq.${q(botControl[1])}&user_id=eq.${q(ctx.user.id)}&select=*`, ctx.token);
      if (!bot) fail(404, 'Record not found.');
      if (!gateway) fail(503, 'Live trading requires a configured MT5 gateway.');
      if (gateway.mode === 'account-data') {
        if(body.running) {
          if(!await engineReady(db,ctx.token))fail(503,'Demo worker is offline. Start the persistent worker before arming a bot.');
          const selected=await db.one('elitetrade_accounts',`id=eq.${q(bot.account_id)}&user_id=eq.${q(ctx.user.id)}&select=gateway_id,status`,ctx.token);
          if(!selected?.gateway_id||selected.status!=='connected')fail(409,'Confirm the MT5 connection first.');
          const market=await gateway.market(selected.gateway_id,bot.symbol,STRATEGIES[bot.strategy].timeframe);
          if(market.info.type!=='ACCOUNT_TRADE_MODE_DEMO'||market.info.tradeAllowed!==true||market.info.investorMode!==false)fail(409,'Starting requires a trade-enabled demo account. Real-account execution remains disabled.');
          evaluateStrategy(bot.strategy,market.candles);
        }
        await db.rpc('elitetrade_engine_control',{p_bot_id:bot.id,p_running:body.running},ctx.token);
        await audit(ctx,body.running?'demo.arm':'demo.stop',bot.id);
        return json(res,{ok:true,message:body.running?'Demo monitoring armed. Orders require a qualifying signal and worker risk checks.':'New entries stopped. Existing broker positions remain protected by their SL/TP.'});
      }
      if (gateway.tradingEnabled === false) fail(503, 'Automatic trading is unavailable.');
      if (!bot.account_id) fail(409, 'Select an MT5 account in the bot configuration first.');
      const account = await db.one('elitetrade_accounts',
        `id=eq.${q(bot.account_id)}&user_id=eq.${q(ctx.user.id)}&select=id,gateway_id,status`, ctx.token);
      if (!account?.gateway_id || (body.running && account.status !== 'connected')) fail(409, 'Confirm the MT5 connection first.');
      if (body.running) {
        let snapshot;
        try { snapshot = await gateway.snapshot(account.gateway_id); }
        catch { fail(502, 'The MT5 gateway could not verify this account.'); }
        if (!snapshot.connected) fail(409, 'The MT5 gateway reports that this account is disconnected.');
      }
      try {
        const ack = await gateway.control(account.gateway_id, bot, body.running);
        if (ack.running !== body.running) fail(502, 'The gateway did not confirm the requested bot state.');
        await db.rpc('elitetrade_set_bot_status', { p_bot_id:bot.id, p_status:body.running ? 'running' : 'stopped' }, ctx.token);
        await audit(ctx, body.running ? 'bot.start' : 'bot.stop', bot.id);
      } catch (error) {
        await db.rpc('elitetrade_set_bot_status', { p_bot_id:bot.id, p_status:'unknown' }, ctx.token).catch(() => {});
        if (error.status) throw error;
        fail(502, 'Gateway confirmation is unavailable. Check the terminal before trying again.');
      }
      return json(res, { ok:true });
    }

    if (path === '/api/support' && method === 'GET') {
      const ctx = await authContext(req, true);
      if (ctx && !ctx.requiresMfa) {
        const conversations = await db.query('elitetrade_conversations',
          `user_id=eq.${q(ctx.user.id)}&select=*&order=updated_at.desc`, ctx.token);
        return json(res, { conversations });
      }
      if (!guest) return json(res, { conversations:[] });
      const conversations = await db.rpc('elitetrade_guest_list_conversations', { p_guest_hash:digest(guest) }, '');
      return json(res, { conversations:conversations || [] });
    }

    if (path === '/api/support' && method === 'POST') {
      rateLimit(`chat-create:${req.socket.remoteAddress || 'guest'}`, 5, 900000);
      const ctx = await authContext(req, true);
      if (ctx && !ctx.requiresMfa) {
        const rows = await db.insert('elitetrade_conversations', {
          user_id:ctx.user.id, name:ctx.user.name, email:ctx.user.email, created_at:now(), updated_at:now()
        }, ctx.token);
        return json(res, { id:rows?.[0]?.id }, 201);
      }
      const name = string(body.name, 'Name', 2, 64);
      const email = body.email ? emailValue(body.email) : '';
      const raw = guest || token();
      if (!guest) cookie(res, 'elite_guest', raw, 2592000);
      const id = await db.rpc('elitetrade_guest_create_conversation',
        { p_guest_hash:digest(raw), p_name:name, p_email:email }, '');
      return json(res, { id }, 201);
    }

    const chatRoute = path.match(/^\/api\/support\/([^/]+)(?:\/(messages|close))?$/);
    if (chatRoute) {
      const ctx = await authContext(req, true);
      const chatId = chatRoute[1];
      if (ctx && !ctx.requiresMfa) {
        const chat = await db.one('elitetrade_conversations', `id=eq.${q(chatId)}&select=*`, ctx.token);
        if (!chat) fail(404, 'Conversation not found.');
        if (method === 'GET') {
          const messages = await db.query('elitetrade_messages', `conversation_id=eq.${q(chat.id)}&select=id,sender,body,created_at&order=created_at.asc`, ctx.token);
          return json(res, { conversation:chat, messages });
        }
        if (method === 'POST' && chatRoute[2] === 'messages') {
          if (chat.status !== 'open') fail(409, 'This conversation is closed. Start a new one for more help.');
          const sender = ctx.user.role === 'admin' ? 'admin' : 'customer';
          await db.insert('elitetrade_messages', { conversation_id:chat.id, sender, body:string(body.message, 'Message', 1, 4000), created_at:now() }, ctx.token);
          await db.update('elitetrade_conversations', `id=eq.${q(chat.id)}`, { updated_at:now() }, ctx.token);
          return json(res, { ok:true }, 201);
        }
        if (method === 'POST' && chatRoute[2] === 'close') {
          if (ctx.user.role !== 'admin') fail(403, 'Administrator access is required.');
          await db.update('elitetrade_conversations', `id=eq.${q(chat.id)}`, { status:'closed', updated_at:now() }, ctx.token);
          return json(res, { ok:true });
        }
      }
      if (!guest) fail(404, 'Conversation not found.');
      const guestHash = digest(guest);
      if (method === 'GET') {
        const rows = await db.rpc('elitetrade_guest_get_conversation', { p_guest_hash:guestHash, p_conversation_id:chatId }, '');
        const row = rows?.[0];
        if (!row) fail(404, 'Conversation not found.');
        return json(res, { conversation:row.conversation, messages:row.messages || [] });
      }
      if (method === 'POST' && chatRoute[2] === 'messages') {
        await db.rpc('elitetrade_guest_add_message',
          { p_guest_hash:guestHash, p_conversation_id:chatId, p_body:string(body.message, 'Message', 1, 4000) }, '');
        return json(res, { ok:true }, 201);
      }
      fail(404, 'Conversation not found.');
    }

    if (path === '/api/events' && method === 'GET') return json(res, null, 204);

    if (path.startsWith('/api/admin')) {
      const ctx = await needAdmin(req);

      if (path === '/api/admin/overview' && method === 'GET') {
        const [profiles,payments,methods,accounts,payouts,rounds,auditRows,price,telegramChat,health] = await Promise.all([
          db.query('elitetrade_profiles', 'select=id,email,full_name,role,active,disabled,created_at&order=created_at.desc', ctx.token),
          db.query('elitetrade_payments', 'select=*&order=created_at.desc', ctx.token),
          db.query('elitetrade_payment_methods', 'select=*&order=created_at.asc', ctx.token),
          db.query('elitetrade_accounts', 'select=id,user_id,broker,login,server,status,note,created_at,gateway_id&order=created_at.desc', ctx.token),
          db.query('elitetrade_payouts', 'select=*&order=created_at.desc', ctx.token),
          db.query('elitetrade_pool_rounds', 'select=*&order=created_at.desc', ctx.token),
          db.query('elitetrade_audit_log', 'select=*&order=created_at.desc&limit=100', ctx.token),
          setting('price_cents', ctx.token),
          setting('telegram_chat', ctx.token),
          db.one('elitetrade_crypto_health','id=eq.true&select=provider_ok,message,updated_at',ctx.token)
        ]);
        const emails = new Map(profiles.map(p => [p.id,p.email || '']));
        return json(res, {
          users:profiles.map(p => ({ id:p.id,email:p.email,name:p.full_name,role:p.role,active:p.active,disabled:p.disabled,created_at:p.created_at })),
          payments:payments.map(p => ({ ...p,email:emails.get(p.user_id) || '' })),
          methods,
          accounts:accounts.map(a => ({ ...safeAccount(a),email:emails.get(a.user_id) || '' })),
          payouts:payouts.map(p => ({ ...p,email:emails.get(p.user_id) || '' })),
          rounds,
          priceCents:Number(price || 14000),
          telegramChat:telegramChat || '',
          crypto:cryptoHealth(health),
          audit:auditRows.map(a => ({ ...a,email:emails.get(a.actor_id) || '' }))
        });
      }

      if (path === '/api/admin/support' && method === 'GET') {
        const conversations = await db.query('elitetrade_conversations',
          'select=id,name,email,status,created_at,updated_at,user_id&order=updated_at.desc', ctx.token);
        return json(res, { conversations });
      }

      if (path === '/api/admin/settings' && method === 'POST') {
        const amount = cents(body.price);
        const chat = body.telegramChat ? string(body.telegramChat, 'Telegram chat', 1, 100) : '';
        if (chat && !/^-?\d+$/.test(chat)) fail(400, 'Enter a numeric Telegram chat ID.');
        const key=body.tronGridApiKey ? string(body.tronGridApiKey,'TronGrid API key',16,256) : '';
        if(key&&!/^[a-zA-Z0-9._-]{16,256}$/.test(key))fail(400,'Enter a valid TronGrid API key.');
        if(key)await db.rpc('elitetrade_crypto_save_key',{p_key:key},ctx.token);
        await db.rpc('elitetrade_admin_set_settings', { p_price_cents:amount, p_telegram_chat:chat }, ctx.token);
        await audit(ctx, 'settings.update', key?'price,telegram,USDT verification key':'price,telegram');
        return json(res, { ok:true });
      }

      if (path === '/api/admin/telegram-test' && method === 'POST') {
        const chat = await setting('telegram_chat', ctx.token);
        if (!telegram || !chat) fail(503, 'Configure the Telegram bot token and chat ID first.');
        await telegram(chat, 'Elite Bot: your administrator alerts are connected.');
        return json(res, { ok:true });
      }

      const userRoute = path.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (userRoute && method === 'PATCH') {
        const role = choice(body.role, ['user','admin'], 'role');
        if (typeof body.active !== 'boolean' || typeof body.disabled !== 'boolean') fail(400, 'Choose valid access settings.');
        await db.rpc('elitetrade_admin_set_access', {
          p_user_id:userRoute[1], p_role:role, p_active:body.active, p_disabled:body.disabled
        }, ctx.token);
        await audit(ctx, 'user.access.update', userRoute[1]);
        return json(res, { ok:true });
      }

      const review = path.match(/^\/api\/admin\/payments\/([^/]+)\/review$/);
      if (review && method === 'POST') {
        const status = choice(body.status, ['approved','rejected'], 'review decision');
        const note = body.note ? string(body.note, 'Review note', 1, 500) : '';
        await db.rpc('elitetrade_review_payment', { p_payment_id:review[1], p_status:status, p_note:note }, ctx.token);
        await audit(ctx, `payment.${status}`, review[1]);
        return json(res, { ok:true });
      }

      const methodRoute = path.match(/^\/api\/admin\/payment-methods(?:\/([^/]+))?$/);
      if (methodRoute && method === 'POST') {
        const value = {
          ...(methodRoute[1] ? { id:methodRoute[1] } : {}),
          name:string(body.name, 'Payment name', 2, 100),
          kind:choice(body.kind, ['crypto','bank','mobile_money'], 'payment method'),
          details:string(body.details, 'Payment details', 3, 500),
          network:body.network ? string(body.network, 'Network', 1, 100) : '',
          instructions:body.instructions ? string(body.instructions, 'Instructions', 1, 1000) : '',
          enabled:!!body.enabled,
          created_at:now()
        };
        if (value.kind === 'crypto' && !value.network) fail(400, 'Specify the exact crypto network.');
        await db.upsert('elitetrade_payment_methods', 'on_conflict=id', value, ctx.token);
        await audit(ctx, 'payment-method.save', methodRoute[1] || value.name);
        return json(res, { ok:true });
      }

      const accountReview = path.match(/^\/api\/admin\/accounts\/([^/]+)\/review$/);
      if (accountReview && method === 'POST') {
        const account = await db.one('elitetrade_accounts', `id=eq.${q(accountReview[1])}&select=*`, ctx.token);
        if (!account) fail(404, 'Account not found.');
        const decision = choice(body.decision, ['approve','reject'], 'decision');
        const note = body.note ? string(body.note, 'Note', 1, 500) : '';
        if (decision === 'reject') {
          if (account.gateway_id) fail(409, 'Disconnect this account before rejecting its details.');
          await db.rpc('elitetrade_admin_update_account',
            { p_account_id:account.id,p_status:'rejected',p_gateway_id:null,p_note:note }, ctx.token);
        } else {
          if (!gateway) fail(503, 'Configure the MT5 gateway before approving connections.');
          const owner = await db.one('elitetrade_profiles', `id=eq.${q(account.user_id)}&select=active,role,disabled`, ctx.token);
          if (!owner || owner.disabled || (!owner.active && owner.role !== 'admin')) fail(409, 'Activate the member account before connecting MT5.');
          if (account.gateway_id && !(gateway.mode === 'account-data' && account.status === 'pending')) fail(409, 'This account already has a gateway connection. Refresh its status.');
          const secret = await db.rpc('elitetrade_admin_get_account_secret', { p_account_id:account.id }, ctx.token);
          const response = await gateway.connect({
            accountId:account.id, broker:account.broker, login:account.login, server:account.server, password:secret
          });
          if (typeof response.accountId !== 'string' || !response.accountId || (response.connected !== true && !(gateway.mode === 'account-data' && response.pending === true))) fail(502, 'The gateway did not confirm a connected account.');
          await db.rpc('elitetrade_admin_update_account',
            { p_account_id:account.id,p_status:response.connected ? 'connected' : 'pending',p_gateway_id:response.accountId,p_note:response.connected ? note : 'MetaApi is connecting. Retry administrator approval shortly.' }, ctx.token);
        }
        await audit(ctx, `account.${decision}`, account.id);
        return json(res, { ok:true });
      }

      const roundRoute = path.match(/^\/api\/admin\/rounds(?:\/([^/]+))?$/);
      if (roundRoute && method === 'POST') {
        const starts = Date.parse(body.startsAt);
        const ends = Date.parse(body.endsAt);
        if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) fail(400, 'Choose a start and a later end date.');
        const value = {
          ...(roundRoute[1] ? { id:roundRoute[1] } : {}),
          name:string(body.name, 'Round name', 2, 100),
          goal_cents:cents(body.goal),
          profit_cents:Math.round(numberValue(body.profit || 0, 'Reported profit', -10000000, 10000000) * 100),
          status:choice(body.status, ['open','trading','closed'], 'round status'),
          starts_at:starts,
          ends_at:ends,
          created_at:now()
        };
        await db.upsert('elitetrade_pool_rounds', 'on_conflict=id', value, ctx.token);
        await audit(ctx, 'pool-round.save', roundRoute[1] || value.name);
        return json(res, { ok:true });
      }

      const payoutRoute = path.match(/^\/api\/admin\/payouts\/([^/]+)\/review$/);
      if (payoutRoute && method === 'POST') {
        const status = choice(body.status, ['paid','rejected'], 'payout decision');
        const reference = status === 'paid' ? string(body.reference, 'Payout transaction reference', 6, 200) : '';
        await db.rpc('elitetrade_admin_review_payout',
          { p_payout_id:payoutRoute[1], p_status:status, p_reference:reference }, ctx.token);
        await audit(ctx, `payout.${status}`, payoutRoute[1]);
        return json(res, { ok:true });
      }
    }

    fail(404, 'This API route was not found.');
  }

  const publicPath = resolve(options.publicPath || new URL('../public/', import.meta.url).pathname);
  const pages = new Set(['/', '/login', '/signup', '/forgot-password', '/reset-password', '/logout', '/mt5', '/dashboard', '/bots', '/subscription', '/subscribe', '/settings', '/pool', '/referrals', '/support', '/terms', '/privacy', '/risk-disclosure', '/refund-policy', '/cookies', '/admin', '/admin/support']);
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${supabaseUrl}; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`);
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (production) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Cache-Control', 'no-store');

    try {
      const url = new URL(req.url, origin);
      if (url.pathname === '/health') return json(res, { ok:true, database:'supabase' });
      if (url.pathname.startsWith('/api/')) {
        let body = {};
        if (req.method !== 'GET') {
          if ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') fail(403, 'This request origin is not allowed.');
          body = await safeBody(req);
        }
        const locksTrading = req.method !== 'GET' && /^\/api\/(?:admin\/)?(?:accounts|bots)(?:\/|$)/.test(url.pathname);
        if (locksTrading && tradingMutation) fail(409, 'A trading connection command is in progress. Wait for confirmation before trying again.');
        if (locksTrading) tradingMutation = true;
        try { return await handleApi(req, res, url, body); }
        finally { if (locksTrading) tradingMutation = false; }
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Method not allowed.');
      const files = {
        '/app.js':['app.js','text/javascript'],
        '/styles.css':['styles.css','text/css'],
        '/favicon.svg':['favicon.svg','image/svg+xml'],
        '/logo.jpg':['logo.jpg','image/jpeg'],
        '/robots.txt':['robots.txt','text/plain; charset=utf-8'],
        '/sitemap.xml':['sitemap.xml','application/xml; charset=utf-8'],
        '/security.txt':['security.txt','text/plain; charset=utf-8'],
        '/.well-known/security.txt':['security.txt','text/plain; charset=utf-8']
      };
      const entry = files[url.pathname] || (pages.has(url.pathname) ? ['index.html','text/html'] : null);
      if (!entry) fail(404, 'Page not found.');
      res.setHeader('Content-Type', entry[1]);
      res.end(req.method === 'HEAD' ? '' : readFileSync(join(publicPath, entry[0])));
    } catch (raw) {
      const error = mapDbError(raw);
      if (res.headersSent) { res.end(); return; }
      if (!error.status) console.error('Request failed:', error.name, error.message);
      json(res, { error:error.status ? error.message : 'The request could not be completed. Please try again.' }, error.status || 500);
    }
  });

  return {
    server,
    close:async () => new Promise(resolve => server.listening ? server.close(resolve) : resolve())
  };
}
