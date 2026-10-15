// EliteBridge Control Center — independent signed MT5 telemetry, never order execution.
export function createEliteBridgeWorkspace({api,esc,state}) {
  const guide='https://github.com/Mahiruni/Elitetrade/blob/main/docs/ELITEBRIDGE_PHASE9_WINDOWS_READINESS.md';
  let timer=null,request=false,lastChallenge=null;
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
      '<div class="bridge-actions">'+(!t.proof_verified_at&&t.status==='pending'?'<button type="button" data-bridge-cmd="challenge" data-id="'+safe(deviceId)+'">Pair terminal</button>':'')+
      (t.proof_verified_at&&t.status==='pending'?'<button type="button" data-bridge-cmd="approve" data-id="'+safe(deviceId)+'">Approve after fingerprint check</button>':'')+
      (t.status!=='revoked'?'<button type="button" class="bridge-danger" data-bridge-cmd="revoke" data-id="'+safe(deviceId)+'">Revoke</button>':'')+'</div></article>';
  }
  async function page(){
    const admin=state.user?.role==='admin';
    const [status,protocol]=await Promise.allSettled([api('/elitebridge/status'),api('/elitebridge/protocol')]);
    const s=status.status==='fulfilled'?status.value:null,p=protocol.status==='fulfilled'?protocol.value:null;
    let list={terminals:[]},checks={terminals:[]},setupError='',accounts={accounts:[]};
    if(admin&&p?.pairingEnabled){
      const results=await Promise.allSettled([
        api('/elitebridge/terminals'),api('/elitebridge/diagnostics'),api('/accounts','GET',undefined,{snapshot:true})
      ]);
      if(results[0].status==='fulfilled')list=results[0].value;
      else setupError='Terminal registry is temporarily unavailable.';
      if(results[1].status==='fulfilled')checks=results[1].value;
      if(results[2].status==='fulfilled')accounts=results[2].value;
    }
    const terminals=list?.terminals||[],hasCloud=!!p?.pairingEnabled,phase=p?.phase||3;
    const phaseLabel=hasCloud?'Enrollment available':'Cloud configuration pending';
    const health=checks?.terminals||[];
    return '<section class="bridge-root" aria-labelledby="bridge-heading">'+
    '<div class="bridge-topline"><span>ELITETRADE / INDEPENDENT CONNECTIVITY</span>'+badge('Read-only · no orders','warm')+'</div>'+
    '<header class="bridge-hero"><div><div class="bridge-eyebrow">Windows MT5 · Signed telemetry · Your infrastructure</div>'+
    '<h1 id="bridge-heading">Elite<span>Bridge.</span></h1>'+
    '<p>Build a secure, provider-independent route from a trusted Windows MT5 terminal to your EliteTrade account. Track signed heartbeat and broker observations without relying on simulated connection indicators.</p>'+
    '<div class="bridge-actions">'+link(guide,'Windows deployment guide')+'<button type="button" data-bridge-cmd="refresh">Check connectivity ↻</button></div>'+
    '</div><div class="bridge-system"><div class="bridge-system-h"><span>ELITE / MT5</span><span>PHASE '+safe(phase)+'</span></div>'+
    '<div><span>Android / Web</span><b>CONTROL</b></div><div><span>EliteBridge Cloud</span><b>'+safe(hasCloud?'CONFIGURABLE':'DISABLED')+'</b></div>'+
    '<div><span>Windows Terminal</span><b>NOT VERIFIED</b></div><div><span>Broker Execution</span><b>LOCKED</b></div></div></header>'+
    '<div class="bridge-metrics">'+
    metric('Cloud readiness',phaseLabel,hasCloud?'Registered device approval required':'Server feature flag or secure storage unavailable')+
    metric('Registered terminals',String(terminals.length),hasCloud?'Owner-scoped registry':'No independent terminal verified')+
    metric('Receiving telemetry',String(health.filter(h=>h.state==='receiving').length),'Signed observations only; not broker authentication')+
    metric('Real-money execution','Disabled','Independent bridge has no live-order authority')+'</div>'+
    '<div class="bridge-layout"><section class="bridge-panel"><div class="bridge-panel-head"><div><span class="bridge-kicker">01 / INFRASTRUCTURE</span><h2>Trusted terminals</h2></div>'+badge(hasCloud?'Pairing required':'Awaiting activation')+'</div>'+
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
    '<aside class="bridge-side"><section class="bridge-panel"><div class="bridge-panel-head"><div><span class="bridge-kicker">02 / COMMISSIONING</span><h2>Connection checklist</h2></div></div>'+
    ['Provision an authorized Windows host with interactive MT5','Sign into your broker account within Windows MT5','Generate Ed25519 signing identity on Windows','Enroll the public key and pass the possession challenge','Send signed broker-derived heartbeat and quote'].map((item,i)=>'<div class="bridge-step"><i>'+String(i+1).padStart(2,'0')+'</i><span>'+safe(item)+'</span></div>').join('')+
    '</section><section class="bridge-panel bridge-safety"><h2>Execution security</h2><p>Our original MetaApi integration stays separate. EliteBridge cannot start bots, send orders, or switch a REAL account into trading mode. DEMO and REAL observation are distinct.</p>'+
    '<div class="bridge-links">'+link(guide,'Technical runbook')+'</div></section></aside></div>'+
    (lastChallenge?'<section class="bridge-panel bridge-proof"><h2>One-time terminal challenge</h2><p>Sign this challenge on the enrolled Windows terminal. Do not share the private key.</p><textarea readonly rows="4" data-bridge-challenge>'+safe(JSON.stringify(lastChallenge.challenge))+'</textarea>'+
      '<div class="bridge-actions"><button type="button" data-bridge-cmd="copy-challenge">Copy challenge</button></div>'+
      '<form data-bridge-form="prove" data-id="'+safe(lastChallenge.terminalId)+'"><label>Signed proof (base64url)<input name="signature" required autocomplete="off"></label>'+
      '<button type="submit">Verify terminal possession</button></form></section>':'')+
    '<p class="bridge-foot">Terminal identity ≠ independent broker verification · Current provider remains unchanged · Refresh runs automatically while this page is visible</p></section>';
  }
  async function refresh(){
    if(request||location.pathname!=='/elitebridge')return;
    request=true;
    try{
      const html=await page(),root=document.querySelector('.bridge-root');
      if(root&&location.pathname==='/elitebridge'){root.outerHTML=html;bind();}
    }catch{const el=document.querySelector('.bridge-foot');if(el)el.textContent='Cloud diagnostics temporarily unavailable · auto-retrying';}
    finally{request=false;}
  }
  async function perform(kind,id,payload={}){
    const url='/elitebridge/terminals'+(id?'/'+encodeURIComponent(id):'');
    if(kind==='enroll')await api(url,'POST',payload);
    if(kind==='challenge'){const result=await api(url+'/challenge','POST',{});lastChallenge=result;}
    if(kind==='prove'){await api(url+'/prove','POST',payload);lastChallenge=null;}
    if(kind==='approve'||kind==='revoke')await api(url+'/'+kind,'POST',{});
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
  function mount(){bind();dispose();timer=setInterval(()=>{if(!document.hidden && !document.querySelector('.bridge-root input:focus, .bridge-root textarea:focus, .bridge-root select:focus'))void refresh();},15000);}
  function dispose(){if(timer!==null){clearInterval(timer);timer=null;}}
  return {page,mount,dispose};
}
