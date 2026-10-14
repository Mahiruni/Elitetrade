import { STRATEGIES, evaluateStrategy } from './trading-strategies.mjs';

export const START=Date.UTC(2026,9,14,9,0,0);
const FIVE_MIN=300000;
const validModes=new Set(Object.keys(STRATEGIES));
const money=x=>Math.round(x*100)/100;
const finite=x=>Number.isFinite(x);
const basePrice=t=>2940 + 27*Math.sin(t/9.5) + 12*Math.sin(t/23) + 3.5*Math.sin(t/2.7) + 7*Math.cos(t/37);
const fix=n=>Number(n.toFixed(2));
export function paperCandles(strategy,step) {
  if(!validModes.has(strategy)||!Number.isInteger(step)||step<0||step>100000)throw new Error('Invalid paper simulation configuration');
  const unit=STRATEGIES[strategy].minutes/5;
  const boundary=Math.floor(step/unit)*unit;
  const candles=[];
  for(let bar=120;bar>0;bar--) {
    const k=boundary-bar*unit;
    const points=Array.from({length:unit+1},(_,j)=>basePrice(k+j));
    const open=fix(points[0]),close=fix(points.at(-1));
    const high=fix(Math.max(...points)+.8+Math.abs(Math.sin(k/4))*.4);
    const low=fix(Math.min(...points)-.8-Math.abs(Math.cos(k/5))*.4);
    candles.push({time:new Date(START+k*FIVE_MIN).toISOString(),open,high,low,close});
  }
  return candles;
}
export function createPaperDemo() {
  return {mode:'paper-only',running:false,strategy:'scalping',step:0,balance:10000,startBalance:10000,position:null,history:[],lastSignal:null,lastBar:null,events:['Synthetic market loaded. No MetaApi, Exness or real orders are connected.']};
}
const addEvent=(s,msg)=>{s.events=[msg,...s.events].slice(0,8)};
export function paperAction(s,action,value) {
  if(action==='reset')return createPaperDemo();
  if(action==='strategy') {
    if(!validModes.has(value))throw new Error('Choose an available paper strategy');
    if(s.running)throw new Error('Pause the paper bot before switching strategies');
    s.strategy=value;s.lastBar=null;s.lastSignal=null;s.position=null;
    addEvent(s,`Selected ${value} — a synthetic strategy demonstration.`);
    return s;
  }
  if(action==='start'){s.running=true;addEvent(s,'Paper simulation running — no broker trades.');return s;}
  if(action==='pause'){s.running=false;addEvent(s,'Paper simulation paused.');return s;}
  if(action!=='step')throw new Error('Unsupported simulation action');
  if(!Number.isInteger(value)||value<1||value>30)throw new Error('Invalid paper candle step');
  for(let n=0;n<value;n++){
    s.step++;
    const candles=paperCandles(s.strategy,s.step);
    const bar=candles.at(-1);
    const mark=fix(basePrice(s.step));
    if(s.position) {
      const p=s.position;
      const exit=p.side==='buy'?(mark<=p.stop?p.stop:mark>=p.target?p.target:null):(mark>=p.stop?p.stop:mark<=p.target?p.target:null);
      if(exit!==null) {
        const pnl=money((p.side==='buy'?exit-p.entry:p.entry-exit)*1);
        s.balance=money(s.balance+pnl);
        s.history.unshift({side:p.side,entry:p.entry,exit:fix(exit),pnl,closedAt:new Date(START+s.step*FIVE_MIN).toISOString(),strategy:p.strategy});
        s.history=s.history.slice(0,30);
        addEvent(s,`PAPER ${p.side.toUpperCase()} exited · ${pnl>=0?'+':''}$${pnl.toFixed(2)} virtual P/L`);
        s.position=null;
      }
    }
    const at=START+s.step*FIVE_MIN;
    try {
      const signal=evaluateStrategy(s.strategy,candles,at);
      if(signal.candleTime!==s.lastBar) {
        s.lastBar=signal.candleTime;
        if(signal.side) {
          s.lastSignal={side:signal.side,time:new Date(at).toISOString(),strategy:s.strategy};
          addEvent(s,`Synthetic ${signal.side.toUpperCase()} signal on closed ${signal.timeframe} candle.`);
          if(s.running && !s.position) {
            const entry=fix(mark+(signal.side==='buy'?.15:-.15));
            s.position={side:signal.side,entry,stop:fix(entry+(signal.side==='buy'?-8:8)),target:fix(entry+(signal.side==='buy'?16:-16)),openedAt:new Date(at).toISOString(),strategy:s.strategy,lotSize:.01};
            addEvent(s,`Opened simulated ${signal.side.toUpperCase()} 0.01 lot with virtual SL/TP.`);
          }
        }
      }
    } catch(e){addEvent(s,'Paper market data unavailable: '+String(e.message).slice(0,90));}
  }
  return s;
}
export function paperView(s) {
  const candles=paperCandles(s.strategy,s.step);
  const quote=fix(basePrice(s.step));
  const unrealized=s.position?money((s.position.side==='buy'?quote-s.position.entry:s.position.entry-quote)*1):0;
  return {mode:s.mode,brokerConnected:false,executionEnabled:false,liveData:false,running:s.running,
    strategy:s.strategy,step:s.step,virtualTime:new Date(START+s.step*FIVE_MIN).toISOString(),symbol:'XAUUSD (synthetic)',
    quote,balance:s.balance,equity:money(s.balance+unrealized),unrealized,
    position:s.position,history:s.history,lastSignal:s.lastSignal,events:s.events,candles:candles.slice(-50)};
}
