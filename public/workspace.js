// Presentation only: financial values come from the existing account API.
export function createWorkspace({state,api,esc,money,date,icon,btn,badge,heading,empty,stat,table}) {
  const save = () => { try { sessionStorage.setItem(`elite-workspace:${state.user.id}`,JSON.stringify(state.workspace)); } catch {} };
  const prefs = () => {
    if (state.workspace?.owner !== state.user.id) {
      let stored = {}; try { stored = JSON.parse(sessionStorage.getItem(`elite-workspace:${state.user.id}`) || '{}'); } catch {}
      state.workspace = {account:'',range:'30',activity:'all',...stored,owner:state.user.id};
      state.quotes = {};
    }
    return state.workspace;
  };
  const load = async ({snapshot=false} = {}) => {
    prefs();
    const [accounts,bots] = await Promise.all([api('/accounts','GET',undefined,{snapshot}),api('/bots','GET',undefined,{snapshot})]);
    state.data.accounts = accounts.accounts; state.data.bots = bots.bots;
    if (typeof bots.engineReady === 'boolean') state.config.tradingEnabled = bots.engineReady;
    const p = prefs();
    if (!accounts.accounts.some(a => a.id === p.account)) { p.account = accounts.accounts[0]?.id || ''; save(); }
    return {account:accounts.accounts.find(a => a.id === p.account),accounts:accounts.accounts,bots:bots.bots.filter(b => b.account_id === p.account)};
  };
  const type = a => a?.snapshot?.accountType === 'real' ? 'Live account' : a?.snapshot?.accountType === 'demo' ? 'Demo account' : 'Account type unverified';
  const stale = a => state.showingSnapshot || !navigator.onLine || a?.status !== 'connected' || !a?.snapshot?.updatedAt || Date.now()-new Date(a.snapshot.updatedAt).getTime()>60000;
  const metric = (a,key) => Number.isFinite(a?.snapshot?.[key]) ? money(a.snapshot[key]*100,a.snapshot.currency) : '—';
  const accountBar = ({account,accounts}) => `<section class="account-strip" aria-label="Selected trading account"><div class="account-picker"><label for="workspace-account">Trading account</label><select id="workspace-account">${accounts.length ? accounts.map(a => `<option value="${esc(a.id)}" ${a.id===prefs().account?'selected':''}>${esc(a.broker)} · ${esc(a.login)}</option>`).join('') : '<option value="">No account connected</option>'}</select></div><div class="account-strip-state">${badge(!navigator.onLine ? 'offline' : account?.status || 'disconnected')}<span class="account-kind">${type(account)}</span><small>${account?.snapshot ? `${stale(account)?'Stale · ':''}Updated ${date(account.snapshot.updatedAt)}` : 'Account data unavailable'}</small></div><a class="button-link" href="/mt5">Manage accounts</a></section>`;
  const section = (title,body,action='') => `<section class="card workspace-section"><div class="section-heading"><h2>${title}</h2>${action}</div>${body}</section>`;
  const positions = account => {
    const list=account?.snapshot?.positions;
    if (!Array.isArray(list)) return empty('Positions unavailable','Broker positions could not be retrieved. Check your MT5 terminal.',btn('Refresh','refresh','','class="ghost"'));
    if (!list.length) return empty('No open positions','The broker reports no open positions for this account.');
    return table(['Symbol / ticket','Side','Volume','Open price','Profit / loss'],list.map(p=>`<tr><td><strong>${esc(p.symbol)}</strong><br><small class="mono">${esc(p.id)}</small></td><td>${esc(p.type==='POSITION_TYPE_BUY'?'Buy':p.type==='POSITION_TYPE_SELL'?'Sell':p.type)}</td><td class="numeric">${esc(p.volume)}</td><td class="numeric">${esc(p.openPrice ?? '—')}</td><td class="numeric ${p.profit>0?'positive':p.profit<0?'negative':''}">${Number.isFinite(p.profit)?money(p.profit*100,account.snapshot.currency):'—'}</td></tr>`))+'<p class="meta">Manage or close positions in MT5. Position closing is not available in this workspace.</p>';
  };
  const botSummary = ({bots,account}) => bots.length ? bots.map(b=>`<div class="summary-row"><span class="broker-icon">${icon('bots')}</span><div class="summary-copy"><strong>${esc(b.name)}</strong><small>${esc(b.symbol)} · ${esc(b.risk_percent)}% risk per trade</small><p class="meta">${esc(b.engineMessage || (b.status==='stopped'?'New entries paused.':b.status==='running'?'Monitoring with the saved settings.':'Check the terminal before retrying.'))}</p></div>${badge(stale(account)&&b.status==='running'?'unknown':b.status==='stopped'?'paused':b.status)}</div>`).join('') : empty('No bot linked','Configure a bot and select this account.', '<a href="/bots" class="button-link">Configure bot</a>');
  const events = bots => bots.filter(b=>b.engineUpdatedAt).map(b=>({name:b.name,message:b.engineMessage,status:b.status,time:b.engineUpdatedAt})).sort((a,b)=>new Date(b.time)-new Date(a.time));
  const activityList = bots => {
    const list = events(bots).filter(e=>prefs().activity==='all'||(prefs().activity==='attention'&&['unknown','error','disconnected'].includes(e.status)));
    return list.length ? `<ol class="activity-list">${list.map(e=>`<li><span class="section-icon">${icon('bots')}</span><div><strong>${esc(e.name)}</strong><p>${esc(e.message)}</p><small>${date(e.time)}</small></div>${badge(e.status)}</li>`).join('')}</ol>` : empty('No recorded activity','Worker updates will appear when your bot reports activity. Trade history is not provided by the current integration.');
  };
  const alerts = ({account,bots}) => {
    const items=[];
    if (!state.user.active) items.push(['Activate account access','Complete your subscription review to connect accounts and configure trading.','/subscription','View subscription']);
    if (!account) items.push(['Connect an MT5 account','Add your broker credentials to begin the connection review.','/mt5','Connect account']);
    else if (stale(account)) items.push(['Connection needs attention',account.note || 'Confirm the broker connection before starting a bot.','/mt5','Review connection']);
    if (!state.config.gatewayConfigured) items.push(['MT5 service unavailable','Your administrator must configure the connection provider.','/support','Contact support']);
    if (state.config.tradingEnabled===false) items.push(['Bot execution unavailable','The demo worker is offline or execution is disabled.','/bots','Review bot controls']);
    bots.filter(b=>['unknown','error'].includes(b.status)).forEach(b=>items.push([`${b.name} needs attention`,b.engineMessage || 'The last command could not be confirmed. Check MT5 before retrying.','/bots','Review bot']));
    return items.length ? `<div class="issue-list">${items.map(([title,detail,href,label])=>`<div class="issue"><span class="section-icon">${icon('shield')}</span><div><strong>${esc(title)}</strong><p class="meta">${esc(detail)}</p><a href="${href}" class="button-link">${label}</a></div></div>`).join('')}</div>` : empty('No account issues reported','Continue monitoring your broker account and bot status.');
  };
  const performance = account => {
    const range=prefs().range, cutoff=Date.now()-Number(range)*86400000;
    const points=(account?.snapshot?.history || []).filter(p=>p.time>=cutoff).sort((a,b)=>a.time-b.time);
    let chart=empty('Performance history unavailable','The connection does not supply equity history for this period. No performance is estimated.');
    if(points.length>=2) {
      const values=points.map(p=>p.value),min=Math.min(...values),max=Math.max(...values),delta=max-min||1;
      const start=Math.min(...points.map(p=>p.time)),duration=Math.max(...points.map(p=>p.time))-start||1;
      const path=points.map(p=>`${28+(p.time-start)/duration*644},${180-(p.value-min)/delta*144}`).join(' ');
      chart=`<div class="performance-key"><span>Broker equity history</span><strong>${money(points.at(-1).value*100,account.snapshot.currency)}</strong></div><svg class="performance-chart" viewBox="0 0 700 210" role="img" aria-label="Broker equity history"><path class="chart-grid" d="M28 36H672M28 108H672M28 180H672"/><polyline class="chart-line" points="${path}"/></svg><div class="chart-dates"><small>${date(start)}</small><small>${date(points.at(-1).time)}</small></div>`;
    }
    return section('Performance',chart,`<div class="segmented" role="group" aria-label="Performance period">${['7','30','90'].map(r=>btn(`${r}D`,'performance-range',r,`aria-pressed="${r===range}"`)).join('')}</div>`);
  };
  const home = async (options) => {
    const data=await load(options),{account}=data;
    return heading('Overview','Your account, automation, and next steps.', '<a href="/bots" class="button-link">Manage bots</a>')+accountBar(data)+`<div class="stats financial-stats">${stat('Balance',metric(account,'balance'),stale(account)?'Unavailable or stale':'Broker reported','wallet')}${stat('Equity',metric(account,'equity'),Number.isFinite(account?.snapshot?.equity)?'Broker reported':'Account data unavailable','pool')}${stat('Open profit / loss',metric(account,'profit'),Number.isFinite(account?.snapshot?.profit)?'Current open positions':'Account data unavailable','terminal')}${stat('Drawdown','—','Peak equity history required','shield')}</div><div class="overview-grid"><div class="overview-main">${performance(account)}${section('Open positions',positions(account),'<a href="/positions" class="button-link">View positions</a>')}${section('Recent activity',activityList(data.bots),'<a href="/activity" class="button-link">View activity</a>')}</div><aside class="overview-aside">${section('EliteBot',botSummary(data),'<a href="/bots" class="button-link">Controls</a>')}${section('Needs attention',alerts(data),'<a href="/notifications" class="icon-link" aria-label="View account alerts">'+icon('shield')+'</a>')}</aside></div>`;
  };
  const markets = async (options) => {
    const data=await load(options);
    const rows=data.bots.map(b=>{
      const q=state.quotes?.[b.id],fresh=q&&!q.error&&!state.showingSnapshot&&navigator.onLine&&Date.now()-new Date(q.updatedAt).getTime()<60000;
      return `<article class="card market-card"><div class="card-head"><div><h2>${esc(b.symbol)}</h2><small>${esc(b.strategy)} · ${esc(b.name)}</small></div>${badge(fresh?'updated':q?'stale':'unavailable')}</div><div class="quote-grid"><div><small>Bid</small><strong class="numeric">${Number.isFinite(q?.quote?.bid)?esc(q.quote.bid):'—'}</strong></div><div><small>Ask</small><strong class="numeric">${Number.isFinite(q?.quote?.ask)?esc(q.quote.ask):'—'}</strong></div></div><p class="meta">${q?`Updated ${date(q.updatedAt)}${fresh?'':' · Stale data'}`:'Request a broker quote and strategy preview.'}</p><div class="actions">${btn('Refresh quote','market-refresh',b.id,`class="primary" ${stale(data.account)||!state.user.active?'disabled':''}`)}${btn('Preview strategy','bot-preview',b.id)}</div>${q?.error?`<p class="error" role="alert">${esc(q.error)}</p>`:''}</article>`;
    });
    return heading('Markets','Broker symbols from your configured strategies.')+accountBar(data)+(rows.length?`<div class="grid">${rows.join('')}</div>`:section('Your markets',empty('No symbols configured','Choose a broker symbol in your bot configuration.','<a href="/bots" class="button-link">Configure bot</a>')))+'<p class="meta section-note">Quotes update on request and become stale after one minute. Previewing a strategy does not place a trade.</p>';
  };
  const activity = async (options) => {const data=await load(options);return heading('Activity','Worker updates for the selected account.')+accountBar(data)+section('Bot activity',activityList(data.bots),`<div class="segmented">${btn('All','activity-filter','all',`aria-pressed="${prefs().activity==='all'}"`)}${btn('Needs attention','activity-filter','attention',`aria-pressed="${prefs().activity==='attention'}"`)}</div>`)+section('Trade history',empty('Trade history unavailable','Completed trades are not supplied by the current connection. View your account history in MT5.'));};
  const accountPage = async () => heading('Account','Connections, preferences, and account access.')+`<section class="card account-profile"><span class="avatar">${esc((state.user.name || 'E').slice(0,1).toUpperCase())}</span><div><h2>${esc(state.user.name)}</h2><p class="meta">${esc(state.user.email)}</p></div>${badge(state.user.active?'active':'inactive')}</section><div class="grid account-hub">${[['/mt5','terminal','MT5 accounts','Connect and manage your broker accounts.'],['/settings','settings','Profile and settings','Personal details, password, and security.'],['/notifications','shield','Notifications','Account issues and worker updates.'],['/subscription','wallet','Subscription','Membership and payment history.'],['/pool','pool','Live pool','Rounds and your contributions.'],['/referrals','referrals','Referrals','Invitations, commissions, and payouts.'],['/support','support','Support','Get help with your account.']].map(([href,i,title,detail])=>`<a class="card hub-link" href="${href}"><span class="section-icon">${icon(i)}</span><div><strong>${title}</strong><p class="meta">${detail}</p></div>${icon('arrow')}</a>`).join('')}</div><div class="actions">${btn('Sign out','logout','','class="danger"')}</div>`;
  return {home,markets,activity,accountPage,accountBar,accountContext:accounts=>{const p=prefs();if(!accounts.some(a=>a.id===p.account)){p.account=accounts[0]?.id || '';save();}return {accounts,account:accounts.find(a=>a.id===p.account)};},positionsPage:async(options)=>{const data=await load(options);return heading('Positions','Broker exposure for the selected account.')+accountBar(data)+section('Open positions',positions(data.account));},notifications:async(options)=>{const data=await load(options);return heading('Notifications','Actionable account issues and the latest worker reports.')+accountBar(data)+section('Needs attention',alerts(data))+section('Latest worker reports',activityList(data.bots));},selectAccount:async id=>{prefs().account=id;save();},setRange:r=>{if(['7','30','90'].includes(r)){prefs().range=r;save();}},setActivity:f=>{prefs().activity=f;save();},prefs,stale,type};
}
