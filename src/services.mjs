import nodemailer from 'nodemailer';

export function createMailer(env) {
  if (!env.SMTP_HOST || !env.MAIL_FROM) return null;
  const transport = nodemailer.createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true', requireTLS: env.SMTP_SECURE !== 'true',
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    connectionTimeout: 10000, socketTimeout: 15000 });
  return { sendReset: (email, link) => transport.sendMail({ from: env.MAIL_FROM, to: email,
    subject: 'Reset your Elite Bot password', text: `Open this link to set a new password:\n${link}\n\nThis link expires in 30 minutes and can only be used once. If you did not request it, ignore this email.` }) };
}

export function createGateway(env) {
  if (!env.MT5_GATEWAY_URL || !env.MT5_GATEWAY_TOKEN) return null;
  const base = new URL(env.MT5_GATEWAY_URL);
  if (base.username || base.password || base.search || base.hash) throw new Error('Invalid MT5 gateway URL');
  if (base.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && ['localhost','127.0.0.1'].includes(base.hostname))) throw new Error('MT5 gateway must use HTTPS');
  const call = async (path, body) => {
    const response = await fetch(new URL(path, base), { method: body ? 'POST' : 'GET', redirect: 'error',
      headers: { Authorization: `Bearer ${env.MT5_GATEWAY_TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('The MT5 gateway could not complete the request. Check its connection.');
    return response.json();
  };
  return {
    connect: (account) => call('/accounts/connect', account),
    snapshot: (id) => call(`/accounts/${encodeURIComponent(id)}`),
    botState: (accountId, botId) => call(`/accounts/${encodeURIComponent(accountId)}/bots/${encodeURIComponent(botId)}`),
    disconnect: (id) => call(`/accounts/${encodeURIComponent(id)}/disconnect`, { accountId: id }),
    control: (accountId, bot, running) => call(`/accounts/${encodeURIComponent(accountId)}/bots/${encodeURIComponent(bot.id)}`, { running, config: bot })
  };
}

export function createTelegram(env) {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  return async (chatId, text) => {
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(10000) });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Telegram could not deliver the alert.');
  };
}
