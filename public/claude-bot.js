// ClaudeBot: independent read-only signal workspace. Nothing in this module sends an order.
const DEFINITIONS = [
  ['Trend · 1h','trend'],['Support & resistance','levels'],
  ['5-second move','five'],['Momentum','momentum'],
  ['Trading session','session'],['EMA 50 / 200','ema'],
  ['Price at level','reaction'],['RSI · 14','rsi']
];
const finite = n => typeof n === 'number' && Number.isFinite(n);
const result = (detail,available=true) => ({detail,available});
const formatPrice = n => finite(n) ? new Intl.NumberFormat('en',{maximumFractionDigits:6}).format(n) : '—';
const percent = n => (n >= 0 ? '+' : '') + n.toFixed(3) + '%';
export function calculateRsi(prices,period=14) {
  if(!Array.isArray(prices)||prices.length<period+1||prices.some(p=>!finite(p)))return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const change=prices[i]-prices[i-1];gain+=Math.max(change,0);loss+=Math.max(-change,0);}
  gain/=period;loss/=period;
  for(let i=period+1;i<prices.length;i++){const change=prices[i]-prices[i-1];gain=(gain*(period-1)+Math.max(change,0))/period;loss=(loss*(period-1)+Math.max(-change,0))/period;}
  return loss===0 ? (gain===0?50:100) : 100-100/(1+gain/loss);
}
export function calculateEma(prices,period) {
  if(!Array.isArray(prices)||prices.length<period||prices.some(p=>!finite(p)))return null;
  let value=prices.slice(0,period).reduce((s,n)=>s+n,0)/period;
  for(let i=period;i<prices.length;i++)value+=(prices[i]-value)*2/(period+1);
  return value;
}
export function evaluateClaudeChecks(preview,now=Date.now()) {
  const timeframe=String(preview?.timeframe||'');
  const minutes=/^\d+m$/.test(timeframe)?Number(timeframe.slice(0,-1)):0;
  const duration=minutes*60000;
  const raw=Array.isArray(preview?.candles)?preview.candles:[];
  const candles=raw.filter(c=>c&&Number.isFinite(Date.parse(c.time))&&[c.open,c.high,c.low,c.close].every(n=>finite(n)&&n>0)&&c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close)).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const closed=candles.filter(c=>duration>0&&Date.parse(c.time)+duration<=now);
  const prices=closed.map(c=>c.close),last=closed.at(-1);
  const values=[];
  let trend=result('Requires verified 1-hour candle groups.',false);
  if(minutes>0&&60%minutes===0) {
    const perHour=60/minutes,groups=new Map();
    for(const c of closed){const key=Math.floor(Date.parse(c.time)/3600000);const group=groups.get(key)||[];group.push(c);groups.set(key,group);}
    const hourly=[...groups.entries()].filter(([key,group])=>group.length===perHour&&group.every((c,i)=>i===0||Date.parse(c.time)-Date.parse(group[i-1].time)===duration)&&Date.parse(group[0].time)===key*3600000).sort((a,b)=>a[0]-b[0]);
    if(hourly.length>=3) {
      const a=hourly.at(-1),b=hourly.at(-2),move=a[1].at(-1).close-b[1].at(-1).close;
      trend=result((move>0?'Rising':move<0?'Falling':'Flat')+' · consecutive complete 1h closes');
    }
  }
  values.push(trend);
  let levels=result('Requires at least 21 closed candles.',false);
  let support=null,resistance=null;
  if(closed.length>=21){
    const previous=closed.slice(-21,-1);
    support=Math.min(...previous.map(c=>c.low));resistance=Math.max(...previous.map(c=>c.high));
    levels=result('Support '+formatPrice(support)+' · Resistance '+formatPrice(resistance));
  }
  values.push(levels);
  values.push(result('Unavailable · broker provides '+(timeframe||'candle')+' candles, not verified 5s ticks.',false));
  values.push(prices.length>=6&&prices.at(-6)>0 ? result('Five-candle change '+percent((prices.at(-1)/prices.at(-6)-1)*100)) : result('Requires at least six closed candles.',false));
  if(last){
    const h=new Date(Date.parse(last.time)).getUTCHours();
    values.push(result('UTC '+String(h).padStart(2,'0')+':00 · market hours/holidays not verified'));
  } else values.push(result('Trading-session context unavailable.',false));
  const ema50=calculateEma(prices,50),ema200=calculateEma(prices,200);
  values.push(ema50!==null&&ema200!==null ? result('EMA 50 '+formatPrice(ema50)+' · EMA 200 '+formatPrice(ema200)+(ema50>ema200?' · Bullish alignment':' · Bearish alignment')) : result('Requires 200 closed candles (provider may return fewer).',false));
  if(last&&support!==null&&resistance!==null){
    values.push(result(last.close>resistance?'Break above recent resistance':last.close<support?'Break below recent support':'Price inside previous 20-candle range'));
  } else values.push(result('Requires current price and calculated levels.',false));
  const rsi=calculateRsi(prices);
  values.push(rsi!==null ? result(rsi.toFixed(1)+(rsi>70?' · Overbought context':rsi<30?' · Oversold context':' · Neutral context')) : result('Requires at least 15 closed candles.',false));
  return values;
}
export function isFreshBrokerQuote(preview,now=Date.now()) {
  const t=Date.parse(preview?.updatedAt||'');
  return finite(t)&&t<=now+5000&&t>=now-60000;
}
export function createClaudeBot({state,api,esc,date}) {
  let bots=[],accounts=[],selected='',preview=null,checks=[],phase='idle',error='',completed=0,generation=0,host=null,controller=null;
  const safe = value => esc(value===undefined||value===null?'':String(value));
  const currentBot = () => bots.find(b=>b.id===selected);
  const source = () => preview?.accountType==='demo'?'Demo MT5':preview?.accountType==='real'?'Live MT5':'Account type unverified';
  const fresh = () => isFreshBrokerQuote(preview);
  const availability = () => checks.filter(c=>c&&c.available).length;
  const renderContent = () => {
    const bot=currentBot(),side=phase==='complete'&&fresh()&&['buy','sell'].includes(preview?.signal?.side)?preview.signal.side:'';
    const stateClass=phase==='loading'?'busy':side||'neutral';
    const headline=phase==='loading'?'ANALYZING…':phase==='error'?'DATA UNAVAILABLE':phase==='complete'&&!fresh()?'SIGNAL EXPIRED':side==='buy'?'HIGHER / BUY':side==='sell'?'LOWER / SELL':phase==='complete'?'NO TRADE':'READY TO ANALYZE';
    const subline=phase==='loading'?'Checking available broker data':phase==='error'?'The requested market preview failed':phase==='complete'&&!fresh()?'Broker quote is older than 60 seconds':side?'Strategy direction · preview only':phase==='complete'?'No qualifying strategy entry':'Connect a verified MT5 instrument to begin';
    const options=bots.map(b=>'<option value="'+safe(b.id)+'" '+(b.id===selected?'selected':'')+'>'+safe(b.symbol)+' · '+safe(b.strategy)+' · '+safe(b.name)+'</option>').join('');
    const account=accounts.find(a=>a.id===bot?.account_id);
    const accountName=account?account.broker+' · '+account.login:'No connected broker account';
    const steps=DEFINITIONS.map(([label],i)=>{
      const step=checks[i],status=step?(step.available?'checked':'unavailable'):phase==='loading'&&completed===i?'active':'pending';
      return '<article class="cb-check cb-'+status+'"><div class="cb-check-top"><span class="cb-number">'+String(i+1).padStart(2,'0')+'</span><span class="cb-check-state" aria-label="'+safe(status)+'">'+(status==='checked'?'✓':status==='unavailable'?'—':status==='active'?'◌':'·')+'</span></div><h3>'+safe(label)+'</h3><p>'+safe(step?.detail|| (status==='active'?'Evaluating…':'Awaiting broker data'))+'</p></article>';
    }).join('');
    const quoteTime=preview?.updatedAt?date(preview.updatedAt):'Not loaded';
    const lastTime=preview?.signal?.candleTime?date(preview.signal.candleTime):'Not loaded';
    const accountNotice=!bots.length?'<p class="cb-notice">No configured strategies found. Create a bot and connect an MT5 account first. <a href="/bots">Manage trading bots →</a></p>':account?.status!=='connected'?'<p class="cb-notice">This strategy does not currently have a verified connected MT5 account. <a href="/mt5">Manage MT5 →</a></p>':'';
    const decisionNote=phase==='complete'?'The existing server-side strategy produced this read-only decision. The eight cards are additional contextual checks, not a separate probability or execution guarantee.':'Analysis does not send orders. Performance and win rates are never simulated.';
    return '<div class="cb-topline"><div><span class="cb-overline">ELITETRADE · SIGNAL INTELLIGENCE</span><h1>Claude<span>Bot</span></h1><p>Independent market analysis workspace</p></div><span class="cb-mode">READ-ONLY · BROKER DATA</span></div>'+
      '<div class="cb-body"><section class="cb-primary"><div class="cb-toolbar"><div class="cb-instrument"><label for="cb-select">Instrument / configured strategy</label><select id="cb-select" '+(phase==='loading'?'disabled':'')+'>'+(!bots.length?'<option>No strategies available</option>':options)+'</select><span>'+safe(accountName)+'</span></div><a href="/mt5" class="cb-quiet-link">MT5 connection ↗</a></div>'+
      accountNotice+
      '<section class="cb-signal cb-signal-'+stateClass+'" aria-live="polite"><span class="cb-signal-label">STRATEGY SIGNAL</span><div class="cb-signal-arrow" aria-hidden="true">'+(side==='buy'?'↗':side==='sell'?'↘':'◇')+'</div><h2>'+headline+'</h2><p>'+subline+'</p><div class="cb-signal-meta"><span>'+safe(bot?.symbol||'No instrument')+'</span><span>'+safe(preview?source():'Awaiting connection')+'</span></div></section>'+
      '<div class="cb-controls"><button type="button" class="cb-refresh" data-claude-action="refresh" '+(!bot||phase==='loading'?'disabled':'')+'>'+(phase==='loading'?'◌  Analyzing…':'↻  Refresh signal')+'</button><a href="/bots" class="cb-secondary">Open strategy settings ↗</a></div>'+
      '<div class="cb-status"><div><strong>'+(phase==='complete'?'Analysis reviewed':phase==='loading'?'Analysis in progress':'Eight-stage technical review')+'</strong><span>'+completed+' of 8 checked'+(phase==='complete'?' · '+availability()+' available':'')+'</span></div><div class="cb-progress" role="progressbar" aria-valuemin="0" aria-valuemax="8" aria-valuenow="'+completed+'" aria-label="Analysis checks reviewed"><span style="width:'+(completed/8*100)+'%"></span></div></div>'+
      (error?'<div class="cb-error" role="alert">'+safe(error)+'</div>':'')+
      '<div class="cb-grid" aria-label="Eight technical-analysis checks">'+steps+'</div></section>'+
      '<aside class="cb-aside"><section class="cb-panel"><div class="cb-panel-heading"><h2>Broker market chart</h2><span>'+safe(preview?.timeframe||'—')+'</span></div><div class="cb-chart" data-claude-chart>'+(preview?.candles?.length?'Loading verified candles…':'<div class="cb-chart-empty">Broker candlesticks appear here after an analysis request.<span>No fabricated market chart.</span></div>')+'</div><div class="cb-caption">Read-only broker candles · '+safe(bot?.symbol||'—')+'</div></section>'+
      '<section class="cb-panel"><div class="cb-panel-heading"><h2>Market reading</h2><span>'+safe(phase==='complete'&&fresh()?'CURRENT':'NOT VERIFIED')+'</span></div><dl class="cb-readings"><div><dt>Bid</dt><dd>'+formatPrice(preview?.quote?.bid)+'</dd></div><div><dt>Ask</dt><dd>'+formatPrice(preview?.quote?.ask)+'</dd></div><div><dt>Quote updated</dt><dd>'+safe(quoteTime)+'</dd></div><div><dt>Strategy candle</dt><dd>'+safe(lastTime)+'</dd></div><div><dt>Source</dt><dd>'+safe(preview?source():'—')+'</dd></div><div><dt>Data state</dt><dd>'+safe(phase==='complete'?(fresh()?'Fresh at review':'Stale / unknown'):'Awaiting request')+'</dd></div></dl></section>'+
      '<section class="cb-panel cb-explain"><h2>Decision context</h2><p>'+safe(decisionNote)+'</p>'+(preview?.riskMessage?'<p class="cb-risk">'+safe(preview.riskMessage)+'</p>':'')+'<p class="cb-disclaimer">No order is sent by ClaudeBot. Signals are not guarantees. Broker-executed trades remain under existing EliteTrade risk controls.</p></section></aside></div>';
  };
  async function mountChart() {
    const element=host?.querySelector('[data-claude-chart]');
    if(!element||!Array.isArray(preview?.candles)||!preview.candles.length)return;
    try {
      const {drawMarketChart}=await import('./market-chart.js');
      if(element.isConnected)drawMarketChart(element,preview.candles,{symbol:currentBot()?.symbol||'',timeframe:preview.timeframe||''});
    } catch {if(element.isConnected)element.textContent='Chart could not be drawn. Broker readings remain available.';}
  }
  function update() {
    if(!host||!host.isConnected)return;
    host.innerHTML=renderContent();
    void mountChart();
  }
  async function runAnalysis() {
    const bot=currentBot();if(!bot||phase==='loading')return;
    const serial=++generation;
    error='';preview=null;checks=[];completed=0;phase='loading';update();
    try {
      if(!navigator.onLine)throw new Error('You are offline. Reconnect to request broker data.');
      if(!state.user?.active&&state.user?.role!=='admin')throw new Error('Activate your subscription before requesting an MT5 strategy preview.');
      const data=await api('/bots/'+encodeURIComponent(bot.id)+'/preview','POST');
      if(serial!==generation||!host?.isConnected)return;
      if(!isFreshBrokerQuote(data))throw new Error('The broker quote is stale or missing. No actionable trading direction will be shown.');
      const readings=evaluateClaudeChecks(data);
      preview=data;
      for(let i=0;i<readings.length;i++){
        if(serial!==generation||!host?.isConnected)return;
        checks.push(readings[i]);completed=i+1;update();
        await new Promise(resolve=>setTimeout(resolve,95));
      }
      if(serial!==generation||!host?.isConnected)return;
      phase='complete';update();
    } catch(e) {
      if(serial!==generation)return;
      phase='error';error=e?.message||'Analysis could not be completed.';preview=null;checks=[];completed=0;update();
    }
  }
  async function page() {
    const [a,b]=await Promise.all([api('/accounts'),api('/bots')]);
    accounts=Array.isArray(a.accounts)?a.accounts:[];
    bots=Array.isArray(b.bots)?b.bots:[];
    if(!bots.some(bot=>bot.id===selected)){selected=bots[0]?.id||'';preview=null;checks=[];completed=0;phase='idle';error='';}
    return '<div id="claudebot" class="claudebot">'+renderContent()+'</div>';
  }
  function mount() {
    host=document.getElementById('claudebot');if(!host)return;
    controller=new AbortController();
    host.addEventListener('click',event=>{
      if(event.target.closest('[data-claude-action="refresh"]'))void runAnalysis();
    },{signal:controller.signal});
    host.addEventListener('change',event=>{
      if(event.target.id!=='cb-select')return;
      generation++;selected=event.target.value;preview=null;checks=[];completed=0;phase='idle';error='';update();
    },{signal:controller.signal});
    void mountChart();
  }
  function dispose() {
    generation++;
    controller?.abort();controller=null;host=null;
  }
  return {page,mount,dispose};
}
