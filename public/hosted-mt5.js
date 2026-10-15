// Premium authenticated Hosted MT5 console.
// Read-only: no trading actions, no passwords, no remote-machine provisioning.
const SHA = '16627b5419bd777662472479f4fed23f187ca6c3853e4352d0c01d0bc2168528';
const PR = 'https://github.com/Mahiruni/Elitetrade/pull/56';
const RUN = 'https://github.com/Mahiruni/Elitetrade/actions/runs/38747403478';
const GUIDE = 'https://github.com/Mahiruni/Elitetrade/blob/research/cloud-compile-ea-20261015/research/phase5/README.md';
const BUILD = 'https://github.com/Mahiruni/Elitetrade/actions/runs/38734987113';
const EXNESS = 'https://my.exness.com/';
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SERVER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6" stroke-linecap="round"/></svg>';
const DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M7 3h8l5 5v13H7a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm8 0v6h5M9 14h7M9 18h7"/></svg>';
const MONITOR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8M12 18v4M7 10l3 3 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3"/></svg>';
const LINK = (url,label,cls='') => '<a class="'+cls+'" href="'+url+'" target="_blank" rel="noopener noreferrer">'+label+ARROW+'</a>';

export function createHostedMt5Workspace({api,esc}) {
  function pill(label, kind='waiting') { return '<span class="host-chip host-chip--'+kind+'"><i aria-hidden="true"></i>'+esc(label)+'</span>'; }
  function stat(name,value,note,cls='') {return '<div class="host-metric '+cls+'"><span>'+esc(name)+'</span><strong>'+esc(value)+'</strong><small>'+esc(note)+'</small></div>';}
  function pageMarkup(data) {
    const valid=data?.schema==='hosted_mt5_readiness_v1';
    const provisioned=valid && data?.host?.state==='verified_running' && !!data.host.lastHeartbeatAt;
    const name=valid ? data.research?.name : 'EliteTrade Sweep Research v1';
    const hostValue=provisioned?'Verified online':'Not provisioned';
    const brokerValue=valid && data.broker?.state==='verified' && provisioned ? 'Verified' : 'Unverified';
    const tested=valid && data.strategy?.realTickBacktest==='verified';
    const buildVerified=valid && data.research?.compiled===true;
    return `<div class="host-ui" data-host-state="${provisioned?'online':'offline'}">
      <div class="host-kicker"><span class="host-overline">ELITETRADE <em>/</em> INFRASTRUCTURE</span>${pill('Research mode', 'research')}</div>
      <section class="host-hero" aria-labelledby="host-title">
        <div class="host-hero-copy"><div class="host-hero-eyebrow">Your trading terminal. Your control.</div>
          <h1 id="host-title">Hosted MT5<span class="host-period">.</span><br><span class="host-headline-muted">Beyond your device.</span></h1>
          <p>Prepare a dedicated Windows MT5 environment, monitor genuine connection evidence, and run independent EA research—all from your EliteTrade workspace on your phone.</p>
          <div class="host-hero-actions">
            <a class="host-primary" href="#host-setup">Set up Windows host ${ARROW}</a>
            ${LINK(GUIDE, 'View setup guide','host-secondary')}
          </div>
          <div class="host-hero-foot"><span class="host-foot-dot"></span> No Windows VPS has been connected or provisioned. No live orders enabled.</div>
        </div>
        <div class="host-art" aria-hidden="true">
          <div class="host-art-halo"></div>
          <div class="host-art-shell">
            <div class="host-art-top"><span><b></b><b></b><b></b></span><small>ELITE / CLOUD</small></div>
            <div class="host-art-monitor">
              <div class="host-art-progress"><span>HOST READINESS</span><small>00 / 04</small></div>
              <div class="host-art-rows">
                <div><i class="host-art-dot"></i><span>Windows host</span><em>NOT READY</em></div>
                <div><i class="host-art-dot"></i><span>MT5 terminal</span><em>NOT VERIFIED</em></div>
                <div><i class="host-art-dot"></i><span>Exness demo</span><em>NOT VERIFIED</em></div>
                <div><i class="host-art-dot active"></i><span>EA compilation</span><em>VERIFIED</em></div>
              </div>
              <div class="host-art-path"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
            </div>
          </div>
          <div class="host-art-tag"><span>WINDOWS / MT5</span><strong>Environment pending</strong></div>
        </div>
      </section>

      <div class="host-section-title"><div><span class="host-eyebrow">01 / SYSTEM OVERVIEW</span><h2>Connection health</h2></div>
        <button class="host-refresh" type="button" data-host-refresh aria-label="Refresh hosted MT5 connection status">${ARROW} Refresh status</button>
      </div>
      <div class="host-metrics" aria-label="Verified MT5 readiness">
        ${stat('Windows hosting',hostValue,provisioned?'Authenticated heartbeat available':'Requires a dedicated Windows machine')}
        ${stat('Exness MT5 demo',brokerValue,'XAUUSDm · M1 · connection not established')}
        ${stat('EA research build',buildVerified?'Compiled':'Unverified',buildVerified?'Windows MetaEditor verified':'Compilation evidence unavailable','host-metric--verified')}
        ${stat('Real-tick backtest',tested?'Verified':'Not available',tested?'Actual MT5 evidence received':'No validated broker-history report')}
      </div>

      <div class="host-grid" id="host-setup">
        <section class="host-panel host-setup" aria-labelledby="host-setup-title">
          <div class="host-panel-head"><div><span class="host-eyebrow">02 / GET CONNECTED</span><h2 id="host-setup-title">Setup checklist</h2></div>${pill('0 of 4 verified')}</div>
          <div class="host-steps">
            <div class="host-step"><span class="host-step-index">01</span><div><h3>Provision a Windows host</h3><p>Choose an interactive Windows VPS with Remote Desktop access. A Vercel web app cannot run the Windows MT5 terminal.</p><div class="host-step-extra">Suggested starting point: 2+ vCPU, 4–8 GB RAM, sufficient SSD space for tick history. Provider payment and provisioning are separate.</div></div><span class="host-step-mark">Pending</span></div>
            <div class="host-step"><span class="host-step-index">02</span><div><h3>Secure your Windows terminal</h3><p>Connect through an Android Remote Desktop client, install official MT5, and restrict Windows access. Never paste Windows or broker passwords into this page.</p></div><span class="host-step-mark">Pending</span></div>
            <div class="host-step"><span class="host-step-index">03</span><div><h3>Verify Exness MT5 Demo</h3><p>Sign in within the actual Windows terminal. Confirm your demo server, XAUUSDm symbol, and availability of historical ticks.</p><div class="host-step-links">${LINK(EXNESS,'Exness account')}</div></div><span class="host-step-mark">Pending</span></div>
            <div class="host-step"><span class="host-step-index">04</span><div><h3>Run the evidence-first EA test</h3><p>Install the SHA-256 verified independent EA. Run signal-only first, then simulated Strategy Tester trades after genuine data and logs are confirmed.</p><div class="host-step-links">${LINK(GUIDE,'Testing runbook')}</div></div><span class="host-step-mark">Pending</span></div>
          </div>
        </section>
        <aside class="host-rail">
          <section class="host-panel host-build">
            <div class="host-panel-head"><div><span class="host-eyebrow">03 / VERIFIED ASSETS</span><h2>Research build</h2></div><span class="host-build-icon">${CHECK}</span></div>
            <div class="host-build-name">${esc(name || 'EliteTrade Sweep Research v1')}</div>
            <div class="host-build-meta"><span>Executable</span><strong>.EX5 · MQL5</strong></div>
            <div class="host-build-meta"><span>Research trading</span><strong>Signal-only baseline</strong></div>
            <div class="host-build-meta"><span>Reference equivalence</span><strong>Not established</strong></div>
            <div class="host-build-hash"><span>SHA-256 fingerprint</span><code>${SHA.slice(0,24)}…</code><button type="button" data-host-copy title="Copy complete EX5 hash">${COPY}<span>Copy</span></button></div>
            ${LINK(BUILD,'Inspect successful compiler run','host-rail-link')}
          </section>
          <section class="host-panel host-safety">
            <div class="host-safety-icon">${LOCK}</div>
            <h2>Built for controlled testing</h2>
            <p>No live trading, no plaintext credential collection, and no simulated “connected” status. We only unlock production execution after verified infrastructure and risk review.</p>
            <div class="host-safety-links">${LINK(PR,'Review research PR')}${LINK(RUN,'Latest tester evidence')}</div>
          </section>
        </aside>
      </div>
      <section class="host-panel host-enrollment" id="host-enrollment">
        <div class="host-panel-head"><div><span class="host-eyebrow">04 / SIGNED DEVICE PAIRING</span><h2>Register your Windows terminal</h2></div>${pill('Demo telemetry only')}</div>
        <p class="host-pair-description">When you have a Windows MT5 DEMO terminal, run the EliteBridge companion there to generate an Ed25519 public key. Paste <strong>only its public key</strong> below. Never paste your terminal private key or MT5 password.</p>
        <form id="bridge-enroll-form" class="host-pair-form">
          <label for="bridge-account">Linked EliteTrade account</label><select id="bridge-account" required><option value="">Loading your saved MT5 accounts…</option></select>
          <label for="bridge-label">Device name</label><input id="bridge-label" required minlength="3" maxlength="64" placeholder="My Windows MT5 Demo"/>
          <label for="bridge-public">Terminal public key (PEM)</label><textarea id="bridge-public" rows="4" required placeholder="-----BEGIN PUBLIC KEY-----"></textarea>
          <button class="host-primary host-pair-submit" type="submit">Register public identity ${ARROW}</button>
        </form>
        <div id="bridge-pair-response" class="host-pair-response" role="status" aria-live="polite"></div>
        <div class="host-pair-listhead"><h3>My terminal identities</h3><button type="button" data-bridge-update>Check pairing status</button></div>
        <div id="bridge-pair-list" role="status">Checking registered identities…</div>
        <p class="host-pair-description">Register → sign challenge on Windows → approve in this app → transmit signed quotes. Successful pairing verifies a device identity, <strong>not an Exness broker connection</strong>. No orders are enabled.</p>
      </section>
      <div class="host-bottom-note"><span class="host-note-icon">${MONITOR}</span><div><strong>Web console deployed separately from the trading host</strong><p>This page is hosted by EliteTrade; the dedicated Windows machine must still be provisioned and verified. The latest cloud Strategy Tester attempt failed before producing reliable broker-history results.</p></div>${LINK(GUIDE,'Open technical plan','host-note-link')}</div>
    </div>`;
  }
  async function page() {
    const status = await api('/hosted-mt5/status');
    return pageMarkup(status);
  }
  function mountBridge() {
    const section=document.querySelector('#host-enrollment');
    if(!section)return;
    const list=section.querySelector('#bridge-pair-list');
    const response=section.querySelector('#bridge-pair-response');
    const form=section.querySelector('#bridge-enroll-form');
    const account=section.querySelector('#bridge-account');
    const say=message=>{if(response)response.textContent=message;};
    async function refresh() {
      try {
        const data=await api('/elitebridge/terminals');
        if(!list?.isConnected)return;
        const terms=Array.isArray(data.terminals)?data.terminals:[];
        list.innerHTML=terms.length?terms.map(term=>{
          const id=String(term.id||''),status=String(term.status||'pending');
          if(!/^[0-9a-f-]{36}$/i.test(id))return '';
          const pending=status==='pending',approved=status==='approved',revoked=status==='revoked';
          return `<div class="host-pair-item"><div><strong>${esc(term.label||'Windows terminal')}</strong>
             <small>${esc(id)} · ${esc(status)} · Proof ${term.identityProofVerified?'verified':'pending'} · ${term.signedTransportFresh?'Signed transport fresh':'No recent signed packets'}</small>
             <small>Broker verification: unavailable · Trade execution: disabled</small></div>
             <div class="host-pair-actions">${pending&&term.identityProofVerified?`<button type="button" data-bridge-approve="${esc(id)}">Approve identity</button>`:''}
             ${!revoked?`<button type="button" data-bridge-revoke="${esc(id)}">Revoke</button>`:''}</div></div>`;
        }).join(''):'<p class="host-pair-description">No Windows terminal identities registered. Nothing is currently connected through EliteBridge.</p>';
      }catch{if(list?.isConnected)list.textContent='Secure EliteBridge storage is unavailable. Connection remains unverified.';}
    }
    async function accounts(){
      try{
        const result=await api('/accounts?fast=1');
        if(!account?.isConnected)return;
        const rows=Array.isArray(result.accounts)?result.accounts:[];
        account.innerHTML='<option value="">Choose your saved MT5 account</option>'+rows.filter(a=>/^[0-9a-f-]{36}$/i.test(a.id||''))
          .map(a=>`<option value="${esc(a.id)}">${esc(a.broker||'MT5')} · ${esc(a.login||'Saved account')}</option>`).join('');
      }catch{if(account?.isConnected)account.innerHTML='<option value="">MT5 account list unavailable</option>';}
    }
    section.querySelector('[data-bridge-update]')?.addEventListener('click',()=>void refresh());
    form?.addEventListener('submit',async event=>{
      event.preventDefault();
      const button=form.querySelector('button[type="submit"]');button.disabled=true;
      say('Registering your device identity…');
      try {
        const result=await api('/elitebridge/terminals','POST',{
          accountId:account.value,label:section.querySelector('#bridge-label').value.trim(),
          publicKey:section.querySelector('#bridge-public').value.trim()
        });
        const id=result.terminal?.id,nonce=result.enrollment?.nonce;
        say(`Registered terminal ${id}. On Windows, run: node scripts/elitebridge-terminal-companion.mjs prove ${id} ${nonce}. Then select Approve identity here after checking proof. No orders enabled.`);
        await refresh();
      }catch(error){say(error?.message||'Unable to register identity.');}
      finally{button.disabled=false;}
    });
    list?.addEventListener('click',async event=>{
      const approve=event.target.closest('[data-bridge-approve]');
      const revoke=event.target.closest('[data-bridge-revoke]');
      const target=approve||revoke;
      if(!target)return;
      const id=target.getAttribute(approve?'data-bridge-approve':'data-bridge-revoke');
      if(!/^[0-9a-f-]{36}$/i.test(id||''))return;
      if(!approve && !window.confirm('Revoke this terminal identity? It will no longer be able to submit signed telemetry.'))return;
      target.disabled=true;
      try {await api('/elitebridge/terminals/'+id+(approve?'/approve':'/revoke'),'POST',{});
        say(approve?'Identity approved for signed DEMO telemetry. Actual broker connectivity is still unverified.':'Terminal identity revoked.');
        await refresh();
      }catch(error){say(error?.message||'Unable to change terminal state.');target.disabled=false;}
    });
    void Promise.allSettled([accounts(),refresh()]);
  }
  function mount() {
    const root = document.querySelector('.host-ui');
    if(!root)return;
    mountBridge();
    root.querySelector('[data-host-copy]')?.addEventListener('click',async e=>{
      const button=e.currentTarget;
      try { await navigator.clipboard.writeText(SHA); button.querySelector('span').textContent='Copied'; }
      catch { button.querySelector('span').textContent='Use build link'; }
    });
    root.querySelector('[data-host-refresh]')?.addEventListener('click',async e=>{
      const b=e.currentTarget;
      if(b.disabled)return;
      b.disabled=true; b.textContent='Checking…';
      try {
        const result=await api('/hosted-mt5/status');
        if(document.querySelector('.host-ui')===root) {
          root.outerHTML=pageMarkup(result);
          mount();
        }
      } catch {
        if(document.querySelector('.host-ui')===root){ b.textContent='Unable to verify · Retry'; b.disabled=false; }
      }
    });
  }
  return {page,mount};
}
