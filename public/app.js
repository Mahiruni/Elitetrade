const root = document.querySelector('#app');
const modal = document.querySelector('#modal');
const AUTH_KEY = 'elite-supabase-session';
const AUTH_REDIRECT_ORIGIN = window.location.origin;
const readStoredAuth = () => {
  try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); }
  catch { return null; }
};
const state = { user: null, csrf: null, config: {}, data: {}, chat: null, adminTab: 'payments', version: 0, stream: null, auth: readStoredAuth(), pendingMfa: null };
function saveAuth(session) {
  if (!session?.access_token) return;
  const expiresAt = Number(session.expires_at || (Date.now() / 1000 + Number(session.expires_in || 3600)));
  state.auth = { access_token:session.access_token, refresh_token:session.refresh_token || state.auth?.refresh_token || '', expires_at:expiresAt };
  try { localStorage.setItem(AUTH_KEY, JSON.stringify(state.auth)); } catch {}
}
function clearAuth() {
  state.auth = null;
  state.pendingMfa = null;
  try { localStorage.removeItem(AUTH_KEY); } catch {}
}
function decodeJwt(jwt) {
  try {
    const raw = jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    return JSON.parse(atob(raw));
  } catch { return {}; }
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const money = (value, currency = 'USD') => new Intl.NumberFormat('en', { style:'currency', currency }).format(Number(value || 0) / 100);
const date = value => value ? new Date(value).toLocaleString([], { dateStyle:'medium', timeStyle:'short' }) : '—';
const badge = value => `<span class="badge ${esc(value)}">${esc(value)}</span>`;
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({ terminal:'<path d="m5 7 5 5-5 5m8 0h6"/>', bots:'<rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 2v4M8 11v2m8-2v2m-8 4h8M1 11h3m16 0h3"/>', pool:'<path d="M3 20h18M5 20V10m7 10V4m7 16v-7M3 7l8-5 10 5"/>', referrals:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 2 4v3"/>', settings:'<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>', wallet:'<rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8V5l14-3v3m4 7h-6v5h6"/>', support:'<path d="M4 13v-2a8 8 0 0 1 16 0v2M4 11H2v7h4v-7zm16 0h2v7h-4v-7zm0 7v3h-7"/>', shield:'<path d="m12 2 8 4v6c0 5-8 10-8 10S4 17 4 12V6zm-4 9 3 3 5-6"/>', menu:'<path d="M4 6h16M4 12h16M4 18h16"/>', theme:'<path d="M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10Z"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>', arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>', logout:'<path d="M9 3H4v18h5m6-15 6 6-6 6m-7-6h13"/>', plus:'<path d="M12 4v16M4 12h16"/>', eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', refresh:'<path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1"/>' })[name] || ''}</svg>`;
const brand = `<a href="/mt5" class="brand"><img src="/logo.jpg" alt=""><span>ELITE <em>BOT</em><div class="wordmark-sub">TRADING TERMINAL</div></span></a>`;
const btn = (label, action, id = '', extra = '') => `<button type="button" data-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
const themeButton = () => btn(icon('theme'), 'theme', '', 'class="icon ghost" aria-label="Toggle light and dark theme"');
const empty = (title, detail, action = '') => `<div class="empty"><strong>${title}</strong>${detail}${action ? `<div class="actions center">${action}</div>` : ''}</div>`;
const field = (label, name, value = '', type = 'text', attrs = '') => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${attrs}></div>`;
const password = (label, name, autocomplete = 'current-password') => `<div class="field"><label for="f-${name}">${label}</label><div class="toggle-pass"><input id="f-${name}" name="${name}" type="password" required maxlength="128" autocomplete="${autocomplete}" ${autocomplete === 'new-password' ? 'minlength="12"' : ''}>${btn(icon('eye'), 'password', `f-${name}`, `class="icon ghost" aria-label="Show ${label.toLowerCase()}" aria-pressed="false"`)}</div></div>`;
const select = (label, name, value, options) => `<div class="field"><label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v,l]) => `<option value="${esc(v)}" ${String(value) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
const textarea = (label, name, value = '', attrs = '') => `<div class="field"><label for="f-${name}">${label}</label><textarea id="f-${name}" name="${name}" ${attrs}>${esc(value)}</textarea></div>`;
const form = (action, content, submit = 'Save changes', id = '') => `<form data-form="${action}" data-id="${esc(id)}">${content}<p class="error" role="alert"></p><div class="actions"><button class="primary" type="submit">${submit}</button></div></form>`;
const heading = (title, description = '', action = '') => `<div class="page-heading"><div><div class="eyebrow">Your workspace</div><h1>${title}</h1>${description ? `<p class="muted">${description}</p>` : ''}</div>${action ? `<div class="actions">${action}</div>` : ''}</div>`;
const table = (heads, rows) => `<div class="table-wrap"><table><thead><tr>${heads.map(h => `<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
const stat = (label, value) => `<div class="stat"><small>${label}</small><div class="value">${value}</div></div>`;
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('visible'), 5000); }
function openModal(title, body) { modal.innerHTML = `<div class="dialog-head"><h2>${title}</h2>${btn(icon('close'), 'close', '', 'class="icon ghost" aria-label="Close dialog"')}</div><div class="dialog-body">${body}</div>`; modal.showModal(); }
async function api(path, method = 'GET', body) {
  const accessToken = path === '/config' ? '' : await ensureAccessToken();
  const response = await fetch(`/api${path}`, {
    method,
    credentials:'same-origin',
    headers: {
      ...(accessToken ? { Authorization:`Bearer ${accessToken}` } : {}),
      ...(method !== 'GET' ? { 'Content-Type':'application/json' } : {})
    },
    body: method !== 'GET' ? JSON.stringify(body || {}) : undefined
  });
  const result = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && accessToken) {
      clearAuth();
      state.user = null;
    }
    const error = new Error(result.error || 'Request failed. Please try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}
async function supabaseAuth(path, method = 'POST', body, accessToken = '') {
  if (!state.config.supabaseUrl || !state.config.supabasePublishableKey) throw new Error('Sign-in service is not configured yet.');
  const response = await fetch(`${state.config.supabaseUrl}/auth/v1/${path}`, {
    method,
    headers: {
      apikey: state.config.supabasePublishableKey,
      Authorization: `Bearer ${accessToken || state.config.supabasePublishableKey}`,
      'Content-Type':'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.msg || result.message || result.error_description || result.error || 'Authentication failed.');
  return result;
}
async function ensureAccessToken() {
  if (!state.auth?.access_token) return '';
  if (Number(state.auth.expires_at || 0) * 1000 > Date.now() + 60000) return state.auth.access_token;
  if (!state.auth.refresh_token || !state.config.supabaseUrl) { clearAuth(); return ''; }
  try {
    const refreshed = await supabaseAuth('token?grant_type=refresh_token','POST',{ refresh_token:state.auth.refresh_token });
    saveAuth(refreshed);
    return state.auth?.access_token || '';
  } catch {
    clearAuth();
    return '';
  }
}
async function identity() {
  const me = await api('/me');
  state.user = me.user;
  state.requiresMfa = me.requiresMfa;
  return me;
}
function connectEvents() {
  if (state.stream || !state.user && !state.chat) return;
  state.stream = new EventSource('/api/events');
  state.stream.addEventListener('refresh', async () => {
    if (location.pathname.includes('support')) { await refreshChat().catch(() => {}); return; }
    toast('Your account has an update. Refresh to see the latest status.');
  });
}
function shell(content) {
  const path = location.pathname;
  const nav = [['/mt5','terminal','MT5 terminal'],['/bots','bots','Trading bots'],['/pool','pool','Live pool'],['/referrals','referrals','Referrals'],['/subscription','wallet','Subscription'],['/settings','settings','Settings'],['/support','support','Support']];
  if (state.user.role === 'admin') nav.push(['/admin','shield','Administration'],['/admin/support','support','Support inbox']);
  root.innerHTML = `<div class="layout"><div class="menu-scrim" data-action="menu"></div><aside class="sidebar" id="workspace-navigation"><div class="sidebar-brand">${brand}${btn(icon("close"),"menu","",'class="icon ghost mobile-only" aria-label="Close navigation"')}</div><div class="nav-label">WORKSPACE</div><nav aria-label="Main navigation">${nav.map(([href,i,title]) => `<a href="${href}" class="${path === href ? 'active' : ''}" ${path === href ? 'aria-current="page"' : ''}>${icon(i)}<span>${title}</span></a>`).join('')}</nav><div class="sidebar-bottom"><div class="plan-label">${badge(state.user.active ? 'active' : 'inactive')} <small>Lifetime access</small></div>${btn(`${icon('logout')} Sign out`, 'logout', '', 'class="ghost logout"')}</div></aside><div class="workspace"><header class="topbar"><div class="desktop-crumb">Workspace <span>/</span> ${esc(nav.find(n => n[0] === path)?.[2] || 'Terminal')}</div>${brand}<div class="topbar-actions"><div class="account-name"><strong>${esc(state.user.name)}</strong><small>${esc(state.user.email)}</small></div>${themeButton()}${btn(icon('menu'), 'menu', '', 'class="icon ghost mobile-only" aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded="false"')}</div></header><main id="main" class="content" tabindex="-1">${content}</main><footer class="workspace-footer"><span>Elite Bot</span><span>Trading involves risk. Performance is not guaranteed.</span></footer></div></div>`;
}
const publicBrand = `<a href="/" class="brand site-brand"><img src="/logo.jpg" alt=""><span>ELITE <em>BOT</em><div class="wordmark-sub">AUTOMATED TRADING PLATFORM</div></span></a>`;
function marketingHeader() {
  const accountLink = state.user ? '<a class="nav-login" href="/mt5">Workspace</a>' : '<a class="nav-login" href="/login">Sign in</a>';
  const cta = state.user ? '<a class="marketing-cta small" href="/mt5">Open terminal</a>' : '<a class="marketing-cta small" href="/signup">Get started</a>';
  return `<header class="marketing-header"><div class="marketing-nav">${publicBrand}<nav class="marketing-links" aria-label="Marketing navigation"><a href="/#platform">Platform</a><a href="/#workflow">How it works</a><a href="/#security">Security</a><a href="/#pricing">Access</a></nav><div class="marketing-actions">${themeButton()}${accountLink}${cta}<details class="public-menu"><summary aria-label="Navigation menu">${icon("menu")}</summary><nav aria-label="Mobile site navigation"><a href="/#platform">Platform</a><a href="/#workflow">How it works</a><a href="/#security">Security</a><a href="/#pricing">Access</a><a href="/support">Support</a><a href="${state.user ? "/mt5" : "/login"}">${state.user ? "Workspace" : "Sign in"}</a>${cta}</nav></details></div></div></header>`;
}
function publicFooter() {
  return `<footer class="marketing-footer"><div class="footer-grid"><div><div class="footer-brand">${publicBrand}</div><p>Tools for managing MT5 connections, automation controls, account access, payments, and support from one focused workspace.</p></div><div><strong>Platform</strong><a href="/#platform">Overview</a><a href="/#security">Security</a><a href="/support">Support</a><a href="/login">Sign in</a></div><div><strong>Legal</strong><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/risk-disclosure">Risk Disclosure</a><a href="/refund-policy">Refund Policy</a><a href="/cookies">Cookie Policy</a></div></div><div class="footer-bottom"><span>© ${new Date().getFullYear()} Elite Bot. All rights reserved.</span><span>Trading involves substantial risk. No performance is guaranteed.</span></div></footer>`;
}
function publicShell(content) {
  root.innerHTML = `${marketingHeader()}<main id="main" class="marketing-main" tabindex="-1">${content}</main>${publicFooter()}`;
}
function marketingPage() {
  const dashboardHref = state.user ? '/mt5' : '/signup';
  const dashboardLabel = state.user ? 'Open your terminal' : 'Create your account';
  return `
    <section class="marketing-hero">
      <div class="hero-index" aria-hidden="true">01 / THE CONTROL LAYER</div>
      <div class="hero-copy">
        <div class="marketing-kicker"><span></span> MT5 / AUTOMATION WORKSPACE</div>
        <h1>Your strategy.<br>Your limits.<br><em>Your control.</em></h1>
        <p class="hero-lead">Bring your MT5 accounts, automation and risk settings into one focused workspace. Configure with intention. Stay in control.</p>
        <div class="hero-actions"><a class="marketing-cta" href="${dashboardHref}">${dashboardLabel}</a><a class="marketing-secondary" href="#platform">Explore the platform</a></div>
        <div class="hero-trust"><span>${icon('shield')} Protected account access</span><span>${icon('terminal')} MT5 connection workflow</span><span>${icon('settings')} User-controlled risk settings</span></div>
      </div>
      <aside class="terminal-showcase" aria-label="Platform workflow">
        <div class="showcase-top"><span>ELITE BOT / OPERATIONS</span><small>WORKFLOW OVERVIEW</small></div>
        <div class="showcase-status"><small>Designed around one principle</small><h2>Control before<br>execution.</h2></div>
        <ol class="operation-steps">
          <li><span class="step-number">01</span><div><strong>Connect your account</strong><p>MT5 broker · Server · Account</p></div>${icon('terminal')}</li>
          <li><span class="step-number">02</span><div><strong>Define your boundaries</strong><p>Position size · Loss limits · Drawdown</p></div>${icon('settings')}</li>
          <li><span class="step-number">03</span><div><strong>Configure automation</strong><p>Strategy · Symbol · Start / stop</p></div>${icon('bots')}</li>
        </ol>
        <div class="operations-foot">${icon('shield')}<p>Your broker account stays with your broker.<br><span>You choose the configuration.</span></p></div>
      </aside>
    </section>
    <section class="trust-bar"><span>SECURE IDENTITY</span><span>•</span><span>ROW-LEVEL ACCESS CONTROL</span><span>•</span><span>ENCRYPTED CREDENTIAL STORAGE</span><span>•</span><span>ADMIN REVIEW WORKFLOWS</span></section>

    <section id="platform" class="marketing-section">
      <div class="section-heading"><div class="marketing-kicker"><span></span> One focused operating layer</div><h2>Everything important, without the noise.</h2><p>Elite Bot brings the operational parts of automated trading into one deliberately simple interface.</p></div>
      <div class="bento">
        <article class="bento-card bento-wide"><div class="bento-icon">${icon('terminal')}</div><div><span class="card-label">MT5 CONNECTIONS</span><h3>Your broker accounts in one place.</h3><p>Submit MT5 connection details, follow connection status, and keep automation attached to the account you intend to use.</p></div><div class="mini-terminal"><span>Broker account</span><strong>Connection review</strong><small>Credentials are stored separately from public application data.</small></div></article>
        <article class="bento-card"><div class="bento-icon">${icon('bots')}</div><span class="card-label">AUTOMATION</span><h3>Configure before you run.</h3><p>Set strategy, symbol, lot size, stop loss, take profit, drawdown, and daily loss limits before issuing a start command.</p></article>
        <article class="bento-card"><div class="bento-icon">${icon('shield')}</div><span class="card-label">CONTROL</span><h3>Human approval where it matters.</h3><p>Critical account, payment, and access workflows use explicit states and administrator review instead of silent assumptions.</p></article>
        <article class="bento-card"><div class="bento-icon">${icon('wallet')}</div><span class="card-label">ACCESS</span><h3>Clear subscription status.</h3><p>See payment review status and access state directly in your workspace, with a traceable administrative workflow.</p></article>
        <article class="bento-card bento-accent"><div class="bento-icon">${icon('support')}</div><span class="card-label">SUPPORT</span><h3>A support thread tied to your workspace.</h3><p>Keep questions about payments, connections, and account access in one conversation history.</p><a href="/support">Open support ${icon('arrow')}</a></article>
      </div>
    </section>

    <section id="workflow" class="marketing-section workflow-section">
      <div class="section-heading"><div class="marketing-kicker"><span></span> Designed for clarity</div><h2>From account to automation in four deliberate steps.</h2></div>
      <div class="workflow-grid"><article><b>01</b><h3>Create your secure account</h3><p>Register, verify your identity flow, and protect access with available security controls.</p></article><article><b>02</b><h3>Activate platform access</h3><p>Submit an eligible payment reference and follow its review status transparently.</p></article><article><b>03</b><h3>Connect MT5</h3><p>Add the broker, account number, server, and credential required for the connection workflow.</p></article><article><b>04</b><h3>Configure and control</h3><p>Review risk parameters, attach the intended account, then start or stop automation intentionally.</p></article></div>
    </section>

    <section id="security" class="marketing-section security-section">
      <div class="security-copy"><div class="marketing-kicker"><span></span> Security architecture</div><h2>Built so sensitive actions have boundaries.</h2><p>Production data is persisted in PostgreSQL with row-level authorization. MT5 credentials are isolated from normal application tables and stored using Supabase Vault. Authentication uses Supabase Auth, with optional authenticator-based MFA in the workspace.</p><div class="security-list"><span>${icon('shield')} Row-level data access policies</span><span>${icon('shield')} Vault-backed MT5 credential storage</span><span>${icon('shield')} MFA support and protected admin operations</span><span>${icon('shield')} Audit records for administrative changes</span></div></div>
      <div class="security-visual" aria-label="Security boundaries"><div class="boundary"><span>01 / IDENTITY</span><strong>Protected sign-in</strong><p>Account access with optional authenticator verification.</p></div><div class="boundary"><span>02 / DATA</span><strong>Access scoped to you</strong><p>Row-level policies separate member and administrator access.</p></div><div class="boundary"><span>03 / CREDENTIALS</span><strong>Secrets stored separately</strong><p>MT5 passwords are held in encrypted Vault storage.</p></div></div>
    </section>

    <section class="marketing-section risk-panel"><div><div class="marketing-kicker"><span></span> Know the risk</div><h2>Automation does not remove market risk.</h2></div><div><p>Trading leveraged instruments can result in rapid losses. Elite Bot is software infrastructure—not a broker, investment adviser, portfolio manager, or promise of profitability. You remain responsible for your broker account, configuration, trading decisions, and compliance obligations.</p><a href="/risk-disclosure">Read the full Risk Disclosure ${icon('arrow')}</a></div></section>

    <section id="pricing" class="marketing-section pricing-section">
      <div class="section-heading"><div class="marketing-kicker"><span></span> Platform access</div><h2>A focused workspace for your trading operations.</h2><p>Pricing and payment methods shown after account creation are controlled by the platform administrator and displayed before you submit payment.</p></div>
      <div class="pricing-card"><div><span class="card-label">ELITE BOT ACCESS</span><h3>One workspace. Clear controls.</h3><ul><li>MT5 account connection workflow</li><li>Bot strategy and risk configuration</li><li>Subscription and payment status</li><li>Referral and pool tracking where enabled</li><li>Account security and support</li></ul></div><div class="pricing-action"><small>Start by creating your account</small><a class="marketing-cta" href="${dashboardHref}">${dashboardLabel}</a><p>No profit, return, or trading-outcome guarantee is made.</p></div></div>
    </section>

    <section class="marketing-section faq-section"><div class="section-heading"><div class="marketing-kicker"><span></span> Questions</div><h2>Understand the platform before you connect.</h2></div><div class="marketing-faq"><details><summary>Does Elite Bot guarantee profitable trades?</summary><p>No. Markets are uncertain and trading can lose money. The platform provides tooling and controls; it does not guarantee performance.</p></details><details><summary>Is Elite Bot a broker?</summary><p>No. Your trading account remains with your chosen broker. Elite Bot provides a workflow for connecting and controlling supported automation.</p></details><details><summary>Where are MT5 credentials stored?</summary><p>Production MT5 credentials are isolated from normal public application tables and stored using encrypted Supabase Vault infrastructure.</p></details><details><summary>Can I control the bot?</summary><p>The workspace exposes configuration plus explicit start and stop controls. Actual execution depends on the configured trading gateway and broker connection.</p></details></div></section>

    <section class="final-cta"><div class="marketing-kicker"><span></span> Ready when you are</div><h2>Build a cleaner trading workflow.</h2><p>Create your account, review the policies, and connect only when you understand the risks.</p><div class="hero-actions"><a class="marketing-cta" href="${dashboardHref}">${dashboardLabel}</a><a class="marketing-secondary" href="/terms">Review terms</a></div></section>`;
}
const legalDocuments = {
  '/terms': {
    kicker:'Legal / Terms',
    title:'Terms of Service',
    intro:'These Terms govern access to and use of Elite Bot and its related account, automation, payment, support, and administrative features.',
    sections:[
      ['1. Acceptance and eligibility','By creating an account or using the platform, you agree to these Terms and confirm that you are legally able to enter into them. You are responsible for ensuring that your use of automated trading software is lawful where you live and where your broker operates.'],
      ['2. What Elite Bot provides','Elite Bot provides software tools for account management, MT5 connection workflows, automation configuration, payment-status tracking, support, and related operational features. Elite Bot is not a bank, broker-dealer, investment adviser, exchange, custodian, or fiduciary.'],
      ['3. Trading responsibility','You decide whether to connect an account, configure automation, and issue start or stop commands. You are responsible for checking all settings, broker conditions, symbol specifications, leverage, margin, and open positions. No strategy or automated process is guaranteed to be profitable.'],
      ['4. Account security','You must provide accurate information, keep credentials secure, protect your authenticator devices, and promptly report suspected unauthorized access. You may not share access in a way that defeats platform security or access controls.'],
      ['5. Payments and access','Where paid access is offered, pricing, payment methods, and review status are shown before activation. Payment references may be manually verified. Access can be suspended for fraud, chargebacks, abuse, legal requirements, or material breach of these Terms.'],
      ['6. Prohibited use','You may not misuse the platform, probe or bypass security, automate abusive requests, interfere with other users, reverse engineer protected systems, use stolen credentials or funds, or use the service for unlawful activity.'],
      ['7. Availability and third parties','The service may depend on brokers, MT5 infrastructure, hosting providers, payment networks, messaging providers, and other third parties. Their availability, pricing, data, execution, and policies are outside Elite Bot’s direct control.'],
      ['8. No warranty','The platform is provided on an “as available” basis to the extent permitted by law. We do not warrant uninterrupted operation, error-free execution, specific broker compatibility, or financial performance.'],
      ['9. Limitation of liability','To the maximum extent permitted by applicable law, Elite Bot is not liable for trading losses, missed opportunities, broker actions, market movements, connectivity failures, third-party outages, or indirect or consequential losses arising from use of the platform.'],
      ['10. Changes and termination','We may update the service or these Terms when reasonably necessary for security, legal, operational, or product reasons. Material updates should be communicated through the platform or other reasonable means. You may stop using the service at any time.'],
      ['11. Contact','Questions about these Terms can be sent through the platform Support page.']
    ]
  },
  '/privacy': {
    kicker:'Legal / Privacy',
    title:'Privacy Policy',
    intro:'This policy explains the categories of information Elite Bot processes, why it is used, and the controls surrounding that data.',
    sections:[
      ['1. Information we process','We may process account identifiers, email address, profile name, authentication information, platform activity, payment references, support messages, referral relationships, bot configuration, MT5 account metadata, and technical security logs.'],
      ['2. Sensitive credentials','MT5 credentials are treated separately from ordinary application data. In production they are stored through encrypted secret-storage infrastructure and are retrieved only for authorized connection workflows. We do not display stored MT5 passwords back to users.'],
      ['3. Why we process information','Information is used to authenticate users, provide requested platform features, maintain account state, review payments, connect supported services, prevent abuse, provide support, enforce policies, audit administrative changes, and protect the platform.'],
      ['4. Service providers','We use infrastructure and service providers to operate the product, including authentication/database hosting and deployment infrastructure. Those providers process data subject to their own contractual and security obligations.'],
      ['5. Retention','We retain information for as long as reasonably necessary to provide the service, resolve disputes, meet security and legal obligations, maintain audit integrity, and enforce agreements. Retention periods can differ by data category.'],
      ['6. Your choices','You can update supported profile information in the workspace and can contact Support regarding account or privacy requests. Some records may need to be retained where required for security, financial reconciliation, fraud prevention, or law.'],
      ['7. Security','We use access controls, row-level authorization, encrypted secret storage, session controls, MFA capabilities, HTTPS, and administrative audit mechanisms. No online system can be guaranteed completely secure.'],
      ['8. International processing','Infrastructure providers may process data in jurisdictions different from your own. By using the service, you understand that cross-border processing may occur subject to applicable legal safeguards.'],
      ['9. Children','Elite Bot is not intended for children or anyone legally unable to use the relevant trading or financial services in their jurisdiction.'],
      ['10. Contact and updates','Privacy questions can be submitted through Support. We may revise this policy as the service, legal requirements, or data practices change.']
    ]
  },
  '/risk-disclosure': {
    kicker:'Legal / Risk',
    title:'Trading Risk Disclosure',
    intro:'Read this disclosure carefully before connecting a brokerage account or enabling any automated trading function.',
    sections:[
      ['Trading can result in substantial loss','Foreign exchange, CFDs, derivatives, leveraged products, cryptocurrencies, and other traded instruments can move rapidly. Leverage can magnify both gains and losses and may result in losses exceeding amounts you expected to risk, depending on broker terms and jurisdiction.'],
      ['Automation introduces additional risks','Automated strategies may behave differently during gaps, high volatility, illiquidity, news events, rejected orders, connectivity loss, incorrect symbol mapping, abnormal spreads, slippage, latency, broker restrictions, or software faults.'],
      ['Past results do not predict future outcomes','Historical, simulated, back-tested, administrator-reported, or previously observed results do not guarantee future performance. Any displayed pool or account figures should be understood in context and independently verified where appropriate.'],
      ['You remain responsible','You are responsible for deciding whether trading is appropriate for you, selecting your broker, funding your account, reviewing settings, monitoring positions, and stopping automation when necessary. Consider independent financial, legal, and tax advice where appropriate.'],
      ['No investment advice or fiduciary relationship','Platform functionality, interfaces, settings, examples, alerts, support responses, and educational content are not individualized investment advice and do not create a fiduciary relationship.'],
      ['Only risk capital you can afford to lose','Do not trade money needed for living expenses, debt obligations, emergency savings, or other essential purposes. If you do not understand a product, strategy, or risk control, do not enable it until you do.']
    ]
  },
  '/refund-policy': {
    kicker:'Legal / Payments',
    title:'Refund Policy',
    intro:'This policy describes how refund requests for platform-access payments are handled.',
    sections:[
      ['Before activation','If a payment has been submitted but platform access has not yet been activated, contact Support promptly. Eligibility for cancellation or refund depends on whether funds have been received, payment-network limitations, and any processing costs.'],
      ['After activation','Because access may be provisioned digitally and immediately after approval, payments may become non-refundable once access has been activated, except where applicable law requires otherwise or a confirmed duplicate/incorrect payment has occurred.'],
      ['Trading losses are not refundable','Market losses, broker losses, missed trades, strategy outcomes, spread/slippage, or dissatisfaction with trading performance are not grounds for refund of a software-access payment.'],
      ['Crypto and network errors','Blockchain transfers are generally irreversible. Users are responsible for using the exact asset, address, and network displayed by the platform. Funds sent to an incorrect network or address may be unrecoverable.'],
      ['How to request review','Open a Support conversation with the payment reference and relevant details. Requests are reviewed individually and may require proof of payment or identity verification.']
    ]
  },
  '/cookies': {
    kicker:'Legal / Cookies',
    title:'Cookie & Local Storage Policy',
    intro:'Elite Bot uses a limited set of browser storage mechanisms that are necessary for account access, preferences, and product operation.',
    sections:[
      ['Essential storage','The application may use cookies or local browser storage for authentication/session continuity, guest support conversations, theme preference, and security-related state.'],
      ['No trading decisions from cookies','Browser storage is not used to decide trades, change strategy parameters, or guarantee any financial outcome.'],
      ['Third-party services','Authentication, hosting, abuse prevention, or other integrated services may set or rely on their own necessary browser data under their respective policies.'],
      ['Your controls','You can clear cookies and local storage in your browser settings, but doing so may sign you out, reset preferences, or interrupt support/session continuity.']
    ]
  }
};
function legalPage(path) {
  const doc = legalDocuments[path];
  return `<section class="legal-hero"><div class="marketing-kicker"><span></span> ${doc.kicker}</div><h1>${doc.title}</h1><p>${doc.intro}</p><small>Last updated: October 1, 2026</small></section><section class="legal-layout"><aside><strong>Legal center</strong><a class="${path==='/terms'?'active':''}" href="/terms">Terms of Service</a><a class="${path==='/privacy'?'active':''}" href="/privacy">Privacy Policy</a><a class="${path==='/risk-disclosure'?'active':''}" href="/risk-disclosure">Risk Disclosure</a><a class="${path==='/refund-policy'?'active':''}" href="/refund-policy">Refund Policy</a><a class="${path==='/cookies'?'active':''}" href="/cookies">Cookie Policy</a></aside><article class="legal-document">${doc.sections.map(([title,body])=>`<section><h2>${title}</h2><p>${body}</p></section>`).join('')}<div class="legal-note">This policy is intended to describe the platform’s operating terms and practices. Specific legal rights can vary by jurisdiction.</div></article></section>`;
}
function authPage(path) {
  const mfa = state.requiresMfa && path === '/login';
  const title = mfa ? 'Verify your sign-in' : ({ '/login':'Welcome back.', '/signup':'Create your account.', '/resend-confirmation':'Resend confirmation.', '/forgot-password':'Reset your password.', '/reset-password':'Choose a new password.' })[path];
  document.title = `${title} · Elite Bot`;
  let contents;
  if (mfa) contents = form('mfa-login', field('Authenticator code','code','','text','required inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" maxlength="6"'), 'Verify and sign in') + `<div class="auth-bottom">${btn('Use a different account','logout','','class="ghost"')}</div>`;
  else if (path === '/login') contents = form('login', field('Email address','email','','email','required autocomplete="email"') + password('Password','password') + '<div class="auth-links"><a href="/forgot-password">Forgot password?</a><a href="/support">Need help?</a></div>', 'Sign in') + '<div class="auth-bottom">New to Elite Bot? <a href="/signup">Create an account</a></div>' + (state.config.demoMode ? '<div class="auth-bottom"><button type="button" class="ghost" data-action="demo">Continue as Demo</button></div>' : '');
  else if (path === '/signup') contents = form('signup', field('Full name','name','','text','required minlength="2" maxlength="64" autocomplete="name"') + field('Email address','email','','email','required autocomplete="email"') + password('Password','password','new-password') + '<small>Use at least 12 characters.</small>' + field('Referral code · optional','referral',new URLSearchParams(location.search).get('ref') || '', 'text','maxlength="30"') + '<label class="check legal-consent"><input type="checkbox" name="terms" required> <span>I agree to the <a href="/terms">Terms</a>, <a href="/privacy">Privacy Policy</a>, and <a href="/risk-disclosure">Risk Disclosure</a>.</span></label>', 'Create account') + '<div class="auth-bottom">Already registered? <a href="/login">Sign in</a> · <a href="/resend-confirmation">Resend confirmation</a></div>';
  else if (path === '/resend-confirmation') contents = form('resend-confirmation-form', field('Email address','email',new URLSearchParams(location.search).get('email') || '','email','required autocomplete="email"'), 'Resend confirmation email') + '<div class="auth-bottom"><a href="/login">Back to sign in</a></div>';
  else if (path === '/forgot-password') contents = form('forgot', field('Email address','email','','email','required autocomplete="email"'), 'Send recovery link') + '<div class="auth-bottom"><a href="/login">Back to sign in</a></div>';
  else contents = form('reset', password('New password','password','new-password') + password('Confirm password','confirm','new-password'), 'Reset password') + '<div class="auth-bottom"><a href="/login">Back to sign in</a></div>';
  root.innerHTML = `<main id="main" class="auth-wrap" tabindex="-1"><section class="auth-story">${publicBrand}<div class="eyebrow">Built for your next move</div><h2 class="auth-title">Your trading.<br><em>In focus.</em></h2><p>A clear view of your accounts, trading bots, and everything that keeps you connected.</p><div class="auth-features"><div class="auth-feature">${icon('terminal')}<div><strong>One connected workspace</strong><p>Keep your MT5 accounts and bot controls together.</p></div></div><div class="auth-feature">${icon('shield')}<div><strong>Stay in control</strong><p>Manage risk settings, account access, and security.</p></div></div></div><footer><small>Trading involves risk. Performance is not guaranteed.</small></footer></section><section class="auth-form-side"><div class="auth-theme">${themeButton()}</div><div class="auth-form"><a class="auth-home" href="/">${icon("terminal")} Elite Bot</a><div class="eyebrow">ELITE BOT / ACCOUNT</div><h1>${title}</h1><p>${mfa ? 'Enter the six-digit code from your authenticator app.' : path === '/signup' ? 'Your trading workspace starts here.' : path === '/resend-confirmation' ? 'Request a fresh verification link for an unconfirmed account.' : path === '/login' ? 'Sign in to continue to your workspace.' : 'Secure access to your trading workspace.'}</p>${contents}</div></section></main>`;
}
const activation = () => state.user.active || state.user.role === 'admin' ? '' : '<div class="notice">Activate your subscription to connect an MT5 account and start trading bots. <a href="/subscription">View subscription</a></div>';
async function terminalPage() {
  const data = await api('/accounts'); state.data.accounts = data.accounts;
  const connected = data.accounts.filter(a => a.status === 'connected').length;
  return heading('MT5 terminal', 'Your accounts. A clear view of every connection.', btn(`${icon('plus')} Add account`, 'account-add', '', 'class="primary"')) + (state.config.tradingEnabled === false && state.config.gatewayConfigured ? '<div class="notice">MT5 demo and real accounts are supported. Account data is available after review; automated trading is not enabled.</div>' : '') + activation() + `<div class="stats">${stat('Connected accounts',connected)}${stat('Accounts in review',data.accounts.filter(a => a.status === 'pending').length)}${stat('Account connection',state.config.tradingEnabled === false && state.config.gatewayConfigured ? 'Account data' : data.gatewayConfigured ? 'Configured' : 'Not connected')}</div>` + (!data.gatewayConfigured ? '<div class="notice">Live account data and trading will become available when your administrator connects the MT5 service. You can save account details for review after activation.</div>' : '') + (data.accounts.length ? data.accounts.map(account => `<article class="card account-card"><div class="terminal-status"><div><h2>${esc(account.broker)}</h2><small class="mono">${esc(account.login)} · ${esc(account.server)}</small></div>${badge(account.status)}</div>${account.snapshot ? `<div class="detail-grid"><div><small>Balance</small><div class="value">${account.snapshot.balance === undefined ? '—' : money(account.snapshot.balance * 100,account.snapshot.currency)}</div></div><div><small>Equity</small><div class="value">${account.snapshot.equity === undefined ? '—' : money(account.snapshot.equity * 100,account.snapshot.currency)}</div></div></div><small>Updated ${date(account.snapshot.updatedAt)}</small>` : '<p class="muted account-note">Account figures appear after the trading connection is confirmed.</p>'}${account.note ? `<p class="meta">${esc(account.note)}</p>` : ''}<div class="actions"><a href="/bots" class="button-link">Manage bots ${icon('arrow')}</a>${btn('Remove account','account-delete',account.id,'class="danger"')}</div></article>`).join('') : empty('Connect your first MT5 account','Add your broker and terminal details to request a connection.',btn('Add MT5 account','account-add','','class="primary"')));
}
async function botsPage() {
  const [data, accounts] = await Promise.all([api('/bots'),api('/accounts')]); state.data.bots = data.bots; state.data.accounts = accounts.accounts;
  return heading('Trading bots','Configure your strategy and monitor execution.') + (state.config.tradingEnabled === false && state.config.gatewayConfigured ? '<div class="notice">Account verification and balances are available for connected demo and real accounts. Automated trading is not enabled.</div>' : '') + activation() + '<div class="notice">Start and stop commands require confirmation from the connected trading service. Review your risk settings before starting a bot.</div>' + data.bots.map(bot => `<article class="card account-card"><div class="card-head"><div><div class="eyebrow">${esc(bot.symbol)} / ${esc(bot.strategy)}</div><h2>${esc(bot.name)}</h2></div>${badge(bot.status)}</div><div class="grid three"><div><small>Risk per trade</small><h2>${esc(bot.risk_percent)}%</h2></div><div><small>Daily loss limit</small><h2>${esc(bot.daily_loss)}%</h2></div><div><small>Maximum drawdown</small><h2>${esc(bot.max_drawdown)}%</h2></div></div><div class="bot-control"><div><strong>${esc(accounts.accounts.find(a => a.id === bot.account_id)?.login || 'No account selected')}</strong><div class="meta">${esc(bot.lot_size)} lots · SL ${esc(bot.stop_loss)}% · TP ${esc(bot.take_profit)}%</div></div><div class="actions">${btn('Configure','bot-edit',bot.id,bot.status !== 'stopped' ? 'disabled' : '')}${btn(bot.status === 'stopped' ? 'Start bot' : 'Stop bot','bot-control',bot.id,`class="${bot.status === 'stopped' ? 'primary' : 'danger'}" ${state.config.tradingEnabled === false && state.config.gatewayConfigured ? 'disabled' : ''}`)}</div></div></article>`).join('');
}
async function subscriptionPage() {
  const [methods,payments] = await Promise.all([api('/payment-methods'),api('/payments')]); state.data.methods = methods.methods;
  return heading('Your subscription','Manage access and track your payments.') + `<div class="grid"><section class="card"><div class="card-head"><h2>Elite Bot · Lifetime</h2>${badge(state.user.active ? 'active' : 'inactive')}</div><div class="sub-price">${money(methods.priceCents)}</div><p class="muted">One-time subscription payment</p><ul class="feature-list"><li>MT5 account management</li><li>Trading bot configuration and controls</li><li>Pool access and referral tracking</li><li>Account security and support</li></ul>${state.user.active ? '<p class="notice">Your lifetime subscription is active.</p>' : methods.methods.length ? paymentForm(methods.methods) : empty('Payments are not available yet','Your administrator needs to add a payment method. <a href="/support">Contact support</a>')}</section><section class="card"><h2>Payment history</h2>${paymentHistory(payments.payments)}</section></div>`;
}
function paymentHistory(payments) { return payments.length ? table(['Type / date','Amount','Status'], payments.map(p => `<tr><td class="wrap">${esc(p.kind)}<br><small>${date(p.created_at)}</small><br><span class="mono">${esc(p.reference)}</span>${p.note ? `<p class="meta">${esc(p.note)}</p>` : ''}</td><td>${money(p.amount_cents)}</td><td>${badge(p.status)}</td></tr>`)) : empty('No payments yet','Submitted payments and their review status will appear here.'); }
function paymentForm(methods, round = null) {
  return form('payment', `<input type="hidden" name="kind" value="${round ? 'pool' : 'subscription'}">${round ? `<input type="hidden" name="roundId" value="${esc(round.id)}">${field('Contribution in USD','amount','','number','required min="1" max="10000000" step="0.01"')}` : ''}${select('Payment method','methodId',methods[0].id,methods.map(m => [m.id,m.name]))}<div id="payment-info">${methodInfo(methods[0])}</div>${field('Transaction reference','reference','','text','required minlength="6" maxlength="200" placeholder="Enter the reference after making your payment"')}<small>Send funds using the details above, then submit the transaction reference. Access is activated after an administrator verifies the payment.</small>`, 'Submit for review');
}
function methodInfo(m) { return `<div class="payment-details"><strong>${esc(m.name)}</strong>${m.network ? `<p class="meta">Network: ${esc(m.network)}</p>` : ''}<p class="mono">${esc(m.details)}</p>${btn('Copy payment details','copy',m.details,'class="ghost"')}${m.instructions ? `<p class="meta">${esc(m.instructions)}</p>` : ''}</div>`; }
async function poolPage() {
  const [data,methods] = await Promise.all([api('/pool'),api('/payment-methods')]); state.data.rounds = data.rounds; state.data.methods = methods.methods;
  return heading('Live pool','Track rounds and your approved contributions.') + activation() + '<div class="notice">Pool performance is reported by the administrator. Contributions are recorded after payment verification; returns are not guaranteed.</div>' + (data.rounds.length ? `<div class="grid">${data.rounds.map(r => `<article class="card"><div class="card-head"><h2>${esc(r.name)}</h2>${badge(r.status)}</div><div class="sub-price">${money(r.raised_cents)}</div><p class="meta">of ${money(r.goal_cents)} target · ${r.traders} participants</p><progress class="progress" value="${r.raised_cents}" max="${r.goal_cents}" aria-label="Pool funding progress"></progress><div class="detail-grid"><div><small>Your contribution</small><p>${money(r.allocation_cents)}</p></div><div><small>Reported pool profit / loss</small><p>${money(r.profit_cents)}</p></div></div><p class="meta">${date(r.starts_at)} — ${date(r.ends_at)}</p><div class="actions">${btn('Contribute','pool-contribute',r.id,`class="primary" ${r.status !== 'open' || r.ends_at <= Date.now() ? 'disabled' : ''}`)}</div></article>`).join('')}</div>` : empty('No pool rounds are open','New rounds and your contribution history will appear here.'));
}
async function referralsPage() {
  const d = await api('/referrals'); state.data.referrals = d;
  return heading('Grow your network','Track referrals and request earned commissions.') + `<div class="stats">${stat('Total earned',money(d.earnedCents))}${stat('Available to request',money(d.availableCents))}${stat('Referred members',d.team.length)}</div><div class="grid"><section class="card"><h2>Your invitation link</h2><p class="meta">Share this link. Eligible commissions are recorded when a referred member’s subscription payment is approved.</p><div class="copy-box"><input aria-label="Referral link" readonly value="${esc(d.link)}">${btn('Copy link','copy',d.link)}</div><hr><h2>Commission payouts</h2>${d.payouts.length ? table(['Requested','Amount','Status'],d.payouts.map(p => `<tr><td>${date(p.created_at)}${p.reference ? `<br><small>${esc(p.reference)}</small>` : ''}</td><td>${money(p.amount_cents)}</td><td>${badge(p.status)}</td></tr>`)) : '<p class="meta">No payout requests yet.</p>'}<div class="actions">${btn('Request payout','payout','','class="primary"' + (d.availableCents < 100 ? ' disabled' : ''))}</div><p class="meta">Support will coordinate your payout destination before any transfer.</p></section><section class="card"><h2>Your network</h2>${d.team.length ? table(['Member','Joined','Commission'],d.team.map(u => `<tr><td>${esc(u.name)}</td><td>${date(u.created_at)}</td><td>${money(u.earned_cents)}</td></tr>`)) : empty('Your network starts with one invitation','Share your link to invite a member.')}</section></div>`;
}
function settingsPage() {
  return heading('Account settings','Your profile, password, and sign-in security.') + `<div class="grid"><section class="card"><h2>Profile</h2>${form('profile',field('Full name','name',state.user.name,'text','required minlength="2" maxlength="64" autocomplete="name"') + field('Email address','email',state.user.email,'email','disabled') + '<small>Contact support if your sign-in email needs to change.</small>')}</section><section class="card"><h2>Password</h2>${form('password',password('Current password','currentPassword') + password('New password','password','new-password') + password('Confirm new password','confirm','new-password') + (state.user.mfaEnabled ? field('Authenticator code','code','','text','required pattern="[0-9]{6}" inputmode="numeric" maxlength="6" autocomplete="one-time-code"') : ''), 'Update password')}</section><section class="card"><h2>Two-factor authentication</h2><div class="action-line"><div>${badge(state.user.mfaEnabled ? 'active' : 'inactive')}<p>Add a second sign-in step with an authenticator app.</p></div>${btn(state.user.mfaEnabled ? 'Disable' : 'Set up','mfa-setup','','class="ghost"')}</div></section><section class="card"><h2>Session</h2><p class="meta">Signed in as ${esc(state.user.email)}. Updating your password signs out all sessions.</p><div class="actions">${btn('Sign out','logout','','class="danger"')}</div></section></div>`;
}
async function supportPage(admin = false) {
  const d = await api(admin ? '/admin/support' : '/support'); state.data.chats = d.conversations;
  if (!d.conversations.some(c => c.id === state.chat)) state.chat = d.conversations[0]?.id || null;
  const chatBody = state.chat ? await chatContent(state.chat) : empty(admin ? 'Your inbox is clear' : 'How can we help?',admin ? 'New customer conversations will appear here.' : 'Start a conversation with the support team.');
  return heading(admin ? 'Support inbox' : 'Support',admin ? 'Read and respond to customer conversations.' : 'Get help with your account, payments, and trading connection.',admin ? '' : btn(`${icon('plus')} New conversation`,'chat-create','','class="primary"')) + `<section class="card"><div class="chat-layout"><div class="chat-list" aria-label="Conversations">${d.conversations.map(c => btn(`<strong>${esc(c.name)}</strong><small>${date(c.updated_at)} · ${esc(c.status)}</small>`,'chat-select',c.id,`class="${c.id === state.chat ? 'selected' : ''}"`)).join('') || '<p class="meta">No conversations yet.</p>'}</div><div id="chat-panel">${chatBody}</div></div></section>${admin ? '' : '<section class="card help-list support-faq"><h2>Quick answers</h2><details><summary>How do I activate my account?</summary><p>Choose a payment method on the Subscription page, complete your payment, and submit its reference. An administrator verifies the funds before activating access.</p></details><details><summary>Why is my MT5 connection pending?</summary><p>Your account details need administrator review and a confirmed connection to your broker. Support can help check the broker, server, login, and password.</p></details><details><summary>How do I recover my password?</summary><p>Use <a href="/forgot-password">password recovery</a> to request a single-use link. Contact support if email recovery is unavailable.</p></details><details><summary>Which payment network should I use?</summary><p>Use the exact network listed for your chosen payment method. Check its instructions before sending funds.</p></details></section>'}`;
}
async function chatContent(id) {
  const d = await api(`/support/${id}`); state.data.currentChat = d.conversation;
  return `<div class="card-head"><h2>${esc(d.conversation.name)}</h2><div>${badge(d.conversation.status)} ${state.user?.role === 'admin' && d.conversation.status === 'open' ? btn('Close conversation','chat-close',id) : ''}</div></div><div class="messages" id="messages" aria-label="Conversation messages" aria-live="polite">${messagesHtml(d.messages)}</div>${d.conversation.status === 'open' ? `<form data-form="chat-message" data-id="${esc(id)}"><div class="chat-form"><textarea name="message" aria-label="Your message" placeholder="Write a message…" required maxlength="4000"></textarea><button type="submit" class="primary">Send</button></div><p class="error" role="alert"></p></form>` : '<p class="meta">This conversation is closed.</p>'}`;
}
function messagesHtml(messages) { return messages.map(m => `<div class="message ${esc(m.sender)}"><small>${m.sender === 'admin' ? 'Support team' : 'Customer'}</small><p>${esc(m.body)}</p><small>${date(m.created_at)}</small></div>`).join('') || '<p class="meta">Send a message to begin.</p>'; }
async function refreshChat() {
  if (!state.chat || !document.querySelector('#messages')) return;
  const chatId = state.chat, d = await api(`/support/${chatId}`); if (state.chat !== chatId) return;
  const el = document.querySelector('#messages'); if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
  el.innerHTML = messagesHtml(d.messages); if (atBottom) el.scrollTop = el.scrollHeight;
  if (d.conversation.status !== state.data.currentChat?.status) { document.querySelector('#chat-panel').innerHTML = await chatContent(chatId); }
}
async function adminPage() {
  const d = await api('/admin/overview'); state.data.admin = d;
  const tabs = [['payments','Payments'],['users','Members'],['accounts','MT5 accounts'],['methods','Payment methods'],['rounds','Pool rounds'],['payouts','Payouts'],['settings','Configuration'],['audit','Activity']];
  let content = '';
  if (state.adminTab === 'payments') content = d.payments.length ? table(['Member / reference','Amount','Type','Status','Review'],d.payments.map(p => `<tr><td class="wrap">${esc(p.email)}<br><small class="mono">${esc(p.reference)}</small><br><small>${date(p.created_at)}</small></td><td>${money(p.amount_cents)}</td><td>${esc(p.kind)}</td><td>${badge(p.status)}</td><td>${p.status === 'pending' ? btn('Review','payment-review',p.id) : esc(p.note || 'Reviewed')}</td></tr>`)) : empty('No payment submissions','Payments awaiting verification will appear here.');
  if (state.adminTab === 'users') content = `<input id="member-search" class="search" type="search" aria-label="Search members" placeholder="Search by name or email…">` + table(['Member','Access','Role','Joined','Manage'],d.users.map(u => `<tr data-member="${esc(`${u.name} ${u.email}`.toLowerCase())}"><td class="wrap">${esc(u.name)}<br><small>${esc(u.email)}</small></td><td>${badge(u.disabled ? 'disabled' : u.active ? 'active' : 'inactive')}</td><td>${esc(u.role)}</td><td>${date(u.created_at)}</td><td>${btn('Edit access','user-edit',u.id)}</td></tr>`));
  if (state.adminTab === 'accounts') content = d.accounts.length ? table(['Member','Broker / account','Status','Review'],d.accounts.map(a => `<tr><td>${esc(a.email)}</td><td>${esc(a.broker)}<br><small>${esc(a.login)} · ${esc(a.server)}</small></td><td>${badge(a.status)}</td><td>${btn('Review','account-review',a.id)}</td></tr>`)) : empty('No MT5 accounts','Member connection requests will appear here.');
  if (state.adminTab === 'methods') content = `<div class="actions toolbar">${btn('Add payment method','method-edit','','class="primary"')}</div>` + (d.methods.length ? table(['Method','Details','Availability','Manage'],d.methods.map(m => `<tr><td>${esc(m.name)}<br><small>${esc(m.kind)} ${esc(m.network)}</small></td><td class="wrap mono">${esc(m.details)}</td><td>${badge(m.enabled ? 'active' : 'disabled')}</td><td>${btn('Edit','method-edit',m.id)}</td></tr>`)) : empty('Add a payment method','Members can submit payments once a method is enabled.'));
  if (state.adminTab === 'rounds') content = `<div class="actions toolbar">${btn('Create pool round','round-edit','','class="primary"')}</div>` + (d.rounds.length ? table(['Round','Target','Reported profit / loss','Status','Manage'],d.rounds.map(r => `<tr><td>${esc(r.name)}<br><small>${date(r.ends_at)}</small></td><td>${money(r.goal_cents)}</td><td>${money(r.profit_cents)}</td><td>${badge(r.status)}</td><td>${btn('Edit','round-edit',r.id)}</td></tr>`)) : empty('No pool rounds','Create a round to accept contributions.'));
  if (state.adminTab === 'payouts') content = d.payouts.length ? table(['Member','Amount','Status','Review'],d.payouts.map(p => `<tr><td>${esc(p.email)}</td><td>${money(p.amount_cents)}</td><td>${badge(p.status)}</td><td>${p.status === 'pending' ? btn('Review payout','payout-review',p.id) : esc(p.reference || '—')}</td></tr>`)) : empty('No payout requests','Referral commission requests will appear here.');
  if (state.adminTab === 'settings') content = `<div class="grid"><section>${form('admin-settings',field('Lifetime subscription price · USD','price',d.priceCents / 100,'number','required min="1" step="0.01" max="10000000"') + field('Telegram administrator chat ID','telegramChat',d.telegramChat,'text','maxlength="100"'))}<div class="actions">${btn('Send test alert','telegram-test')}</div></section><section><h2>Service status</h2><div class="service-row"><span>Password recovery email</span>${badge(state.config.emailConfigured ? 'active' : 'disconnected')}</div><div class="service-row"><span>MT5 trading service</span>${badge(state.config.gatewayConfigured ? 'active' : 'disconnected')}</div><div class="service-row"><span>Telegram alerts</span>${badge(state.config.telegramConfigured ? 'active' : 'disconnected')}</div><p class="meta">Service credentials are configured on the server. Payment approvals and pool results are recorded manually by administrators.</p></section></div>`;
  if (state.adminTab === 'audit') content = d.audit.length ? table(['Time','Administrator','Action','Record'],d.audit.map(a => `<tr><td>${date(a.created_at)}</td><td>${esc(a.email || 'System')}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.target)}</td></tr>`)) : empty('No administrative activity','Changes to access, payments, and configuration will be recorded here.');
  return heading('Administration','Manage members, payments, and connected services.') + `<div class="stats">${stat('Members',d.users.length)}${stat('Pending payments',d.payments.filter(p => p.status === 'pending').length)}${stat('Pending connections',d.accounts.filter(a => a.status === 'pending').length)}</div><div class="tabs" role="tablist" aria-label="Administration sections">${tabs.map(([id,label]) => btn(label,'admin-tab',id,`role="tab" aria-selected="${state.adminTab === id}" class="${state.adminTab === id ? 'selected' : ''}"`)).join('')}</div><section class="card" role="tabpanel">${content}</section>`;
}
async function render({ quiet = false } = {}) {
  const version = ++state.version; let path = location.pathname;
  setWorkspaceMenu(false,false);
  if (path === '/dashboard') { path = state.user ? '/mt5' : '/login'; history.replaceState(null,'',path); }
  if (path === '/logout') { await logout(); return; }
  const auth = ['/login','/signup','/resend-confirmation','/forgot-password','/reset-password'].includes(path);
  const publicRoutes = ['/','/support','/terms','/privacy','/risk-disclosure','/refund-policy','/cookies'];
  if (!state.user && !auth && !publicRoutes.includes(path)) { history.replaceState(null,'','/login'); authPage('/login'); return; }
  if (auth) { if (state.user && ['/login','/signup'].includes(path)) { navigate('/mt5',true); return; } authPage(path); return; }
  if (path.startsWith('/admin') && state.user?.role !== 'admin') { shell(empty('Administrator access required','This page is available to administrators only.')); return; }
  if (!quiet) (state.user ? shell : publicShell)('<div class="loading" aria-busy="true">Loading your workspace…</div>');
  try {
    const pages = { '/':marketingPage,'/terms':()=>legalPage('/terms'),'/privacy':()=>legalPage('/privacy'),'/risk-disclosure':()=>legalPage('/risk-disclosure'),'/refund-policy':()=>legalPage('/refund-policy'),'/cookies':()=>legalPage('/cookies'),'/mt5':terminalPage,'/bots':botsPage,'/subscription':subscriptionPage,'/subscribe':subscriptionPage,'/pool':poolPage,'/referrals':referralsPage,'/settings':settingsPage,'/support':supportPage,'/admin':adminPage,'/admin/support':() => supportPage(true) };
    const content = pages[path] ? await pages[path]() : empty('Page not found','<a href="/mt5">Return to your workspace</a>');
    if (version !== state.version) return;
    (state.user ? shell : publicShell)(content); connectEvents();
    const messages = document.querySelector('#messages'); if (messages) messages.scrollTop = messages.scrollHeight;
    const pageTitle = path === '/' ? 'Elite Bot · MT5 Trading Automation Platform' : `${document.querySelector('h1')?.textContent || 'Workspace'} · Elite Bot`;
    document.title = pageTitle;
  } catch (error) { if (version !== state.version) return; if (error.status === 401) { state.user = null; navigate('/login',true); } else (state.user ? shell : publicShell)(empty('Unable to load this page',esc(error.message),btn('Try again','refresh'))); }
}
function navigate(path, replace = false) { if (modal.open) modal.close(); history[replace ? 'replaceState' : 'pushState'](null,'',path); window.scrollTo(0,0); render().then(() => document.querySelector('#main')?.focus({preventScroll:true})); }
async function logout() {
  const accessToken = state.auth?.access_token || '';
  if (accessToken) await supabaseAuth('logout','POST',{},accessToken).catch(() => {});
  clearAuth();
  state.user = null;
  state.requiresMfa = false;
  state.csrf = null;
  state.chat = null;
  state.stream?.close();
  state.stream = null;
  navigate('/login',true);
}
function accountModal() { openModal('Add MT5 account',form('account',field('Broker','broker','','text','required minlength="2" maxlength="100" placeholder="Your broker name"') + field('MT5 account number','login','','text','required inputmode="numeric" pattern="[0-9]+" maxlength="30"') + field('Server','server','','text','required minlength="2" maxlength="100" placeholder="Exact server name from MT5"') + password('MT5 password','password') + '<p class="meta">Use the exact broker server for your demo or real MT5 account. Your encrypted credentials are shared with the connection provider after administrator approval. An investor password is recommended for account data access.</p>', 'Save account')); }
function botModal(id) {
  const b = state.data.bots.find(b => b.id === id);
  openModal('Configure trading bot',form('bot',`<div class="form-grid">${field('Bot name','name',b.name,'text','required minlength="2" maxlength="64"')}${field('Broker symbol','symbol',b.symbol,'text','required maxlength="30"')}${select('MT5 account','accountId',b.account_id || '',[['','Select an account'],...state.data.accounts.map(a => [a.id,`${a.broker} · ${a.login}`])])}${select('Strategy','strategy',b.strategy,[['trend','Trend'],['scalping','Scalping'],['breakout','Breakout']])}${[['Risk per trade · %','riskPercent',b.risk_percent,.1,5],['Stop loss · %','stopLoss',b.stop_loss,.1,20],['Take profit · %','takeProfit',b.take_profit,.1,50],['Maximum drawdown · %','maxDrawdown',b.max_drawdown,1,30],['Daily loss limit · %','dailyLoss',b.daily_loss,.1,10],['Lot size','lotSize',b.lot_size,.01,10]].map(([l,n,v,min,max]) => field(l,n,v,'number',`required min="${min}" max="${max}" step="0.01"`)).join('')}</div>`, 'Save configuration',id));
}
function methodModal(id) { const m = state.data.admin.methods.find(m => m.id === id) || { enabled:1, kind:'bank' }; openModal(id ? 'Edit payment method' : 'Add payment method',form('method',field('Method name','name',m.name,'text','required minlength="2" maxlength="100"') + select('Type','kind',m.kind,[['bank','Bank transfer'],['mobile_money','Mobile money'],['crypto','Cryptocurrency']]) + textarea('Account or wallet details','details',m.details,'required minlength="3" maxlength="500"') + field('Network · required for crypto','network',m.network,'text','maxlength="100"') + textarea('Instructions','instructions',m.instructions,'maxlength="1000"') + select('Availability','enabled',String(!!m.enabled),[['true','Enabled'],['false','Disabled']]),'Save payment method',id)); }
function localDate(value) { const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,16); }
function roundModal(id) { const r = state.data.admin.rounds.find(r => r.id === id) || { status:'open',starts_at:Date.now(),ends_at:Date.now()+7*86400000,goal_cents:100000,profit_cents:0 }; openModal(id ? 'Edit pool round' : 'Create pool round',form('round',field('Round name','name',r.name,'text','required minlength="2" maxlength="100"') + `<div class="form-grid">${field('Target · USD','goal',r.goal_cents/100,'number','required min="1" max="10000000" step="0.01"')}${field('Reported profit / loss · USD','profit',r.profit_cents/100,'number','required min="-10000000" max="10000000" step="0.01"')}${field('Starts','startsAt',localDate(r.starts_at),'datetime-local','required')}${field('Ends','endsAt',localDate(r.ends_at),'datetime-local','required')}</div>` + select('Status','status',r.status,[['open','Open for contributions'],['trading','Trading'],['closed','Closed']]),'Save pool round',id)); }
const actions = {
  'resend-confirmation': async email => {
    await supabaseAuth(`resend?redirect_to=${encodeURIComponent(AUTH_REDIRECT_ORIGIN + '/login')}`,'POST',{ type:'signup', email });
    toast('If this address is awaiting confirmation, a new confirmation email has been requested. Check your inbox and spam folder.');
  },
  demo: async () => { const d = await api('/auth/demo','POST'); state.user = d.user; state.requiresMfa = false; navigate('/mt5',true); },
  theme: () => { const theme = document.body.classList.contains('light') ? 'dark' : 'light'; applyTheme(theme); try { localStorage.setItem('elite-theme',theme); } catch {} },
  menu: () => setWorkspaceMenu(!document.body.classList.contains('menu-open')),
  close: () => modal.close(),
  password: (id,button) => { const input = document.getElementById(id); input.type = input.type === 'password' ? 'text' : 'password'; button.setAttribute('aria-label',input.type === 'password' ? 'Show password' : 'Hide password'); button.setAttribute('aria-pressed',String(input.type === 'text')); },
  copy: async value => { await navigator.clipboard.writeText(value); toast('Copied to clipboard.'); },
  refresh: async () => { await identity(); await render(); }, logout,
  'account-add':accountModal,
  'account-delete': id => openModal('Remove MT5 account',form('account-delete','<p>Disconnect and remove this account? All bots must be stopped first.</p>','Remove account',id)),
  'bot-edit':botModal,
  'bot-control': id => { const b = state.data.bots.find(b => b.id === id); openModal(b.status === 'stopped' ? 'Start trading bot' : 'Stop trading bot',form('bot-control',`<p>${b.status === 'stopped' ? `Start ${esc(b.name)} on ${esc(b.symbol)} using the saved risk settings? The connected trading service will execute this command.` : 'Send a stop command to the trading service. Existing positions may remain open; check your MT5 terminal.'}</p><input type="hidden" name="running" value="${b.status === 'stopped'}">`,b.status === 'stopped' ? 'Start bot' : 'Stop bot',id)); },
  'pool-contribute': id => { const r = state.data.rounds.find(r => r.id === id); openModal(`Contribute to ${esc(r.name)}`,state.data.methods.length ? paymentForm(state.data.methods,r) : empty('No payment method available','Contact support before contributing.')); },
  payout: () => openModal('Request commission payout',form('payout',`<p>Request your available ${money(state.data.referrals.availableCents)}? The support team will coordinate the transfer with you.</p>`,'Request payout')),
  'mfa-setup': async () => {
    if (state.user.mfaEnabled) { openModal('Disable two-factor authentication',form('mfa-disable',password('Password','password') + field('Authenticator code','code','','text','required inputmode="numeric" pattern="[0-9]{6}" maxlength="6"'),'Disable two-factor authentication')); return; }
    const d = await api('/auth/mfa/enroll','POST');
    openModal('Set up your authenticator',`<p class="meta">Scan this code in your authenticator app, or enter the setup key manually. Then enter a fresh six-digit code.</p><img class="qr" src="${esc(d.qr)}" alt="Authenticator setup QR code"><p class="mono secret">${esc(d.secret)}</p>${form('mfa-enable',`<input type="hidden" name="factorId" value="${esc(d.factorId)}"><input type="hidden" name="challengeId" value="${esc(d.challengeId)}">` + field('Authenticator code','code','','text','required inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"'),'Enable two-factor authentication')}`);
  },
  'chat-create': () => openModal('New support conversation',form('chat-create',(state.user ? '' : field('Your name','name','','text','required minlength="2" maxlength="64"') + field('Email · optional','email','','email','autocomplete="email"')) + '<p class="meta">Your conversation is saved in this browser. Sign in to keep conversations attached to your account.</p>','Start conversation')),
  'chat-select': async id => { state.chat = id; await render({quiet:true}); },
  'chat-close': id => openModal('Close conversation',form('chat-close','<p>Close this conversation? The customer can start a new conversation if they need more help.</p>','Close conversation',id)),
  'admin-tab': async id => { state.adminTab = id; await render({quiet:true}); },
  'user-edit': id => { const u = state.data.admin.users.find(u => u.id === id); openModal('Manage member access',form('user',`<p class="meta">${esc(u.email)}</p>${select('Subscription','active',String(!!u.active),[['true','Active'],['false','Inactive']])}${select('Account access','disabled',String(!!u.disabled),[['false','Enabled'],['true','Disabled']])}${select('Role','role',u.role,[['user','Member'],['admin','Administrator']])}`,'Save access',id)); },
  'method-edit':methodModal, 'round-edit':roundModal,
  'payment-review': id => { const p = state.data.admin.payments.find(p => p.id === id); const m = JSON.parse(p.method_snapshot); openModal('Review payment',form('payment-review',`<p><strong>${money(p.amount_cents)}</strong> · ${esc(p.email)}</p><p class="mono payment-details">${esc(p.reference)}</p><p class="meta">Submitted payment destination: ${esc(m.name)} · ${esc(m.details)} ${esc(m.network)}</p><div class="notice">Verify that funds arrived at the listed destination before approving. Approval activates subscriptions or records pool contributions.</div>${select('Decision','status','approved',[['approved','Approve verified payment'],['rejected','Reject payment']])}${textarea('Review note','note','','maxlength="500"')}`,'Confirm review',id)); },
  'account-review': id => { const a = state.data.admin.accounts.find(a => a.id === id); openModal('Review MT5 connection',form('account-review',`<p>${esc(a.email)} · ${esc(a.broker)}</p><p class="meta">${esc(a.login)} · ${esc(a.server)}</p>${select('Decision','decision','approve',[['approve','Connect and approve'],['reject','Reject details']])}${textarea('Note','note',a.note,'maxlength="500"')}`,'Confirm decision',id)); },
  'payout-review': id => openModal('Review payout',form('payout-review','<p class="notice">Mark a payout paid only after completing the transfer to the member.</p>' + select('Decision','status','paid',[['paid','Transfer completed'],['rejected','Reject request']]) + field('Transfer reference · required when paid','reference','','text','maxlength="200"'),'Confirm payout',id)),
  'telegram-test': async () => { await api('/admin/telegram-test','POST'); toast('Test alert delivered.'); }
};
document.addEventListener('click',async event => {
  const link = event.target.closest('a[href]');
  if (link) document.querySelectorAll('.public-menu[open]').forEach(menu => menu.removeAttribute('open'));
  if (!event.target.closest('.public-menu')) document.querySelectorAll('.public-menu[open]').forEach(menu => menu.removeAttribute('open'));
  if (link && link.origin === location.origin && !link.hash && !event.metaKey && !event.ctrlKey && event.button === 0) { event.preventDefault(); navigate(link.pathname + link.search); return; }
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = actions[button.dataset.action]; if (!action) return;
  button.disabled = true;
  try { await action(button.dataset.id,button); } catch (error) { toast(error.message); } finally { button.disabled = false; }
});
document.addEventListener('change',event => { if (event.target.name === 'methodId') { const m = state.data.methods.find(m => m.id === event.target.value); const info = event.target.form.querySelector('#payment-info'); if (info && m) info.innerHTML = methodInfo(m); } });
document.addEventListener('input',event => { if (event.target.id === 'member-search') { const query = event.target.value.toLowerCase(); document.querySelectorAll('[data-member]').forEach(row => { row.hidden = !row.dataset.member.includes(query); }); } });
document.addEventListener('submit',async event => {
  const el = event.target.closest('form[data-form]'); if (!el) return; event.preventDefault();
  const button = el.querySelector('[type="submit"]'); if (button.disabled) return;
  const data = Object.fromEntries(new FormData(el)), action = el.dataset.form, id = el.dataset.id;
  const errorBox = el.querySelector('.error'); errorBox.textContent = ''; button.disabled = true; const label = button.textContent; button.textContent = 'Please wait…'; el.setAttribute('aria-busy','true');
  try {
    if (['password','reset'].includes(action) && data.password !== data.confirm) throw new Error('The new passwords do not match.');
    if (action === 'login') {
      const auth = await supabaseAuth('token?grant_type=password','POST',{ email:data.email, password:data.password });
      let factors = [];
      try {
        const response = await supabaseAuth('factors','GET',undefined,auth.access_token);
        factors = Array.isArray(response) ? response : [...(response?.totp || []), ...(response?.phone || [])];
      } catch {}
      const factor = factors.find(f => f.status === 'verified');
      if (factor && decodeJwt(auth.access_token).aal !== 'aal2') {
        const challenge = await supabaseAuth(`factors/${encodeURIComponent(factor.id)}/challenge`,'POST',{},auth.access_token);
        state.pendingMfa = { auth, factorId:factor.id, challengeId:challenge.id };
        state.requiresMfa = true;
        authPage('/login');
        return;
      }
      saveAuth(auth);
      await identity();
      navigate('/mt5',true);
      return;
    }
    if (action === 'signup') {
      const auth = await supabaseAuth(`signup?redirect_to=${encodeURIComponent(AUTH_REDIRECT_ORIGIN + '/login')}`,'POST',{ email:data.email, password:data.password, data:{ full_name:data.name, referral_code:data.referral || '' } });
      if (!auth.access_token) {
        el.innerHTML = `<div class="notice">If this is a new account that requires verification, check <strong>${esc(data.email)}</strong> for your confirmation email. If you already registered, sign in or reset your password.</div>
          <div class="actions"><button type="button" class="secondary" data-action="resend-confirmation" data-id="${esc(data.email)}">Resend confirmation</button></div>
          <div class="auth-bottom"><a href="/login">Go to sign in</a> · <a href="/forgot-password">Reset password</a></div>`;
        return;
      }
      saveAuth(auth);
      await identity();
      navigate('/subscription',true);
      return;
    }
    if (action === 'resend-confirmation-form') {
      await supabaseAuth(`resend?redirect_to=${encodeURIComponent(AUTH_REDIRECT_ORIGIN + '/login')}`,'POST',{ type:'signup', email:data.email });
      el.innerHTML = '<div class="notice">If this address belongs to an unconfirmed account, a fresh confirmation email has been requested. Check your inbox and spam folder.</div><div class="auth-bottom"><a href="/login">Back to sign in</a></div>';
      return;
    }
    if (action === 'mfa-login') {
      if (!state.pendingMfa) throw new Error('Start a new sign-in attempt.');
      const verified = await supabaseAuth(
        `factors/${encodeURIComponent(state.pendingMfa.factorId)}/verify`,
        'POST',
        { challenge_id:state.pendingMfa.challengeId, code:data.code },
        state.pendingMfa.auth.access_token
      );
      saveAuth(verified);
      state.pendingMfa = null;
      state.requiresMfa = false;
      await identity();
      navigate('/mt5',true);
      return;
    }
    if (action === 'forgot') {
      await supabaseAuth(`recover?redirect_to=${encodeURIComponent(AUTH_REDIRECT_ORIGIN + '/reset-password')}`,'POST',{ email:data.email });
      el.innerHTML = '<div class="notice">If this account exists, a recovery link has been sent.</div>';
      return;
    }
    if (action === 'reset') {
      const params = new URLSearchParams(location.hash.slice(1));
      const accessToken = params.get('access_token') || '';
      if (!accessToken) throw new Error('This recovery link is invalid or expired. Request a new one.');
      await supabaseAuth('user','PUT',{ password:data.password },accessToken);
      history.replaceState(null,'','/login'); state.user = null; state.csrf = null;
      toast('Password reset. Sign in with your new password.'); navigate('/login',true); return;
    }
    if (action === 'password') {
      await api('/auth/password','POST',data);
      clearAuth();
      state.user = null;
      state.csrf = null;
      state.stream?.close();
      state.stream = null;
      toast('Password updated. Please sign in again.');
      navigate('/login',true);
      return;
    }
    if (action === 'mfa-enable') {
      const d = await api('/auth/mfa/enable','POST',data);
      if (d.session?.access_token) saveAuth(d.session);
      if (modal.open) modal.close();
      await identity();
      toast('Two-factor authentication enabled.');
      await render({quiet:true});
      return;
    }
    if (action === 'mfa-disable') {
      const d = await api('/auth/mfa/disable','POST',data);
      if (d.session?.access_token) saveAuth(d.session);
      if (modal.open) modal.close();
      await identity();
      toast('Two-factor authentication disabled.');
      await render({quiet:true});
      return;
    }
    if (action === 'chat-message') { await api(`/support/${id}/messages`,'POST',data); el.reset(); await refreshChat(); return; }
    if (action === 'chat-create') { const d = await api('/support','POST',data); state.chat = d.id; connectEvents(); }
    else {
      const endpoints = { profile:['/profile','PATCH'], account:['/accounts','POST'], 'account-delete':[`/accounts/${id}`,'DELETE'], bot:[`/bots/${id}`,'PATCH'], 'bot-control':[`/bots/${id}/control`,'POST'], payment:['/payments','POST'], payout:['/referrals/payout','POST'], user:[`/admin/users/${id}`,'PATCH'], method:[`/admin/payment-methods${id ? `/${id}` : ''}`,'POST'], round:[`/admin/rounds${id ? `/${id}` : ''}`,'POST'], 'payment-review':[`/admin/payments/${id}/review`,'POST'], 'account-review':[`/admin/accounts/${id}/review`,'POST'], 'payout-review':[`/admin/payouts/${id}/review`,'POST'], 'admin-settings':['/admin/settings','POST'], 'chat-close':[`/support/${id}/close`,'POST'] };
      const endpoint = endpoints[action]; if (!endpoint) throw new Error('Unknown form. Refresh this page.');
      if (action === 'user') { data.active = data.active === 'true'; data.disabled = data.disabled === 'true'; }
      if (action === 'method') data.enabled = data.enabled === 'true';
      if (action === 'bot-control') data.running = data.running === 'true';
      if (action === 'round') { data.startsAt = new Date(data.startsAt).toISOString(); data.endsAt = new Date(data.endsAt).toISOString(); }
      await api(endpoint[0],endpoint[1],data);
    }
    if (modal.open) modal.close(); await identity(); state.config = await api('/config'); toast(action === 'payment' ? 'Payment submitted for review.' : 'Changes saved.'); await render({quiet:true});
  } catch (error) {
    if (action === 'login' && /email not confirmed/i.test(error.message || '')) {
      errorBox.innerHTML = `${esc(error.message)} <button type="button" class="ghost" data-action="resend-confirmation" data-id="${esc(data.email)}">Resend confirmation</button>`;
    } else {
      errorBox.textContent = error.message;
    }
    errorBox.scrollIntoView({block:'nearest'});
  }
  finally { button.disabled = false; button.textContent = label; el.removeAttribute('aria-busy'); }
});
window.addEventListener('popstate',() => render());
function setWorkspaceMenu(open,restoreFocus = true) {
  const opener = document.querySelector('[data-action="menu"][aria-expanded]');
  const wasOpen = document.body.classList.contains('menu-open');
  const mobile = window.matchMedia('(max-width: 760px)').matches;
  document.body.classList.toggle('menu-open',open && mobile);
  opener?.setAttribute('aria-expanded',String(open && mobile));
  const workspace = document.querySelector('.workspace');
  if (workspace) workspace.inert = open && mobile;
  if (open && mobile) document.querySelector('.sidebar a.active, .sidebar a')?.focus();
  else if (wasOpen && restoreFocus) opener?.focus();
}
window.matchMedia('(max-width: 760px)').addEventListener('change',() => setWorkspaceMenu(false));
document.addEventListener('keydown',event => {
  if (event.key === 'Escape') {
    setWorkspaceMenu(false);
    document.querySelectorAll('.public-menu[open]').forEach(menu => { menu.removeAttribute('open'); menu.querySelector('summary').focus(); });
  }
  if (event.key === 'Tab' && document.body.classList.contains('menu-open')) {
    const controls = [...document.querySelectorAll('.sidebar a[href], .sidebar button:not(:disabled)')].filter(el => el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
const systemTheme = window.matchMedia('(prefers-color-scheme: light)');
function applyTheme(theme) {
  document.body.classList.toggle('light',theme === 'light');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme === 'light' ? '#f5f6f7' : '#111315');
}
try { applyTheme(localStorage.getItem('elite-theme') || (systemTheme.matches ? 'light' : 'dark')); }
catch { applyTheme(systemTheme.matches ? 'light' : 'dark'); }
systemTheme.addEventListener('change',event => { try { if (!localStorage.getItem('elite-theme')) applyTheme(event.matches ? 'light' : 'dark'); } catch {} });
try {
  state.config = await api('/config');
  if (location.hash && location.pathname !== '/reset-password') {
    const callback = new URLSearchParams(location.hash.slice(1));
    const accessToken = callback.get('access_token') || '';
    const callbackType = callback.get('type') || '';
    if (accessToken && callbackType === 'recovery') {
      history.replaceState(null,'','/reset-password' + location.hash);
    } else if (accessToken) {
      saveAuth({
        access_token:accessToken,
        refresh_token:callback.get('refresh_token') || '',
        expires_in:Number(callback.get('expires_in') || 3600)
      });
      history.replaceState(null,'','/subscription');
    } else if (callback.get('error_description')) {
      const message = callback.get('error_description') || 'Email confirmation failed.';
      history.replaceState(null,'','/login');
      setTimeout(() => toast(message), 0);
    }
  }
  await identity();
  await render();
} catch (error) {
  root.innerHTML = `<main id="main" class="public-content">${empty('Unable to connect',esc(error.message),'<a href="/">Try again</a>')}</main>`;
}
setInterval(() => { if (!document.hidden && location.pathname.includes('support') && state.chat) refreshChat().catch(() => {}); },15000);
setInterval(() => { if (!document.hidden && state.user && !modal.open && !document.body.classList.contains('menu-open') && ['/mt5','/bots'].includes(location.pathname)) render({quiet:true}); },15000);
