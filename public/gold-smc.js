// Standalone research panel. No order or bot-control calls originate here.
export function createGoldSmcWorkspace({state,api,esc}) {
  let root=null,controller=null,active=false,selected='',bots=[],timer=null;
  const safe=value=>esc(value==null?'—':String(value));
  const stamp=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'—';
  const field=(label,value)=>'<div class="gsm-metric"><span>'+safe(label)+'</span><strong>'+safe(value)+'</strong></div>';
  const button=(label,action,disabled=false)=>'<button type="button" data-gsm="'+action+'" '+(disabled?'disabled':'')+'>'+safe(label)+'</button>';
  const note='<p class="gsm-disclaimer">Read-only broker research. NOT an executable signal, performance guarantee, or order authorization. Economic-news verification and MT5 execution remain separate.</p>';
  function page() {
    return '<section id="gold-smc" class="gold-smc"><header class="gsm-hero"><div><span class="gsm-eyebrow">ELITETRADE / GOLD INTELLIGENCE</span><h1>Gold <em>SMC Scalper</em></h1><p>M15 bias · M5 liquidity sweep → MSS → displacement FVG → OTE retest</p></div><div class="gsm-status" id="gsm-status">RESEARCH ONLY</div></header><section class="gsm-panel"><div class="gsm-toolbar"><label for="gsm-bot">Configured XAUUSD bot <select id="gsm-bot"><option value="">Loading MT5 strategies…</option></select></label><div class="gsm-actions">'+button('Analyze MT5','analyze',true)+button('Start 60s research scans','auto',true)+'</div></div><div id="gsm-result" aria-live="polite" class="gsm-result"><p>Connect an MT5 account and configure a stopped XAUUSD bot in Trading bots to request verified broker candles.</p></div></section><footer class="gsm-footer">'+note+'<a href="/bots">Configure trading bot →</a> · <a href="/mt5">MT5 connections →</a></footer></section>';
  }
  function show(message){const target=root?.querySelector('#gsm-result');if(target)target.innerHTML='<p>'+safe(message)+'</p>';}
  function present(r) {
    if(!root)return;
    const tone=r.state==='BUY'?'buy':r.state==='SELL'?'sell':'wait';
    root.querySelector('#gsm-status').textContent=r.state+' · '+r.accountType.toUpperCase()+' · READ ONLY';
    const sequence=r.structure;
    const cards=[
      field('M15 bias',r.bias),field('M15 EMA50',r.ema50),field('M5 ATR (points)',r.atrPoints),
      field('Live spread (points)',r.spreadPoints),field('Session · UTC',r.session),
      field('Broker quote time',stamp(r.quoteTime))
    ];
    const steps=sequence?'<div class="gsm-sequence">'+[
      field('Liquidity sweep',stamp(sequence.sweepAt)),
      field('Structure shift',stamp(sequence.shiftAt)),
      field('Fair value gap',sequence.fvg.low+' – '+sequence.fvg.high),
      field('OTE retracement',sequence.ote.low+' – '+sequence.ote.high)
    ].join('')+'</div>':'<div class="gsm-notice">A complete, ordered sweep → MSS → FVG → OTE retest has not been confirmed.</div>';
    const plan=r.plan?'<section class="gsm-plan"><h3>Indicative scenario · never an order</h3><div class="gsm-grid">'+[
      field('Reference entry',r.plan.entry),field('Structure SL',r.plan.stopLoss),
      field('TP1 · 1R / 70%',r.plan.tp1),field('TP2 · 2.5R / 30%',r.plan.tp2)
    ].join('')+'</div></section>':'';
    root.querySelector('#gsm-result').innerHTML='<div class="gsm-signal '+tone+'"><div><small>VALIDATED RESEARCH STATE</small><strong>'+safe(r.state)+'</strong></div><div><small>Data source</small><span>MT5 broker · '+safe(r.symbol)+'</span><span>'+safe(stamp(r.evaluatedAt))+'</span></div></div>'+
      '<div class="gsm-grid">'+cards.join('')+'</div><h2>Structural evidence</h2>'+steps+plan+
      '<h2>Trade gate and diagnostics</h2><ul class="gsm-reasons">'+r.reasons.map(x=>'<li>'+safe(x)+'</li>').join('')+'</ul>'+
      '<div class="gsm-notice">'+r.warnings.map(safe).join(' · ')+'</div>';
  }
  async function scan() {
    if(!root||!selected||!navigator.onLine||document.hidden){show('Reconnect and open this page to request a fresh MT5 preview.');stop();return;}
    const id=selected; const btn=root.querySelector('[data-gsm="analyze"]');if(btn)btn.disabled=true;
    const local=new AbortController(); controller?.abort(); controller=local;
    root.querySelector('#gsm-status').textContent='VERIFYING BROKER DATA…';
    try {
      const r=await api('/bots/'+encodeURIComponent(id)+'/preview','POST',{goldSmc:true});
      if(local.signal.aborted||!root||selected!==id)return;
      if(!r?.goldSmc||r.goldSmc.executionEnabled!==false)throw new Error('The server returned an unverified analysis result.');
      present(r.goldSmc);
    }catch(error) {
      if(!local.signal.aborted&&root){show(error.message||'Unable to verify MT5 history. No signal is available.');root.querySelector('#gsm-status').textContent='UNAVAILABLE · NO TRADE';}
      stop();
    }finally {
      if(!local.signal.aborted&&btn)btn.disabled=false;
      if(active&&root&&!local.signal.aborted)timer=setTimeout(scan,60000);
    }
  }
  function stop(){
    active=false;clearTimeout(timer);timer=null;
    const b=root?.querySelector('[data-gsm="auto"]');if(b)b.textContent='Start 60s research scans';
  }
  async function mount(){
    root=document.getElementById('gold-smc');if(!root)return;
    root.addEventListener('click',click);
    root.addEventListener('change',change);
    try {
      const [b,a]=await Promise.all([api('/bots'),api('/accounts')]);
      if(!root)return;
      const connected=new Set((a.accounts||[]).filter(x=>x.status==='connected').map(x=>x.id));
      bots=(b.bots||[]).filter(x=>/^XAUUSD[A-Za-z0-9._-]{0,20}$/i.test(x.symbol||'')&&connected.has(x.account_id));
      selected=bots[0]?.id||'';
      const box=root.querySelector('#gsm-bot');
      box.innerHTML='<option value="">'+(bots.length?'Select a Gold configuration':'No connected XAUUSD bots')+'</option>'+bots.map(x=>'<option value="'+safe(x.id)+'">'+safe(x.name)+' · '+safe(x.symbol)+'</option>').join('');
      box.value=selected;
      root.querySelector('[data-gsm="analyze"]').disabled=!selected;
      root.querySelector('[data-gsm="auto"]').disabled=!selected;
      show(selected?'Choose Analyze MT5 for a fresh broker-verified research result.':'Set up a connected XAUUSD trading bot in Trading bots. Analysis will remain read-only.');
    }catch(error){show(error.message||'Unable to load MT5 accounts.');}
  }
  function click(e){
    const btn=e.target.closest('[data-gsm]');if(!btn||!root?.contains(btn))return;
    if(btn.dataset.gsm==='analyze'){clearTimeout(timer);void scan();}
    if(btn.dataset.gsm==='auto'){if(active)stop();else{active=true;btn.textContent='Stop research scans';void scan();}}
  }
  function change(e){
    if(e.target?.id==='gsm-bot'){selected=e.target.value;stop();controller?.abort();
      root.querySelector('[data-gsm="analyze"]').disabled=!selected;root.querySelector('[data-gsm="auto"]').disabled=!selected;
      root.querySelector('#gsm-status').textContent='RESEARCH ONLY';show('Request a fresh broker-verified analysis.');}
  }
  function dispose(){
    stop();controller?.abort();controller=null;
    root?.removeEventListener('click',click);root?.removeEventListener('change',change);root=null;
  }
  return {page,mount,dispose};
}
