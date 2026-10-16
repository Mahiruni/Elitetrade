// EliteBridge Control Center — independent signed MT5 telemetry, never order execution.
export function createEliteBridgeWorkspace({api,esc,state}) {
  const guide='https://github.com/Mahiruni/Elitetrade/blob/main/docs/ELITEBRIDGE_PHASE9_WINDOWS_READINESS.md';
  const cloudGuide='https://github.com/Mahiruni/Elitetrade/blob/main/docs/PROJECT_FREEDOM.md';
  let timer=null,request=null,lastChallenge=null,generation=0,mutating=false,cloudAccountId=null;
  const safe=v=>esc(String(v??''));
  function badge(label,kind='neutral'){return '<span class="bridge-chip bridge-'+kind+'">'+safe(label)+'</span>';}
  function metric(label,value,note){return '<div class="bridge-metric"><span>'+safe(label)+'</span><strong>'+safe(value)+'</strong><small>'+safe(note)+'</small></div>';}
  const link=(url,label)=>'<a href="'+url+'" target="_blank" rel="noopener noreferrer">'+label+' ↗</a>';
  function terminalRow(t,health) {
    const approved=t.status==='approved',deviceId=t.id;
    const h=(health||[]).find(x=>x.terminalId===deviceId);
    const connected=h?.state==='receiving';
    const type=t.account_mode==='real'?'REAL observation':'DEMO observation';
    const age=Number.isFinite(h?.heartbeatAgeSeconds)?h.heartbeatAgeSeconds+'s ago':'Not received';
    return '<article class="bridge-terminal"><div class="bridge-terminal-header"><div><h3>'+safe(t.label)+'</h3><p>'+safe(type)+' · '+safe(t.id).slice(0,8)+'…</p></div>'+
      badge(t.status,approved?'warm':'neutral')+'</div><div class="bridge-terminal-status">'+badge(h?.state||t.telemetryState||'awaiting',connected?'good':'neutral')+
      '<span>Last signed heartbeat: '+safe(age)+'</span></div>'+
      '<p class="bridge-small">'+safe(h?.recovery || (t.proof_verified_at?'Key proved · awaiting independent telemetry':'Public key enrolled · pairing not completed'))+'</p>'+
      '<p class="bridge-small">Key fingerprint · SHA-256 <code class="bridge-fingerprint">'+safe(t.fingerprint||'Unavailable — do not approve')+'</code></p>'+
      '<div class="bridge-actions">'+(!t.proof_verified_at&&t.status==='pending'?'<button type="button" data-bridge-cmd="challenge" data-id="'+safe(deviceId)+'">Pair terminal</button>':'')+
      (t.proof_verified_at&&t.status==='pending'&&/^[a-f0-9]{64}$/.test(t.fingerprint||'')?'<button type="button" data-bridge-cmd="approve" data-id="'+safe(deviceId)+'">Approve after fingerprint check</button>':'')+
      (t.status!=='revoked'?'<button type="button" class="bridge-danger" data-bridge-cmd="revoke" data-id="'+safe(deviceId)+'">Revoke</button>':'')+'</div></article>';
  }
  async function page(){
    const admin=state.user?.role==='admin';
    const [status,protocol,readinessResult]=await Promise.allSettled([api('/elitebridge/status'),api('/elitebridge/protocol'),api('/elitebridge/readiness')]);
    const s=status.status==='fulfilled'?status.value:null,p=protocol.status==='fulfilled'?protocol.value:null;
    const readiness=readinessResult.status==='fulfilled'?readinessResult.value:null;
    let cloudResult=null,cloudError='';
    if(cloudAccountId){
      try{cloudResult=await api('/elitebridge/accounts/'+encodeURIComponent(cloudAccountId)+'/cloud-probe');}
      catch(error){cloudError=error.message||'Private gateway unavailable. Broker connection unverified.';}
    }
    const cloudSnapshot=cloudResult?.snapshot;
    const cloudVerified=cloudResult?.state==='broker-verified-demo'&&cloudSnapshot?.brokerAuthenticated===true;
    let list=null,checks=null,setupError='',accounts={accounts:[]};
    if(admin&&p?.pairingEnabled){
      const results=await Promise.allSettled([
        api('/elitebridge/terminals'),api('/elitebridge/diagnostics'),api('/accounts','GET',undefined,{snapshot:true})
      ]);
      if(results[0].status==='fulfilled')list=results[0].value;
      else setupError='Terminal registry is temporarily unavailable.';
      if(results[1].status==='fulfilled')checks=results[1].value;
      if(results[2].status==='fulfilled')accounts=results[2].value;
    }
    const terminals=list?.terminals||[],hasCloud=!!p?.pairingEnabled;
    const phaseLabel=hasCloud?'Enrollment available':'Cloud configuration pending';
    const health=checks?.terminals||[];
    const dataWarnings=[!s?'Provider inventory unavailable.':null,!p?'Protocol status unavailable.':null,
      admin&&hasCloud&&!list?'Terminal registry unavailable; count is unknown.':null,
      admin&&hasCloud&&!checks?'Diagnostics unavailable; telemetry freshness is unknown.':null].filter(Boolean);
    return '<section class="bridge-root" aria-labelledby="bridge-heading">'+
    '<div class="bridge-topline"><span>ELITETRADE / INDEPENDENT CONNECTIVITY</span>'+badge('Read-only · no orders','warm')+'</div>'+
    '<header class="bridge-hero"><div><div class="bridge-eyebrow">Windows MT5 · Signed telemetry · Your infrastructure</div>'+
    '<h1 id="bridge-heading">Elite<span>Bridge.</span></h1>'+
    '<p>Build a secure, provider-independent route from a trusted Windows MT5 terminal to your EliteTrade account. Track signed heartbeat and broker observations without relying on simulated connection indicators.</p>'+
    '<div class="bridge-actions">'+link(guide,'Windows deployment guide')+'<button type="button" data-bridge-cmd="refresh">Check connectivity ↻</button></div>'+
    '</div><div class="bridge-system"><div class="bridge-system-h"><span>ELITE / MT5</span><span>OBSERVATION</span></div>'+
    '<div><span>Android / Web</span><b>CONTROL</b></div><div><span>EliteBridge Cloud</span><b>'+safe(hasCloud?'CONFIGURABLE':'DISABLED')+'</b></div>'+
    '<div><span>Windows Terminal</span><b>NOT VERIFIED</b></div><div><span>Broker Execution</span><b>LOCKED</b></div></div></header>'+
    '<nav class="bridge-section-nav" aria-label="EliteBridge sections">'+[['bridge-overview','Overview'],['bridge-terminals','Terminals'],['bridge-diagnostics','Diagnostics'],['bridge-readiness','Readiness'],['bridge-security','Security']].map(([id,label])=>'<a href="#'+id+'">'+label+'</a>').join('')+'</nav>'+
    (dataWarnings.length?'<p class="bridge-warning" role="status">'+safe(dataWarnings.join(' '))+'</p>':'')+
    '<div class="bridge-metrics" id="bridge-overview">'+
    metric('Cloud readiness',phaseLabel,hasCloud?'Registered device approval required':'Server feature flag or secure storage unavailable')+
    metric('Registered terminals',list?String(terminals.length):'Unknown',!admin?'Administrator access required':hasCloud?'Owner-scoped registry':'Enrollment not activated')+
    metric('Receiving telemetry',checks?String(health.filter(h=>h.state==='receiving').length):'Unknown','Signed observations only; not broker authentication')+
    metric('Real-money execution','Disabled','Independent bridge has no live-order authority')+'</div>'+
    '<section class="bridge-panel" id="bridge-gateway"><div class="bridge-panel-head"><div><span class="bridge-kicker">PROJECT FREEDOM / PRIVATE RUNTIME</span><h2>Cloud broker verification</h2></div>'+badge(cloudVerified?'Broker verified · DEMO':'Broker not verified',cloudVerified?'good':'neutral')+'</div>'+
    '<p class="bridge-small">Verify your demo account through the private cloud gateway. Runtime commissioning is pending until a genuine broker session is confirmed. Your existing connection and bot settings stay under your control.</p>'+
    '<form data-bridge-form="cloud-probe"><label>Your saved MT5 account<select name="accountId" required><option value="">Select an Exness demo account</option>'+
    (s?.accounts||[]).filter(a=>a.accountId).map(a=>'<option value="'+safe(a.accountId)+'"'+(a.accountId===cloudAccountId?' selected':'')+'>'+safe(a.broker)+' · '+safe(a.account)+'</option>').join('')+
    '</select></label><button type="submit">Verify private DEMO gateway</button></form>'+
    (cloudError?'<p class="bridge-warning" role="status">'+safe(cloudError)+'</p>':'')+
    (cloudVerified?'<p class="bridge-small">Server: '+safe(cloudSnapshot.server)+' · Last broker verification: '+safe(cloudSnapshot.observedAt)+' · Market: '+safe(cloudSnapshot.marketState)+' · Positions: '+safe(cloudSnapshot.openPositionCount)+' · Execution locked</p>':'<p class="bridge-small">Account verification, market freshness and engine health are separate checks. No authenticated snapshot has been accepted here.</p>')+
    '<div class="bridge-links">'+link(cloudGuide,'Cloud runtime and evidence')+'</div></section>'+
    '<div class="bridge-layout"><section class="bridge-panel" id="bridge-terminals"><div class="bridge-panel-head"><div><span class="bridge-kicker">01 / INFRASTRUCTURE</span><h2>Trusted terminals</h2></div>'+badge(hasCloud?'Pairing required':'Awaiting activation')+'</div>'+
    (!admin?'<p class="bridge-small">Only an authenticated administrator can enroll or approve a terminal. Contact your EliteTrade administrator for integration.</p>':
       setupError?'<p class="bridge-warning">'+safe(setupError)+'</p>':
       !hasCloud?'<p class="bridge-warning">Cloud pairing is not enabled on this deployment. No terminal connection has been established.</p>':
       terminals.length?terminals.map(t=>terminalRow(t,health)).join(''):
       '<div class="bridge-empty"><div class="bridge-empty-orbit">◈</div><h3>No terminals enrolled</h3><p>Once you have a Windows MT5 host, generate its Ed25519 identity locally, register only its public key and complete the signed pairing challenge here.</p></div>')+
    (admin&&hasCloud?'<details class="bridge-details"><summary>Register Windows terminal (public key only)</summary>'+
      '<form data-bridge-form="enroll"><label>Choose your own MT5 account<select name="accountId" required>'+
      ((accounts.accounts||[]).map(a=>'<option value="'+safe(a.id)+'">'+safe(a.broker||'MT5')+' · '+safe(a.status||'unverified')+'</option>').join('')||'<option value="">No MT5 account available</option>')+
      '</select></label><label>Terminal name<input name="label" placeholder="EliteTrade Windows VPS" required minlength="3" maxlength="64"></label>'+
      '<label>Ed25519 PUBLIC key in PEM format<textarea rows="5" name="publicKey" required placeholder="-----BEGIN PUBLIC KEY-----"></textarea></label>'+
      '<p class="bridge-small">Generate the identity on the trusted Windows machine. Never paste an MT5 password, private key, seed phrase or API token here. Initial rollout supports DEMO pairing.</p>'+
      '<button type="submit">Register pending device</button></form></details>':'')+
    '<p class="bridge-receipt">No signed terminal heartbeat establishes an authenticated broker session by itself. Signed telemetry is observation-only.</p></section>'+
    '<aside class="bridge-side"><section class="bridge-panel" id="bridge-readiness"><div class="bridge-panel-head"><div><span class="bridge-kicker">02 / COMMISSIONING</span><h2>Connection checklist</h2></div></div>'+
    (Array.isArray(readiness?.checks)?readiness.checks.map(c=>'<div class="bridge-step"><i>'+safe(c.state==='ready'?'✓':'○')+'</i><span><strong>'+safe(c.title)+'</strong><br>'+safe(c.note)+'</span></div>').join(''):'<p class="bridge-warning">Readiness unavailable. Check your connection and server deployment.</p>')+
    '</section><section class="bridge-panel bridge-safety" id="bridge-security"><h2>Execution security</h2><p>Our original MetaApi integration stays separate. EliteBridge cannot start bots, send orders, or switch a REAL account into trading mode. DEMO and REAL observation are distinct.</p>'+
    '<div class="bridge-links">'+link(guide,'Technical runbook')+'</div></section></aside></div>'+
    '<section class="bridge-panel bridge-diagnostics" id="bridge-diagnostics"><div class="bridge-panel-head"><div><span class="bridge-kicker">03 / OBSERVABILITY</span><h2>Receipt diagnostics</h2></div>'+badge(checks?'Checked':'Unavailable')+'</div>'+
    '<p class="bridge-small">'+(checks?'Server checked: '+safe(checks.checkedAt||'Timestamp unavailable'):'No current health result. A reachable website does not establish terminal connectivity.')+'</p>'+
    (checks?health.length?health.map(h=>'<div class="bridge-diagnostic-row"><div><strong>'+safe(h.label)+'</strong><p>'+safe(h.recovery)+'</p></div>'+badge(h.state,h.state==='receiving'?'good':'neutral')+'<dl><div><dt>Heartbeat receipt</dt><dd>'+safe(h.heartbeatAgeSeconds===null?'Not received':h.heartbeatAgeSeconds+'s ago')+'</dd></div><div><dt>Quote receipt</dt><dd>'+safe(h.quoteAgeSeconds===null?'Not received':h.quoteAgeSeconds+'s ago')+'</dd></div></dl></div>').join(''):'<p class="bridge-small">No terminal receipts to inspect. Enroll an approved Windows terminal first.</p>':'<p class="bridge-small">'+safe(admin?'Diagnostics are unavailable; automatic checks will retry.':'Diagnostics require an authenticated administrator.')+'</p>')+
    '<p class="bridge-receipt">Receipt age measures cloud arrival. It is not quote source age, broker latency, execution latency, or an uptime benchmark.</p></section>'+
    (lastChallenge?'<section class="bridge-panel bridge-proof"><h2>One-time terminal challenge</h2><p>Sign this challenge on the enrolled Windows terminal. Do not share the private key.</p><textarea readonly rows="4" data-bridge-challenge>'+safe(JSON.stringify(lastChallenge.challenge))+'</textarea>'+
      '<div class="bridge-actions"><button type="button" data-bridge-cmd="copy-challenge">Copy challenge</button></div>'+
      '<form data-bridge-form="prove" data-id="'+safe(lastChallenge.terminalId)+'"><label>Signed proof (base64url)<input name="signature" required autocomplete="off"></label>'+
      '<button type="submit">Verify terminal possession</button></form></section>':'')+
    '<p class="bridge-foot">Terminal identity ≠ independent broker verification · Current provider remains unchanged · Refresh runs automatically while this page is visible</p></section>';
  }
  async function refresh(){
    if(request||mutating||location.pathname!=='/elitebridge')return;
    const token={},epoch=generation,original=document.querySelector('.bridge-root');
    const owner=state.user;
    request=token;
    try{
      const html=await page(),root=document.querySelector('.bridge-root');
      if(root&&root===original&&epoch===generation&&state.user===owner&&location.pathname==='/elitebridge'){
        // Capture at commit time so edits made DURING the request survive too.
        const drafts=[...root.querySelectorAll('[data-bridge-form]')].map(form=>({kind:form.dataset.bridgeForm,
          id:form.dataset.id,values:[...form.querySelectorAll('[name]')].map(el=>[el.name,el.value])}));
        const openDetails=[...root.querySelectorAll('details')].map(el=>el.open);
        const active=document.activeElement,focused=active?.closest('[data-bridge-form]');
        const focus=focused?{kind:focused.dataset.bridgeForm,name:active.name,
          start:active.selectionStart,end:active.selectionEnd}:null;
        const x=window.scrollX,y=window.scrollY;
        root.outerHTML=html;bind();
        const next=document.querySelector('.bridge-root');
        // A field inside a collapsed details element cannot receive focus.
        [...next.querySelectorAll('details')].forEach((el,i)=>{el.open=openDetails[i]===true;});
        for(const form of next.querySelectorAll('[data-bridge-form]')){
          const draft=drafts.find(d=>d.kind===form.dataset.bridgeForm&&d.id===form.dataset.id);
          for(const el of form.querySelectorAll('[name]')){
            const value=draft?.values.find(([name])=>name===el.name);
            if(value)el.value=value[1];
            if(focus?.kind===form.dataset.bridgeForm&&focus.name===el.name){
              el.focus({preventScroll:true});
              if(typeof el.setSelectionRange==='function'&&focus.start!==null)
                try{el.setSelectionRange(focus.start,focus.end);}catch{}
            }
          }
        }
        window.scrollTo(x,y);
      }
    }catch{const el=document.querySelector('.bridge-foot');if(el)el.textContent='Cloud diagnostics temporarily unavailable · auto-retrying';}
    finally{if(request===token)request=null;}
  }
  async function perform(kind,id,payload={}){
    if(mutating)return;
    mutating=true;const epoch=++generation,owner=state.user;request=null;
    try{
    if(kind==='cloud-probe'){
      if(!/^[0-9a-f-]{36}$/i.test(payload.accountId||''))throw Error('Select your saved Exness demo account.');
      cloudAccountId=payload.accountId;
    }
    const url='/elitebridge/terminals'+(id?'/'+encodeURIComponent(id):'');
    if(kind==='enroll')await api(url,'POST',payload);
    if(kind==='challenge'){const result=await api(url+'/challenge','POST',{});if(epoch===generation&&state.user===owner)lastChallenge=result;}
    if(kind==='prove'){await api(url+'/prove','POST',payload);lastChallenge=null;}
    if(kind==='approve'||kind==='revoke')await api(url+'/'+kind,'POST',{});
    // Never retain a successfully submitted enrollment form as an old draft.
    if(kind==='enroll')document.querySelector('[data-bridge-form="enroll"]')?.reset();
    }finally{mutating=false;}
    await refresh();
  }
  function bind(){
    const root=document.querySelector('.bridge-root');
    if(!root)return;
    root.querySelectorAll('[data-bridge-cmd]').forEach(button=>button.addEventListener('click',async()=>{
      const action=button.dataset.bridgeCmd,id=button.dataset.id;
      if(action==='refresh'){await refresh();return;}
      if(action==='copy-challenge'){
        try{await navigator.clipboard.writeText(JSON.stringify(lastChallenge?.challenge||''));button.textContent='Copied';}
        catch{button.textContent='Select and copy the challenge';}return;
      }
      if(action==='approve'&&!confirm('Only approve after independently checking the Windows terminal key fingerprint. This enables signed read-only observations, NOT trading. Continue?'))return;
      if(action==='revoke'&&!confirm('Revoke this terminal permanently? It must be re-enrolled with a new key.'))return;
      button.disabled=true;try{await perform(action,id);}
      catch(e){button.disabled=false;const msg=document.createElement('p');msg.setAttribute('role','alert');msg.className='bridge-warning';msg.textContent=e.message||'Request unavailable';button.after(msg);}
    }));
    root.querySelectorAll('[data-bridge-form]').forEach(form=>form.addEventListener('submit',async e=>{
      e.preventDefault();
      const button=form.querySelector('[type="submit"]');if(button)button.disabled=true;
      try{
        const values=Object.fromEntries(new FormData(form).entries());
        await perform(form.dataset.bridgeForm,form.dataset.id,
          form.dataset.bridgeForm==='enroll'?{...values,accountMode:'demo'}:values);
      }catch(e){if(button)button.disabled=false;const msg=document.createElement('p');msg.setAttribute('role','alert');msg.className='bridge-warning';msg.textContent=e.message||'Request unavailable';form.append(msg);}
    }));
  }
  const resume=()=>{if(!document.hidden)void refresh();};
  function mount(){dispose();bind();document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);timer=setInterval(resume,15000);}
  function dispose(){generation++;request=null;lastChallenge=null;cloudAccountId=null;if(timer!==null){clearInterval(timer);timer=null;}
    if(typeof document!=='undefined')document.removeEventListener('visibilitychange',resume);
    if(typeof window!=='undefined')window.removeEventListener('online',resume);}
  return {page,mount,dispose};
}
