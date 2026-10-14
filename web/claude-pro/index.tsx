import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ArrowDownRight, ArrowUpRight, Bot as BotIcon, Check, ChevronDown, ChevronRight, Clock3, Crown, ExternalLink, Gem, Globe2, LoaderCircle, MoreHorizontal, Pause, Play, RotateCcw, Search, ShieldCheck, Sparkles, Sun, UserRound, X, Zap } from 'lucide-react';
import { ASSETS, DEFAULTS, DURATIONS, PRESETS, brokerSignal, countdown, cycleDelay, demoSignal, durationLabel, durationWords, formatCountdown, readingTitles, restorePreferences, type Account, type Api, type Bot, type Host, type Preferences, type Preset, type Preview, type Reading, type SignalResult } from './model';

type Flow = { stage: 'config' } | { stage: 'analyzing'; completed: number; startedAt: number } | { stage: 'result'; signal: SignalResult } | { stage: 'error'; message: string };
type SheetName = 'assets' | 'broker' | 'help' | 'language' | 'worker' | null;
const PREF_KEY = 'elite-claude-pro-preferences';
const loadPreferences = () => { try { return restorePreferences(localStorage.getItem(PREF_KEY)); } catch { return { ...DEFAULTS }; } };

function CurrencyFlag({ code }: { code: string }) {
  const clip = useId();
  const flag = code === 'EUR' ? <><rect width="24" height="24" fill="#2057ae" />{Array.from({ length: 12 }, (_, index) => <circle key={index} cx={12 + Math.cos(index * Math.PI / 6) * 6} cy={12 + Math.sin(index * Math.PI / 6) * 6} r=".8" fill="#f6d055" />)}</> : code === 'USD' ? <><rect width="24" height="24" fill="#fff" />{Array.from({ length: 7 }, (_, index) => <rect key={index} x="0" y={index * 3.6} width="24" height="1.8" fill="#c84a56" />)}<rect width="12" height="13" fill="#263a71" />{[3, 6, 9].flatMap(y => [3, 6, 9].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r=".6" fill="#fff" />))}</> : code === 'GBP' ? <><rect width="24" height="24" fill="#253971" /><path d="M0 0L24 24M24 0L0 24" stroke="#fff" strokeWidth="5" /><path d="M0 0L24 24M24 0L0 24" stroke="#d64754" strokeWidth="1.7" /><path d="M12 0V24M0 12H24" stroke="#fff" strokeWidth="7" /><path d="M12 0V24M0 12H24" stroke="#d64754" strokeWidth="3.4" /></> : code === 'AUD' || code === 'NZD' ? <><rect width="24" height="24" fill="#253971" /><g transform="scale(.5)"><rect width="24" height="24" fill="#253971" /><path d="M0 0L24 24M24 0L0 24" stroke="#fff" strokeWidth="5" /><path d="M12 0V24M0 12H24" stroke="#fff" strokeWidth="7" /><path d="M12 0V24M0 12H24" stroke="#d64754" strokeWidth="3.4" /></g>{[[17,5],[21,12],[16,20],[13,13]].map(([x,y],index)=><path key={index} d={`M${x} ${y-1.5}l.5 1h1l-.8.7.3 1.1-1-.6-1 .6.3-1.1-.8-.7h1Z`} fill={code === 'NZD' ? '#d64754' : '#fff'} stroke={code === 'NZD' ? '#fff' : 'none'} strokeWidth=".3" />)}{code === 'AUD' && <circle cx="6" cy="18" r="1.5" fill="#fff" />}</> : code === 'JPY' ? <><rect width="24" height="24" fill="#fff" /><circle cx="12" cy="12" r="5.5" fill="#c93846" /></> : code === 'CHF' ? <><rect width="24" height="24" fill="#d93d45" /><path d="M12 5V19M5 12H19" stroke="#fff" strokeWidth="4" /></> : code === 'CAD' ? <><rect width="24" height="24" fill="#fff" /><rect width="5" height="24" fill="#d64754" /><rect x="19" width="5" height="24" fill="#d64754" /><path d="M12 5L10 10L7 8L8 14L11 15V19H13V15L16 14L17 8L14 10Z" fill="#d64754" /></> : null;
  if (!flag) return <>{code.slice(0, 1)}</>;
  return <svg viewBox="0 0 24 24"><defs><clipPath id={clip}><circle cx="12" cy="12" r="12" /></clipPath></defs><g clipPath={`url(#${clip})`}>{flag}</g></svg>;
}
function CurrencyBadges({ asset }: { asset: string }) {
  const normalized = asset.replace(' OTC', ''), currencies = normalized.includes('/') ? normalized.split('/') : /^[A-Z]{6}$/.test(normalized) ? [normalized.slice(0, 3), normalized.slice(3)] : [normalized];
  return <span className="cp-currencies" aria-hidden="true">{currencies.map((code, index) => <span key={index}><CurrencyFlag code={code} /></span>)}</span>;
}
function Strength() { return <span className="cp-strength" aria-hidden="true">{[5, 8, 11, 14, 17].map(height => <i key={height} style={{ height }} />)}</span>; }
function Sparkline({ up }: { up: boolean }) {
  return <svg className="cp-sparkline" viewBox="0 0 110 65" aria-hidden="true"><path d={up ? 'M3 54L18 42L31 46L42 26L56 31L70 14L84 20L105 5' : 'M3 6L18 18L31 14L42 34L56 29L70 47L84 41L105 60'} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}
function Sheet({ title, children, close }: { title: string; children: ReactNode; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close); closeRef.current = close;
  useEffect(() => {
    const element = ref.current!, previous = document.activeElement as HTMLElement | null;
    element.showModal();
    const onCancel = (event: Event) => { event.preventDefault(); closeRef.current(); };
    element.addEventListener('cancel', onCancel);
    return () => { element.removeEventListener('cancel', onCancel); element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="cp-sheet" aria-label={title} onClick={event => { if (event.target === ref.current) close(); }}><div className="cp-sheet-inner"><div className="cp-sheet-handle" /><header className="cp:flex cp:items-center cp:justify-between cp:gap-3"><h2>{title}</h2><button className="cp-icon-button" aria-label="Close sheet" onClick={close}><X size={20} /></button></header>{children}</div></dialog>;
}
function ReadingGrid({ prefs, readings, completed, analyzing }: { prefs: Preferences; readings?: Reading[]; completed: number; analyzing: boolean }) {
  const available = readings?.filter(r => r.available).length || 0;
  return <section className="cp-readings"><div className="cp-section-heading"><h2>Readings <span>· {prefs.mode === 'demo' ? 'demo data' : 'MT5 broker data'}</span></h2><span className={analyzing ? '' : 'cp-status-normal'}>{analyzing ? `${completed} of 8` : `${available} of 8 available`}</span></div><div className="cp:grid cp:grid-cols-2 cp:gap-2.5">{readingTitles(prefs).map((title, index) => {
    const item = readings?.[index], active = analyzing && completed === index, done = !analyzing || index < completed;
    return <article key={index} className={`cp-reading ${active ? 'is-evaluating' : ''}`} data-reading={index} data-status={active ? 'evaluating' : done ? item?.available === false ? 'unavailable' : 'complete' : 'pending'}><div className="cp:flex cp:items-center cp:justify-between cp:gap-2"><h3>{item?.title || title}</h3><span className="cp-reading-state" aria-hidden="true">{active ? <span className="cp-dots">•••</span> : done ? item?.available === false ? '—' : <Check size={14} /> : '·'}</span></div><p className={done && item?.tone ? `cp-${item.tone}` : ''}>{analyzing ? active ? 'Checking…' : done ? 'Reading reviewed' : 'Waiting' : item?.detail || 'Unavailable'}</p></article>;
  })}</div></section>;
}

function ClaudeProBot({ host }: { host: Host }) {
  const [prefs, setPrefs] = useState<Preferences>(loadPreferences);
  const [flow, setFlow] = useState<Flow>({ stage: 'config' });
  const [tab, setTab] = useState<'today' | 'signal' | 'profile'>('signal');
  const [sheet, setSheet] = useState<SheetName>(null);
  const [query, setQuery] = useState('');
  const [bots, setBots] = useState<Bot[]>([]), [accounts, setAccounts] = useState<Account[]>([]);
  const [engineReady, setEngineReady] = useState(false), [connectionError, setConnectionError] = useState('');
  const [history, setHistory] = useState<SignalResult[]>([]);
  const [auto, setAuto] = useState(false), [nextRunAt, setNextRunAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now()), [notice, setNotice] = useState('');
  const [workerBusy, setWorkerBusy] = useState(false), [workerError, setWorkerError] = useState('');
  const generation = useRef(0), sequence = useRef(0), autoRef = useRef(false), busyRef = useRef(false), mounted = useRef(true);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const activeBot = bots.find(bot => bot.id === prefs.botId), activeAccount = accounts.find(account => account.id === activeBot?.account_id);
  const signal = flow.stage === 'result' ? flow.signal : null;
  const remaining = signal ? countdown(signal.expiresAt, now) : 0;
  const workerRunning = activeBot?.status === 'running';
  const canControlWorker = host.config.connectionMode === 'account-data' && (host.user.active || host.user.role === 'admin');
  const preset = PRESETS[prefs.preset];

  const later = useCallback((callback: () => void, delay: number) => {
    const timer = setTimeout(() => { timers.current.delete(timer); callback(); }, delay);
    timers.current.add(timer); return timer;
  }, []);
  const stop = useCallback((message = '') => {
    generation.current++; autoRef.current = false; busyRef.current = false;
    for (const timer of timers.current) clearTimeout(timer); timers.current.clear();
    if (mounted.current) { setAuto(false); setNextRunAt(null); setNotice(message); setFlow(current => current.stage === 'analyzing' ? { stage: 'config' } : current); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current++; autoRef.current = false; for (const timer of timers.current) clearTimeout(timer); timers.current.clear(); };
  }, []);
  useEffect(() => { try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch {} }, [prefs]);
  useEffect(() => {
    if (flow.stage !== 'result' && !auto) return;
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [flow.stage, auto]);
  useEffect(() => {
    const pause = () => { if (document.hidden && (autoRef.current || busyRef.current)) stop('Analysis paused while the app is in the background.'); };
    const offline = () => { if (autoRef.current || busyRef.current) stop('Analysis paused. Reconnect and start again.'); };
    const nativePause = () => stop('Analysis paused while the app is in the background.');
    document.addEventListener('visibilitychange', pause); window.addEventListener('offline', offline); window.addEventListener('claude-pro-paused', nativePause);
    return () => { document.removeEventListener('visibilitychange', pause); window.removeEventListener('offline', offline); window.removeEventListener('claude-pro-paused', nativePause); };
  }, [stop]);
  useEffect(() => {
    let canceled = false;
    Promise.all([host.api<{ bots: Bot[]; engineReady?: boolean }>('/bots'), host.api<{ accounts: Account[] }>('/accounts')]).then(([b, a]) => {
      if (canceled) return;
      setBots(Array.isArray(b.bots) ? b.bots : []); setAccounts(Array.isArray(a.accounts) ? a.accounts : []); setEngineReady(b.engineReady === true);
      if (b.bots?.length) setPrefs(previous => ({ ...previous, botId: b.bots.some(bot => bot.id === previous.botId) ? previous.botId : b.bots[0].id }));
    }).catch(error => { if (!canceled) setConnectionError(error.message || 'MT5 connections could not be loaded.'); });
    return () => { canceled = true; };
  }, [host]);

  const configure = (changes: Partial<Preferences>) => { stop(); setFlow({ stage: 'config' }); setPrefs(previous => ({ ...previous, ...changes })); };
  const run = async (selected = prefs) => {
    if (busyRef.current || document.hidden || !mounted.current) return;
    busyRef.current = true; const serial = ++generation.current;
    window.scrollTo({ top: 0, behavior: 'instant' });
    setTab('signal'); setNotice(''); setNextRunAt(null); setFlow({ stage: 'analyzing', completed: 0, startedAt: Date.now() });
    const current = () => mounted.current && generation.current === serial;
    try {
      if (!navigator.onLine) throw new Error('You are offline. Reconnect before running analysis.');
      let result: SignalResult;
      if (selected.mode === 'demo') result = demoSignal(selected, sequence.current++);
      else {
        const bot = bots.find(item => item.id === selected.botId);
        if (!bot) throw new Error('Choose a configured MT5 strategy first.');
        if (!host.user.active && host.user.role !== 'admin') throw new Error('Activate your EliteTrade subscription to read MT5 strategies.');
        const timeout = new Promise<never>((_, reject) => later(() => reject(new Error('Broker request timed out. Try again.')), 30_000));
        const preview = await Promise.race([host.api<Preview>(`/bots/${encodeURIComponent(bot.id)}/preview`, 'POST'), timeout]);
        if (!current()) return;
        result = brokerSignal(selected, bot, preview);
      }
      if (!current()) return;
      // Only verified / explicitly simulated readings enter the visual sequence.
      for (let index = 1; index <= 8; index++) {
        await new Promise<void>(resolve => later(resolve, 450));
        if (!current()) return;
        setFlow({ stage: 'analyzing', completed: index, startedAt: result.generatedAt });
      }
      if (!current()) return;
      const finished = Date.now();
      // Demo expiry begins after the analysis. Broker expiry is bounded by quote freshness.
      if (result.mode === 'demo') result = { ...result, generatedAt: finished, expiresAt: finished + 20_000 };
      setNow(finished); setFlow({ stage: 'result', signal: result }); setHistory(previous => [result, ...previous].slice(0, 30)); busyRef.current = false;
      if (autoRef.current) { const delay = cycleDelay(selected.mode); setNextRunAt(finished + delay); later(() => { if (autoRef.current && current()) void run(selected); }, delay); }
    } catch (error) {
      if (!current()) return;
      autoRef.current = false; busyRef.current = false; setAuto(false); setNextRunAt(null);
      setFlow({ stage: 'error', message: error instanceof Error ? error.message : 'Analysis could not be completed.' });
    }
  };
  const startAuto = () => { if (busyRef.current) return; autoRef.current = true; setAuto(true); void run(); };
  const changeTab = (next: typeof tab) => { if (next !== 'signal') stop('Automatic analysis stopped when you left Signal.'); setTab(next); };
  const controlWorker = async () => {
    if (!activeBot || workerBusy || !canControlWorker) return;
    setWorkerBusy(true); setWorkerError('');
    try {
      // The backend validates ownership, subscription, demo account type, risk and worker health.
      await host.api(`/bots/${encodeURIComponent(activeBot.id)}/control`, 'POST', { running: !workerRunning });
      if (!mounted.current) return;
      const data = await host.api<{ bots: Bot[]; engineReady?: boolean }>('/bots');
      if (!mounted.current) return;
      setBots(data.bots || []); setEngineReady(data.engineReady === true);
      setNotice(workerRunning ? 'Worker stop acknowledged by the server.' : 'Demo automation request acknowledged. Status comes from the server.'); setSheet(null);
    } catch (error) { if (mounted.current) setWorkerError(error instanceof Error ? error.message : 'Worker control failed.'); }
    finally { if (mounted.current) setWorkerBusy(false); }
  };
  const selectAsset = (asset: string) => { const isStock = !asset.endsWith(' OTC'); configure({ asset, market: isStock ? 'Stock' : 'OTC' }); setSheet(null); setQuery(''); };
  const instrument = prefs.mode === 'demo' ? prefs.asset : activeBot?.symbol || 'Choose an MT5 strategy';
  const top = prefs.mode === 'demo' ? ASSETS.slice(2, 5).map(row => row[0]) : bots.slice(0, 3).map(bot => bot.symbol);
  const pairSummary = <button className="cp-pair-summary" disabled={flow.stage === 'analyzing' || auto} onClick={() => { if (prefs.mode === 'demo') setSheet('assets'); else configure({}); }}><CurrencyBadges asset={instrument} /><span><strong>{instrument}</strong><small>{prefs.mode === 'demo' ? `${prefs.market} · ${durationLabel(prefs.duration)} · ${preset.name}` : `MT5 · ${signal?.timeframe || activeBot?.strategy || 'Configured strategy'}`}</small></span><ChevronDown size={18} /></button>;

  return <div className="cp-app" data-mode={prefs.mode} data-stage={flow.stage}>
    <div className="cp-brand-row"><span><BotIcon size={15} /> CLAUDE PRO BOT</span><button className="cp-icon-button" onClick={() => setSheet('help')} aria-label="Claude Pro Bot options"><MoreHorizontal size={20} /></button></div>
    <div className="cp-title-row"><h1>{tab === 'signal' ? 'Signal' : tab === 'today' ? 'Today' : 'Profile'}</h1><button className="cp-language" onClick={() => setSheet('language')}><Globe2 size={14} /> English <ChevronDown size={12} /></button></div>
    <div className={`cp-source-badge ${prefs.mode === 'mt5' ? 'is-mt5' : ''}`}><span />{prefs.mode === 'demo' ? 'Demo data · no broker orders' : 'MT5 broker data · strategy preview'}</div>
    {tab === 'signal' && <>
      {flow.stage === 'config' && <>
        <section className="cp-top-assets"><div className="cp-section-heading"><h2>{prefs.mode === 'demo' ? 'Top today' : 'Your strategies'}</h2><button onClick={() => prefs.mode === 'demo' ? setSheet('assets') : document.getElementById('cp-strategy')?.focus()}>{prefs.mode === 'demo' ? 'All 16' : `All ${bots.length}`}<ChevronRight size={14} /></button></div><div className="cp-carousel">{top.map((asset, index) => <button className="cp-top-card" key={`${asset}-${index}`} onClick={() => prefs.mode === 'demo' ? selectAsset(asset) : configure({ botId: bots[index].id })}><CurrencyBadges asset={asset} /><strong>{asset.replace(' OTC', '')}</strong><span>{prefs.mode === 'demo' ? <><Strength /><small>high · sample</small></> : <small>{bots[index]?.strategy}</small>}</span></button>)}{!top.length && <p className="cp-empty">Configure a strategy in Trading bots to use MT5.</p>}</div></section>
        <div className="cp-data-toggle" role="group" aria-label="Data source"><button aria-pressed={prefs.mode === 'demo'} className={prefs.mode === 'demo' ? 'is-active' : ''} onClick={() => configure({ mode: 'demo' })}>Demo preview</button><button aria-pressed={prefs.mode === 'mt5'} className={prefs.mode === 'mt5' ? 'is-active' : ''} onClick={() => configure({ mode: 'mt5' })}>My MT5</button></div>
        {prefs.mode === 'demo' ? <button className="cp-asset-selector" onClick={() => setSheet('assets')}><CurrencyBadges asset={prefs.asset} /><span><strong>{prefs.asset}</strong><small>{ASSETS.find(row => row[0] === prefs.asset)?.[1]}</small></span><ChevronDown size={19} /></button> : <section className="cp-card cp-strategy-card"><label htmlFor="cp-strategy">Configured MT5 strategy</label><select id="cp-strategy" value={prefs.botId} onChange={event => configure({ botId: event.target.value })}>{!bots.length && <option value="">No strategies available</option>}{bots.map(bot => <option key={bot.id} value={bot.id}>{bot.symbol} · {bot.name}</option>)}</select><p>{activeAccount ? `${activeAccount.broker} · ${activeAccount.login} · ${activeAccount.status}` : 'Connect a verified MT5 account.'}</p>{connectionError && <p role="alert">{connectionError}</p>}<a href="/mt5">Manage MT5 connection <ExternalLink size={12} /></a></section>}
        <section className="cp-card cp-time-card"><div className="cp-section-heading"><h2>Trade time</h2><div className="cp-segment" role="group" aria-label="Market category">{(['OTC', 'Stock'] as const).map(market => <button key={market} aria-pressed={prefs.market === market} className={prefs.market === market ? 'is-active' : ''} disabled={prefs.mode === 'mt5'} onClick={() => configure({ market, asset: market === 'OTC' ? ASSETS[0][0] : ASSETS[12][0] })}>{market}</button>)}</div></div><div className="cp:grid cp:grid-cols-4 cp:gap-2 cp-time-grid" role="group" aria-label="Trade duration">{DURATIONS.map(duration => <button key={duration} disabled={prefs.mode === 'mt5'} aria-pressed={prefs.duration === duration} className={prefs.duration === duration ? 'is-selected' : ''} onClick={() => configure({ duration })}>{durationLabel(duration)}</button>)}</div>{prefs.mode === 'mt5' && <p className="cp-fine">MT5 uses the saved strategy timeframe and SL/TP. Timed OTC trades are available only in Demo preview.</p>}<div className="cp-model-grid cp:grid cp:grid-cols-3 cp:gap-2" role="group" aria-label="Analysis preset">{(Object.keys(PRESETS) as Preset[]).map(key => { const Icon = key === 'fable' ? Crown : key === 'opus' ? Gem : Sparkles; return <button key={key} aria-pressed={prefs.preset === key} className={prefs.preset === key ? 'is-active' : ''} onClick={() => configure({ preset: key })}><Icon size={17} /><strong>{PRESETS[key].name}</strong><small>{PRESETS[key].subtitle}</small></button>; })}</div><p className="cp-preset-caption">Analysis presets · provider models are not connected</p></section>
        <button className="cp-primary cp-config-action cp:w-full" disabled={prefs.mode === 'mt5' && !activeBot} onClick={() => void run()}><Zap size={18} />Get signal</button>
      </>}
      {flow.stage === 'analyzing' && <>{pairSummary}<section className="cp-analysis-hero cp-card"><div className="cp-progress-orbit"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="43" /><circle cx="50" cy="50" r="43" className="cp-ring-value" style={{ strokeDashoffset: 270.18 * (1 - flow.completed / 8) }} /></svg><Sparkles size={30} /></div><h2>Analyzing…</h2><p><Sparkles size={13} />{['Loading quotes…', 'Checking trend…', 'Checking momentum…', 'Checking RSI…'][Math.min(3, Math.floor(flow.completed / 2))]}</p></section><ReadingGrid prefs={prefs} completed={flow.completed} analyzing /><div className="cp-progress-footer" role="progressbar" aria-label="Analysis readings" aria-valuemin={0} aria-valuemax={8} aria-valuenow={flow.completed}><span style={{ width: `${flow.completed / 8 * 100}%` }} /><strong>{preset.name} is analyzing · {flow.completed} of 8</strong></div><button className="cp-text-button" onClick={() => stop('Analysis canceled.')}>Cancel analysis</button></>}
      {flow.stage === 'result' && signal && <>{pairSummary}<section className={`cp-signal-hero is-${signal.direction}`}><div className="cp-signal-content"><span className="cp-direction-icon">{signal.direction === 'higher' ? <ArrowUpRight size={26} /> : signal.direction === 'lower' ? <ArrowDownRight size={26} /> : <Pause size={23} />}</span><h2>{signal.direction === 'higher' ? 'HIGHER' : signal.direction === 'lower' ? 'LOWER' : 'NO TRADE'}</h2><p><Clock3 size={13} /><span className="cp-entry-window">{signal.direction === 'none' ? 'No qualifying entry' : remaining > 0 ? `Enter within ${formatCountdown(remaining)}` : 'Entry window closed'}</span><span>· {signal.mode === 'demo' ? 'Demo forecast' : 'Strategy preview'}</span></p></div>{signal.direction !== 'none' && <Sparkline up={signal.direction === 'higher'} />}</section><p className="cp-broker-callout">{remaining <= 0 ? 'Generate a new signal to continue.' : signal.direction === 'none' ? 'Wait for a qualifying, risk-checked strategy entry.' : signal.mode === 'demo' ? <>Open <strong className={signal.direction === 'higher' ? 'cp-up' : 'cp-down'}>{signal.direction.toUpperCase()}</strong> for {durationWords(signal.duration)} on PocketOption <span>· demo only</span></> : <>Review <strong className={signal.direction === 'higher' ? 'cp-up' : 'cp-down'}>{signal.direction === 'higher' ? 'BUY' : 'SELL'}</strong> on your MT5 account</>}</p><ReadingGrid prefs={prefs} readings={signal.readings} completed={8} analyzing={false} /><div className="cp-result-actions"><button className="cp-secondary" onClick={() => { stop(); setFlow({ stage: 'config' }); }}><RotateCcw size={17} />New</button><button className="cp-primary" disabled={remaining <= 0 || signal.direction === 'none' || auto} onClick={() => setSheet('broker')}><ExternalLink size={17} />Open</button></div><p className="cp-result-note">{signal.note}</p></>}
      {flow.stage === 'error' && <section className="cp-card cp-error" role="alert"><ShieldCheck size={30} /><h2>Analysis unavailable</h2><p>{flow.message}</p><button className="cp-primary" onClick={() => { stop(); setFlow({ stage: 'config' }); }}>Back to configuration</button></section>}
      <section className="cp-auto-card"><div><strong><Zap size={14} />Automatic analysis</strong><p>{auto ? nextRunAt ? `Next signal in ${Math.max(0, Math.ceil((nextRunAt - now) / 1000))} sec` : 'Analyzing your selected instrument…' : prefs.mode === 'demo' ? 'Repeat demo signals while this page is open.' : 'Refresh your strategy every 60 seconds.'}</p></div><button className={auto ? 'cp-stop' : 'cp-auto-start'} disabled={!auto && (flow.stage === 'analyzing' || prefs.mode === 'mt5' && !activeBot)} onClick={() => auto ? stop('Automatic analysis stopped.') : startAuto()}>{auto ? <><Pause size={14} />Stop</> : <><Play size={14} />Auto run</>}</button></section>
      {prefs.mode === 'mt5' && <section className="cp-card cp-worker"><div className="cp-section-heading"><h2>MT5 demo automation</h2><span className={workerRunning ? 'cp-up' : ''}>{activeBot?.status || 'Not configured'}</span></div><p>{activeBot?.engineMessage || 'The existing server worker runs your saved strategy with its risk controls.'}</p><button className="cp-secondary cp:w-full" disabled={!activeBot || !canControlWorker || workerBusy || !workerRunning && !engineReady} onClick={() => { setWorkerError(''); setSheet('worker'); }}>{workerRunning ? 'Stop MT5 demo bot' : engineReady ? 'Start MT5 demo bot' : 'Demo worker unavailable'}</button><small>Broker execution continues independently of this page. Stopping analysis does not stop the worker. Real-account execution stays disabled.</small><a href="/bots">Strategy and risk settings <ChevronRight size={13} /></a></section>}
      {notice && <p className="cp-notice" role="status">{notice}</p>}
    </>}
    {tab === 'today' && <section className="cp-today"><p className="cp-date">{new Date(now).toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}</p><div className="cp-today-summary cp-card"><Sun size={24} /><div><strong>{history.length}</strong><span>signals reviewed this session</span></div></div><div className="cp-section-heading"><h2>Recent signals</h2><span>Session only</span></div>{!history.length ? <div className="cp-empty cp-card"><Zap size={28} /><h2>Your first reading awaits</h2><p>Configure an instrument on Signal to begin.</p><button className="cp-primary" onClick={() => changeTab('signal')}>Open Signal</button></div> : history.map(item => <article className="cp-history-row cp-card" key={item.id}><CurrencyBadges asset={item.instrument} /><div><strong>{item.instrument}</strong><small>{item.mode === 'demo' ? 'Demo data' : 'MT5 preview'} · {new Date(item.generatedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</small></div><span className={item.direction === 'higher' ? 'cp-up' : item.direction === 'lower' ? 'cp-down' : ''}>{item.direction === 'none' ? 'NO TRADE' : item.direction.toUpperCase()}</span></article>)}</section>}
    {tab === 'profile' && <section className="cp-profile"><div className="cp-profile-identity cp-card"><span><UserRound size={27} /></span><h2>{host.user.name || 'EliteTrade member'}</h2><p>{host.user.email || 'Native EliteTrade account'}</p><small>Connected through your EliteTrade account</small></div><div className="cp-card"><div className="cp-profile-row"><span>Language</span><button onClick={() => setSheet('language')}>English <ChevronRight size={15} /></button></div><div className="cp-profile-row"><span>Data source</span><strong>{prefs.mode === 'demo' ? 'Demo preview' : 'MT5 broker'}</strong></div><div className="cp-profile-row"><span>Model connection</span><strong>Presets only</strong></div><div className="cp-profile-row"><span>Automatic analysis</span><strong>Stopped</strong></div><div className="cp-profile-row"><span>Reduced motion</span><strong>{window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'Enabled' : 'System preference'}</strong></div></div><button className="cp-secondary cp:w-full" onClick={() => setSheet('help')}><ShieldCheck size={17} />About Claude Pro Bot</button><a className="cp-profile-link" href="/settings">EliteTrade account settings <ExternalLink size={14} /></a></section>}
    <nav className="cp-bottom-tabs" aria-label="Claude Pro Bot navigation">{(['today', 'signal', 'profile'] as const).map(name => { const Icon = name === 'today' ? Sun : name === 'signal' ? Zap : UserRound; return <button key={name} className={tab === name ? 'is-active' : ''} aria-current={tab === name ? 'page' : undefined} onClick={() => changeTab(name)}><Icon size={21} /><span>{name[0].toUpperCase() + name.slice(1)}</span></button>; })}</nav>
    <span className="cp-sr-only" role="status">{flow.stage === 'result' ? `Analysis complete. ${flow.signal.direction === 'none' ? 'No trade.' : flow.signal.direction}. ${remaining === 0 ? 'Entry window closed.' : ''}` : ''}</span>
    {sheet === 'assets' && <Sheet title="Choose an asset" close={() => setSheet(null)}><label className="cp-search"><Search size={17} /><input autoFocus placeholder="Search pairs or stocks" aria-label="Search assets" value={query} onChange={event => setQuery(event.target.value)} /></label><p className="cp-fine">16 sample instruments · Demo data</p><div className="cp-asset-list">{ASSETS.filter(row => `${row[0]} ${row[1]}`.toLowerCase().includes(query.toLowerCase())).map(row => <button key={row[0]} onClick={() => selectAsset(row[0])}><CurrencyBadges asset={row[0]} /><span><strong>{row[0]}</strong><small>{row[1]}</small></span>{prefs.asset === row[0] && <Check size={18} />}</button>)}</div>{!ASSETS.some(row => `${row[0]} ${row[1]}`.toLowerCase().includes(query.toLowerCase())) && <p className="cp-empty">No matching assets.</p>}</Sheet>}
    {sheet === 'language' && <Sheet title="Language" close={() => setSheet(null)}><button className="cp-language-option" onClick={() => setSheet(null)}><Globe2 size={18} />English<Check size={18} /></button><p className="cp-fine">Claude Pro Bot follows EliteTrade’s English interface.</p></Sheet>}
    {sheet === 'help' && <Sheet title="About Claude Pro Bot" close={() => setSheet(null)}><div className="cp-help"><p>Automatic analysis repeats readings while Signal is open. It pauses when you switch tabs, leave the page, go offline, or put the app in the background.</p><p>Demo preview uses sample OTC and stock readings. It never connects to PocketOption or places trades.</p><p>My MT5 reads your saved EliteTrade strategy from the broker. The existing MT5 demo worker is controlled separately and enforces the server’s account and risk checks.</p><p>Sonnet 5, Opus 5.5, and Fable 5.1 are display presets. No Anthropic model is connected.</p></div></Sheet>}
    {sheet === 'broker' && signal && <Sheet title={signal.mode === 'demo' ? 'Open PocketOption' : 'Open MT5 workspace'} close={() => setSheet(null)}><div className="cp-broker-details"><CurrencyBadges asset={signal.instrument} /><h3>{signal.instrument}</h3><strong className={signal.direction === 'higher' ? 'cp-up' : 'cp-down'}>{signal.direction === 'higher' ? 'HIGHER' : 'LOWER'}</strong><p>{signal.mode === 'demo' ? durationWords(signal.duration) : 'Saved MT5 strategy'} · {remaining > 0 ? `${formatCountdown(remaining)} remaining` : 'Entry window closed'}</p><p className="cp-fine">{signal.mode === 'demo' ? 'Sample signal. The broker opens separately; no order is placed.' : 'Opening your workspace does not place an order.'}</p><button className="cp-primary cp:w-full" disabled={remaining <= 0} onClick={() => { if (Date.now() >= signal.expiresAt) { setNow(Date.now()); return; } if (signal.mode === 'mt5') window.location.assign('/trade'); else { if (window.ClaudeProNative) window.ClaudeProNative.openBroker(); else window.open('https://pocketoption.com/en/', '_blank', 'noopener,noreferrer'); setSheet(null); } }}>Continue to {signal.mode === 'demo' ? 'broker' : 'workspace'}<ExternalLink size={16} /></button><button className="cp-text-button" onClick={() => setSheet(null)}>Cancel</button></div></Sheet>}
    {sheet === 'worker' && activeBot && <Sheet title={workerRunning ? 'Stop MT5 demo automation' : 'Start MT5 demo automation'} close={() => { if (!workerBusy) setSheet(null); }}><div className="cp-help"><h3>{activeBot.symbol} · {activeBot.name}</h3><p>{activeBot.strategy} · {activeBot.lot_size ?? '—'} lots · {activeBot.risk_percent ?? '—'}% risk</p><p>{workerRunning ? 'Stop new entries. Existing positions keep their broker SL/TP protection.' : 'The server verifies a trade-enabled demo account and worker health before arming this saved strategy.'}</p>{workerError && <p className="cp-down" role="alert">{workerError}</p>}<button className="cp-primary cp:w-full" disabled={workerBusy} onClick={() => void controlWorker()}>{workerBusy ? <LoaderCircle className="cp-spin" size={17} /> : workerRunning ? <Pause size={17} /> : <Play size={17} />}{workerBusy ? 'Waiting for server…' : workerRunning ? 'Confirm stop' : 'Start demo worker'}</button></div></Sheet>}
  </div>;
}

export function mountClaudeProBot(element: HTMLElement, host: Host) { const root: Root = createRoot(element); root.render(<ClaudeProBot host={host} />); return () => root.unmount(); }

declare global {
  interface Window { ClaudeProNative?: { bootstrap(): string; openBroker(): void; request(id: string, path: string, method: string, body: string): void }; __claudeNativeReply?: (id: string, raw: string) => void }
}
const nativeRoot = typeof document !== 'undefined' ? document.querySelector<HTMLElement>('#claude-pro-root[data-native]') : null;
if (nativeRoot && window.ClaudeProNative) {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout> }>(); let id = 0;
  window.__claudeNativeReply = (requestId, raw) => { const entry = pending.get(requestId); if (!entry) return; clearTimeout(entry.timer); pending.delete(requestId); try { const response = JSON.parse(raw); if (response.error) entry.reject(new Error(response.error)); else entry.resolve(response.data); } catch { entry.reject(new Error('Native request returned invalid data.')); } };
  const api: Api = <T,>(path: string, method = 'GET', body?: object) => new Promise<T>((resolve, reject) => {
    const requestId = String(++id); const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Native broker request timed out.')); }, 30_000);
    pending.set(requestId, { resolve: value => resolve(value as T), reject, timer }); window.ClaudeProNative!.request(requestId, path, method, JSON.stringify(body || {}));
  });
  try { const bootstrap = JSON.parse(window.ClaudeProNative.bootstrap()); mountClaudeProBot(nativeRoot, { api, user: bootstrap.user || {}, config: bootstrap.config || {}, standalone: true }); }
  catch { nativeRoot.textContent = 'Claude Pro Bot could not open. Return to EliteTrade and try again.'; }
}
