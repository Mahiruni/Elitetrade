/**
 * EliteBridge terminal enrollment console.
 * Admin/device-verification enforced by backend. No passwords, MT5 broker
 * logins, service role keys or private Ed25519 PEMs accepted anywhere here.
 * A freshly signed packet is NOT proof of independently connected MT5.
 */
export function createEliteBridgeEnrollmentConsole({api,esc,isAdmin=()=>false}) {
  let panel=null,loading=false,notice='',error='',challenge=null,lastData=null,refreshTimer=null;
  const strictId=id=>typeof id==='string'&&/^[0-9a-fA-F-]{36}$/.test(id);
  const safe=x=>esc(String(x??''));
  const date=x=>{
    const time=Date.parse(x||'');
    return Number.isFinite(time)?new Date(time).toLocaleString():'Not recorded';
  };
  async function load() {
    if(!isAdmin())return {admin:false};
    const fetchSafe=async path=>{try{return {value:await api(path,'GET'),error:null}}
      catch(e){return {value:null,error:e?.message||'Unavailable'}};};
    const [protocol,terminals,health,accounts]=await Promise.all([
      fetchSafe('/elitebridge/protocol'),fetchSafe('/elitebridge/terminals'),
      fetchSafe('/elitebridge/diagnostics'),fetchSafe('/accounts?fast=1')
    ]);
    return {admin:true,
      protocol:protocol.value,terminals:terminals.value,health:health.value,
      accounts:accounts.value,error:terminals.error||protocol.error,
      diagnosticsError:health.error};
  }
  const btn=(label,action,id='',disabled=false,variant='ghost')=>
    '<button type="button" data-bridge-action="'+action+'" data-bridge-id="'+safe(id)+'" class="bridge-button '+variant+'"'+
      (disabled?' disabled aria-disabled="true"':'')+'>'+safe(label)+'</button>';
  function render(data) {
    if(!data?.admin)return '<section class="host-panel bridge-console" aria-label="Independent MT5 setup"><span class="host-eyebrow">04 / ELITEBRIDGE</span><h2>Independent MT5 connection</h2><p>Terminal pairing requires administrator access. Your existing MetaApi account remains unchanged.</p></section>';
    const cloud=data.protocol?.pairingProofRequired===true && data.protocol?.pairingEnabled===true;
    const terminals=Array.isArray(data.terminals?.terminals)?data.terminals.terminals:[];
    const accounts=Array.isArray(data.accounts?.accounts)?data.accounts.accounts:[];
    const diagnostics=Array.isArray(data.health?.terminals)?data.health.terminals:[];
    const healthById=new Map(diagnostics.map(x=>[x.terminalId,x]));
    const safeState=(x)=>x==='receiving'?'Signed data received':x==='stale'?'Stale':x==='awaiting-approval'?'Not approved':x==='awaiting-telemetry'?'No telemetry':'Awaiting confirmation';
    return `<section class="host-panel bridge-console" data-bridge-ready="${cloud}" aria-label="EliteBridge terminal pairing">
      <div class="host-panel-head"><div><span class="host-eyebrow">04 / INDEPENDENT CONNECTIVITY</span><h2>EliteBridge cloud</h2></div>
        <span class="host-chip host-chip--research"><i aria-hidden="true"></i>${cloud?'Enrollment available':'Waiting for backend'}</span></div>
      <p class="bridge-description">Your independent signed MT5 gateway. Register a PUBLIC Ed25519 key generated on a trusted Windows terminal, verify its possession, then approve it. This does not switch providers or activate trading.</p>
      <div class="bridge-status-grid">
        <div><small>Terminal registrations</small><strong>${terminals.length}</strong></div>
        <div><small>Approved</small><strong>${terminals.filter(t=>t.status==='approved').length}</strong></div>
        <div><small>Signed telemetry</small><strong>${diagnostics.filter(x=>x.state==='receiving').length} receiving</strong></div>
        <div><small>Independent orders</small><strong>Disabled</strong></div>
      </div>
      ${data.error?'<p class="bridge-alert" role="alert">Secure terminal API unavailable: '+safe(data.error)+'</p>':''}
      ${data.diagnosticsError?'<p class="bridge-description">Live diagnostics unavailable; broker status cannot be inferred.</p>':''}
      ${notice?'<p class="bridge-alert bridge-alert-success" role="status">'+safe(notice)+'</p>':''}
      ${error?'<p class="bridge-alert" role="alert">'+safe(error)+'</p>':''}
      <div class="bridge-actions">${btn('Check cloud status','refresh','',false,'primary')}<span>Refreshes while this page is visible · no trade commands</span></div>
      <div class="bridge-pairing-grid">
        <form data-bridge-enroll class="bridge-enroll">
          <h3>Enroll a trusted Windows terminal</h3>
          <p>The private signing key must remain on your Windows machine. Paste only its PUBLIC key here.</p>
          <label for="bridge-account">MT5 account binding</label>
          <select id="bridge-account" name="accountId" required ${cloud?'':'disabled'}>
            <option value="">Choose your owned MT5 account</option>
            ${accounts.map(a=>`<option value="${safe(a.id)}">${safe(a.broker||'MT5')} · ${safe(String(a.login||'').replace(/.(?=.{3})/g,'•'))}</option>`).join('')}
          </select>
          <label for="bridge-label">Terminal label</label>
          <input id="bridge-label" name="label" type="text" minlength="3" maxlength="64" placeholder="Windows VPS · Demo terminal" required autocomplete="off" ${cloud?'':'disabled'}/>
          <label for="bridge-public">Ed25519 PUBLIC key (PEM)</label>
          <textarea id="bridge-public" name="publicKey" rows="5" maxlength="600" placeholder="-----BEGIN PUBLIC KEY-----" required spellcheck="false" autocomplete="off" ${cloud?'':'disabled'}></textarea>
          <p class="bridge-warning">Never enter an MT5 password, private signing key, access token or recovery code.</p>
          <button class="bridge-button primary" type="submit" ${cloud?'':'disabled'}>Register public key</button>
          ${!accounts.length?'<p>No MT5 binding available for this account. Connect MT5 first.</p>':''}
        </form>
        <div class="bridge-devices">
          <h3>Enrolled terminals</h3>
          ${!terminals.length?'<p class="bridge-empty">No terminal has been enrolled. A signed browser session alone cannot replace a Windows MT5 terminal.</p>':
          terminals.map(t=>{
            const health=healthById.get(t.id),proven=!!t.proof_verified_at;
            const status=health?.state||t.telemetryState||'never-received';
            const id=safe(t.id);
            return `<article class="bridge-device" data-terminal="${id}">
              <div class="bridge-device-head"><strong>${safe(t.label)}</strong><span>${safe(t.status)}</span></div>
              <p>${safe(t.account_mode||'demo').toUpperCase()} observation · ${safe(safeState(status))}</p>
              <p>Key ownership: ${proven?'Verified':'Not yet proven'} · Last receipt: ${date(t.last_seen_at)}</p>
              <p>Signed heartbeat: ${health?.heartbeatAgeSeconds??'—'}s · quote: ${health?.quoteAgeSeconds??'—'}s</p>
              <p class="bridge-warning">Broker independently verified: NO · Orders: disabled</p>
              ${t.status==='pending'? `<div class="bridge-actions">
                ${!proven?btn('Issue pairing challenge','challenge',t.id):btn('Approve verified terminal','approve',t.id)}
                ${btn('Revoke','revoke',t.id)}
              </div>`:t.status==='approved'?'<div class="bridge-actions">'+btn('Revoke terminal','revoke',t.id)+'</div>':''}
              ${t.status==='pending'&&!proven?`<form data-bridge-prove="${id}" class="bridge-proof">
                <label for="proof-${id}">Signature from Windows (base64url)</label>
                <input id="proof-${id}" name="signature" type="text" pattern="[A-Za-z0-9_-]{86}" minlength="86" maxlength="86" required autocomplete="off" placeholder="Paste signature only"/>
                <button type="submit" class="bridge-button">Verify terminal key ownership</button>
              </form>`:''}
            </article>`;
          }).join('')}
        </div>
      </div>
      ${challenge?`<div class="bridge-challenge" role="status">
        <h3>One-time pairing challenge</h3>
        <p>Run <code>npm run bridge:terminal:prove -- &lt;challenge&gt;</code> on the actual Windows terminal. Share only the resulting signature, never the private key. Challenge expires in 10 minutes.</p>
        <textarea data-bridge-challenge rows="4" readonly aria-label="Copy signed pairing challenge">${safe(challenge)}</textarea>
        ${btn('Copy challenge','copy-challenge')}
      </div>`:''}
    </section>`;
  }
  const rerender=()=>{if(panel){panel.innerHTML=render(lastData);}};
  async function reload(){
    if(loading)return;
    loading=true;
    try{lastData=await load();error='';rerender();}
    catch{error='Secure terminal registry temporarily unavailable.';rerender();}
    finally{loading=false;}
  }
  async function mutation(op,terminalId,extra){
    if(loading)return;
    error='';notice='';loading=true;
    try{
      const result=await api('/elitebridge/terminals'+(terminalId?'/'+encodeURIComponent(terminalId)+'/'+op:''),
        'POST',extra||{});
      if(op==='challenge'){challenge=result.challenge||null;notice='Challenge created. Sign it on your Windows terminal.';}
      else {challenge=null;notice=op==='prove'?'Key ownership proven. Review the terminal before approving.':
        op==='approve'?'Terminal approved for read-only signed telemetry. No broker orders enabled.':
        op==='revoke'?'Terminal revoked. Its key cannot be reused.':
        'Public key registered; pairing proof and manual approval are still required.';}
      lastData=await load();
    }catch(e){error=e?.message||'Secure terminal operation failed.';}
    finally{loading=false;rerender();}
  }
  function mount(){
    panel=document.querySelector('[data-bridge-console]');
    if(!panel)return;
    panel.addEventListener('submit',e=>{
      const form=e.target;
      if(form.matches('[data-bridge-enroll]')){
        e.preventDefault();
        if(loading||!isAdmin()||lastData?.protocol?.pairingEnabled!==true)return;
        const fd=new FormData(form),publicKey=String(fd.get('publicKey')||'').trim();
        if(!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----$/.test(publicKey)||
           publicKey.length>600){error='Only a PUBLIC Ed25519 PEM is accepted.';rerender();return;}
        const accountId=String(fd.get('accountId')||'');
        if(!strictId(accountId))return;
        void mutation('',null,{accountId,label:String(fd.get('label')||''),publicKey,accountMode:'demo'});
      }else if(form.matches('[data-bridge-prove]')){
        e.preventDefault();
        const terminalId=form.dataset.bridgeProve;
        const signature=String(new FormData(form).get('signature')||'').trim();
        if(!strictId(terminalId)||!/^[A-Za-z0-9_-]{86}$/.test(signature))return;
        void mutation('prove',terminalId,{signature});
      }
    });
    panel.addEventListener('click',e=>{
      const el=e.target.closest('[data-bridge-action]');
      if(!el||loading)return;
      const id=el.dataset.bridgeId,action=el.dataset.bridgeAction;
      if(action==='refresh'){void reload();return;}
      if(action==='copy-challenge'&&challenge){
        void navigator.clipboard.writeText(challenge).then(()=>{notice='Challenge copied.';rerender();})
          .catch(()=>{error='Select and copy the challenge manually.';rerender();});return;
      }
      if(!strictId(id)||!['challenge','approve','revoke'].includes(action))return;
      if(action==='approve' && !window.confirm('Approve this key for READ-ONLY telemetry only after independently checking its owner?'))return;
      if(action==='revoke' && !window.confirm('Permanently revoke this terminal key? New enrollment will be required.'))return;
      void mutation(action,id,{});
    });
    void reload();
    if(refreshTimer!==null)clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>{if(!document.hidden&&location.pathname==='/hosted-mt5'&&!loading)void reload();},30000);
  }
  function dispose(){if(refreshTimer!==null)clearInterval(refreshTimer);refreshTimer=null;panel=null;loading=false;challenge=null;}
  return {render:()=>render(lastData),mount,dispose,load};
}
