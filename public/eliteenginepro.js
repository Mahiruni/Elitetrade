// Integrated EliteTrade workspace. Status checks never pulse or arm an engine.
export function createEliteEngineProWorkspace({api,esc,state}) {
  let timer=null,generation=0,inFlight=false,selectedAccount=null,mutating=false,controlMessage='';
  const value=s=>esc(String(s??''));
  async function page(){
    const status=await api('/engine/pro/status');
    const legacy=status.legacy||{},independent=status.independent||{};
    const accounts=Array.isArray(status.accounts?.items)?status.accounts.items:[];
    if(!accounts.some(a=>a.id===selectedAccount))selectedAccount=accounts[0]?.id||null;
    let control=null;
    if(selectedAccount)try{control=await api('/engine/pro/accounts/'+encodeURIComponent(selectedAccount));}catch{/* Unknown, never assume stopped. */}
    const controlKnown=typeof control?.killSwitch==='boolean';
    const metric=(label,text,note)=>`<div class="bridge-metric"><span>${value(label)}</span><strong>${value(text)}</strong><small>${value(note)}</small></div>`;
    return `<section class="bridge-root enginepro-root">
      <div class="bridge-topline"><span>ELITETRADE · EXECUTION WORKSPACE</span><span class="bridge-chip bridge-warm">Independent execution blocked</span></div>
      <header class="bridge-hero"><div><div class="bridge-eyebrow">YOUR ENGINE · INSIDE ELITETRADE</div><h1>EliteEngine<span>Pro</span></h1>
        <p>Manage broker verification and strategy controls from your EliteTrade account. Continuous execution still requires a commissioned backend runtime.</p>
        <div class="bridge-actions"><a href="/elitebridge">Verify broker connection</a><a href="/bots">Open trading bots</a></div></div>
        <div class="bridge-system"><div class="bridge-system-h">INDEPENDENT ENGINE</div><div><span>Broker session</span><b>Not checked here</b></div><div><span>Continuous operation</span><b>Not verified</b></div><div><span>Order execution</span><b>Locked</b></div></div>
      </header>
      <div class="bridge-metrics">
        ${metric('Independent gateway',independent.gatewayConfigured?'Configured · unverified':'Not configured','Configuration does not authenticate a broker.')}
        ${metric('Saved MT5 accounts',status.accounts?.registered??'Unknown','Saved records are not live connection proof.')}
        ${metric('Pending accounts',status.accounts?.pending??'Unknown','Complete broker authentication to resolve connectivity.')}
        ${metric('Independent trading','Locked','No independent order adapter is commissioned.')}
      </div>
      <section class="bridge-panel"><h2>Execution readiness</h2><p class="bridge-warning">${value(independent.blocker)}</p>
        <p class="bridge-small">Closing your browser does not provide continuous compute. EliteEnginePro needs an authenticated gateway, durable scheduling and broker reconciliation before phone-independent trading can be enabled.</p>
        <div class="bridge-actions"><a href="/mt5">Manage MT5 accounts</a><a href="/elitebridge">Open EliteBridge diagnostics</a></div>
      </section>
      <section class="bridge-panel bridge-diagnostics"><h2>Durable execution control</h2>
        <p class="bridge-small">Stops new work in the independent engine and preserves uncertain submissions for reconciliation. Existing positions stay open. The separate legacy engine is unaffected.</p>
        ${accounts.length?`<label for="enginepro-account">Your MT5 account</label><select id="enginepro-account" data-enginepro-account ${mutating?'disabled':''}>
          ${accounts.map(a=>`<option value="${value(a.id)}" ${a.id===selectedAccount?'selected':''}>${value(a.broker||'MT5')} · ${value(a.server||'Server not set')} · ${value(a.id.slice(0,8))}</option>`).join('')}</select>
          <p class="bridge-warning">${controlKnown?(control.killSwitch?'Independent stop is saved':'Independent stop is not active'):'Control state unknown · backend confirmation unavailable'}</p>
          <p class="bridge-small">Unresolved broker outcomes: ${value(controlKnown?control.unresolvedCount:'Unknown')}. Submission remains locked until commissioning and authorization.</p>
          <div class="bridge-actions"><button type="button" data-enginepro-stop ${mutating?'disabled':''}>Stop independent engine</button></div>
          <p role="status" data-enginepro-message>${value(controlMessage)}</p>
          ${controlKnown&&control.intents?.length?'<ul>'+control.intents.map(i=>`<li>${value(i.id.slice(0,8))} · ${value(i.state)}${i.broker_receipt?.orderId?' · Broker order '+value(i.broker_receipt.orderId):''}</li>`).join('')+'</ul>':''}`:
          '<p class="bridge-small">Save an MT5 account to access its persistent stop control.</p>'}
      </section>
      <section class="bridge-panel bridge-diagnostics"><h2>Existing supervised demo engine</h2>
        <p class="bridge-small">This separate legacy path uses ${legacy.provider==='metaapi'?'MetaApi':'an unconfigured broker gateway'} and requires the Android foreground session to keep running.</p>
        <dl><dt>Legacy worker heartbeat</dt><dd>${value(legacy.heartbeat==='fresh'?'Recent heartbeat · broker session not verified':legacy.heartbeat==='stale-or-missing'?'Stale or missing':'Unknown')}</dd>
          <dt>Android demo controls</dt><dd>${value(legacy.mobileEnabled?'Backend configured':'Backend not enabled')}</dd></dl>
        <p class="bridge-small">${status.controls?.canManageNativeDemo?'Existing Android demo controls remain available to administrators.':'Native demo execution controls require administrator access.'} A heartbeat alone does not establish broker connectivity or independent execution.</p>
      </section>
      <p class="bridge-foot" data-enginepro-freshness role="status">Status checked ${value(new Date(status.checkedAt).toLocaleString())} · Refreshes every 15 seconds while visible</p>
      <div class="bridge-actions"><button type="button" data-enginepro-refresh>Refresh status</button></div>
    </section>`;
  }
  async function refresh(){
    if(inFlight||mutating||document.hidden||location.pathname!=='/eliteenginepro')return;
    const epoch=generation,owner=state.user,root=document.querySelector('.enginepro-root');
    if(!root)return;
    inFlight=true;
    try{
      const html=await page();
      if(epoch===generation&&owner===state.user&&root.isConnected&&location.pathname==='/eliteenginepro'){
        const focused=document.activeElement===root.querySelector('[data-enginepro-refresh]');
        root.outerHTML=html;bind();
        if(focused)document.querySelector('[data-enginepro-refresh]')?.focus({preventScroll:true});
      }
    }catch{
      if(epoch===generation&&owner===state.user&&root.isConnected){
        root.querySelector('[data-enginepro-freshness]').textContent='Status unavailable · displayed values may be stale · retrying automatically';
      }
    }finally{if(epoch===generation)inFlight=false;}
  }
  function bind(){
    document.querySelector('[data-enginepro-refresh]')?.addEventListener('click',()=>void refresh());
    document.querySelector('[data-enginepro-account]')?.addEventListener('change',event=>{
      selectedAccount=event.target.value;controlMessage='';generation++;inFlight=false;void refresh();
    });
    document.querySelector('[data-enginepro-stop]')?.addEventListener('click',async event=>{
      if(mutating||!selectedAccount)return;
      const account=selectedAccount,owner=state.user,epoch=++generation;
      mutating=true;inFlight=false;event.currentTarget.disabled=true;
      const select=document.querySelector('[data-enginepro-account]');if(select)select.disabled=true;
      try{
        const result=await api('/engine/pro/accounts/'+encodeURIComponent(account)+'/stop','POST',{});
        if(epoch===generation&&owner===state.user)controlMessage=result?.killSwitch===true?
          'Stop confirmed and saved. Existing positions remain open.':'Stop was not confirmed. Verify the saved state.';
      }catch{
        if(epoch===generation&&owner===state.user)controlMessage='Stop was not confirmed. Retry and verify the saved state.';
      }finally{
        if(epoch===generation){
          mutating=false;await refresh();
          if(epoch===generation&&owner===state.user){
            const button=document.querySelector('[data-enginepro-stop]');if(button)button.disabled=false;
            const selector=document.querySelector('[data-enginepro-account]');if(selector)selector.disabled=false;
          }
        }
      }
    });
  }
  const resume=()=>{if(!document.hidden)void refresh();};
  function dispose({clearSelection=true}={}){
    generation++;inFlight=false;mutating=false;
    if(clearSelection){controlMessage='';selectedAccount=null;}
    if(timer!==null){clearInterval(timer);timer=null;}
    if(typeof document!=='undefined')document.removeEventListener('visibilitychange',resume);
    if(typeof window!=='undefined')window.removeEventListener('online',resume);
  }
  function mount(){dispose({clearSelection:false});bind();timer=setInterval(resume,15000);document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);}
  return {page,mount,dispose};
}
