// Gold SMC Scalper v3: broker-backed, closed-candle research only.
// Never creates orders, changes bot configurations, or enables a trading worker.
const FRAME = Object.freeze({m15:{ms:900000,min:60},m5:{ms:300000,min:55}});
const ok = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const round = n => Number(n.toFixed(8));
const bounds = bars => ({high:Math.max(...bars.map(b=>b.high)),low:Math.min(...bars.map(b=>b.low))});
const mean = x => x.reduce((a,b)=>a+b,0)/x.length;

export function validatedGoldCandles(raw,frame,at) {
  const cfg=FRAME[frame];
  if(!cfg||!Array.isArray(raw)||raw.length>500)throw new Error('Missing or excessive '+frame+' broker candles.');
  const bars=raw.map(c=>({...c,stamp:Date.parse(c?.time||'')})).sort((a,b)=>a.stamp-b.stamp);
  for(let i=0;i<bars.length;i++){
    const c=bars[i];
    if(!Number.isFinite(c.stamp)||![c.open,c.high,c.low,c.close].every(ok)||
      c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close)||
      (i>0&&c.stamp<=bars[i-1].stamp))throw new Error('Invalid or duplicate '+frame+' broker candles.');
  }
  const closed=bars.filter(c=>c.stamp+cfg.ms<=at);
  if(closed.length<cfg.min)throw new Error('Insufficient closed '+frame+' candles.');
  if(at-(closed.at(-1).stamp+cfg.ms)>cfg.ms*2)throw new Error('Stale '+frame+' candle feed.');
  // Session gaps are allowed historically, but not in the latest six candles.
  for(let i=closed.length-5;i<closed.length;i++)
    if(closed[i].stamp-closed[i-1].stamp!==cfg.ms)throw new Error('Interrupted '+frame+' candle feed.');
  return closed;
}

function ema(bars,period=50) {
  let value=mean(bars.slice(0,period).map(c=>c.close));
  for(let i=period;i<bars.length;i++)value+=(bars[i].close-value)*2/(period+1);
  return value;
}
function atr(bars,period=14) {
  const values=[];
  for(let i=bars.length-period;i<bars.length;i++) {
    const prev=bars[i-1].close;
    values.push(Math.max(bars[i].high-bars[i].low,Math.abs(bars[i].high-prev),Math.abs(bars[i].low-prev)));
  }
  return mean(values);
}
const within=(hour,a,b)=>hour>=a&&hour<b;
function sessionUTC(at){
  const hour=new Date(at).getUTCHours();
  return within(hour,7,10)?'London':within(hour,12,16)?'New York':null;
}
function detectSequence(bars,side,point) {
  const last=bars.length-1;
  // A sweep, then a close beyond pre-sweep structure, then a displacement FVG,
  // then a retracement/rejection on a later, fully closed bar.
  for(let sweep=Math.max(9,last-19);sweep<=last-4;sweep++){
    const prior=bounds(bars.slice(sweep-8,sweep));
    const wick=bars[sweep];
    const swept=side==='buy' ? wick.low<prior.low&&wick.close>prior.low :
      wick.high>prior.high&&wick.close<prior.high;
    if(!swept)continue;
    for(let shift=sweep+1;shift<=Math.min(last-3,sweep+7);shift++){
      const c=bars[shift];
      const shifted=side==='buy' ? c.close>prior.high&&c.close>c.open :
        c.close<prior.low&&c.close<c.open;
      if(!shifted)continue;
      const preBodies=bars.slice(Math.max(0,shift-10),shift).map(x=>Math.abs(x.close-x.open));
      if(preBodies.length<6||Math.abs(c.close-c.open)<mean(preBodies)*1.2)continue;
      for(let j=shift;j<=Math.min(last-1,shift+4);j++) {
        if(j<2)continue;
        const gap=side==='buy'
          ? {low:bars[j-2].high,high:bars[j].low}
          : {low:bars[j].high,high:bars[j-2].low};
        if(gap.high-gap.low<25*point)continue;
        const segment=bars.slice(sweep,j+1);
        const extreme=side==='buy'?Math.max(...segment.map(x=>x.high)):Math.min(...segment.map(x=>x.low));
        const pivot=side==='buy'?wick.low:wick.high;
        const length=Math.abs(extreme-pivot);
        if(length<=0)continue;
        const ote=side==='buy'?{low:extreme-.786*length,high:extreme-.618*length}
          :{low:extreme+.618*length,high:extreme+.786*length};
        const overlapLow=Math.max(gap.low,ote.low),overlapHigh=Math.min(gap.high,ote.high);
        if(overlapHigh<overlapLow)continue;
        const trigger=bars[last],before=bars[last-1];
        const touch=trigger.low<=overlapHigh&&trigger.high>=overlapLow;
        const rejection=side==='buy' ? trigger.close>trigger.open&&trigger.close>before.close&&trigger.close>=ote.low :
          trigger.close<trigger.open&&trigger.close<before.close&&trigger.close<=ote.high;
        if(!touch||!rejection||last<=j)continue;
        const structureStop=side==='buy'?Math.min(wick.low,trigger.low):Math.max(wick.high,trigger.high);
        return {sweepAt:wick.stamp,shiftAt:c.stamp,fvgAt:bars[j].stamp,fvg:{low:round(gap.low),high:round(gap.high)},
          ote:{low:round(ote.low),high:round(ote.high)},stopAnchor:structureStop};
      }
    }
  }
  return null;
}

/** Read-only. A BUY/SELL label is an analytical condition, never authorization to execute. */
export function evaluateGoldSmc({symbol,quote,spec,timeframes,accountType},at=Date.now()) {
  if(!/^XAUUSD[A-Za-z0-9._-]{0,20}$/i.test(symbol||''))throw new Error('Select the broker XAUUSD symbol (suffixes supported).');
  if(!['demo','real'].includes(accountType))throw new Error('Unverified MT5 account type.');
  const quoteAt=Date.parse(quote?.time||'');
  if(quote?.symbol!==symbol||!ok(quote?.bid)||!ok(quote?.ask)||quote.ask<quote.bid||
    !Number.isFinite(quoteAt)||quoteAt>at+5000||at-quoteAt>30000)throw new Error('Invalid, mismatched, or stale MT5 quote.');
  if(spec?.symbol!==symbol||!ok(spec?.point)||!Number.isInteger(spec?.digits)||spec.digits<0||spec.digits>10)
    throw new Error('Invalid broker symbol specification.');
  const m15=validatedGoldCandles(timeframes?.m15,'m15',at);
  const m5=validatedGoldCandles(timeframes?.m5,'m5',at);
  const m15Close=m15.at(-1).close,ema50=ema(m15,50);
  const previous=m15.at(-2),current=m15.at(-1);
  const bias=m15Close>ema50&&current.low>=previous.low?'BULLISH':
    m15Close<ema50&&current.high<=previous.high?'BEARISH':'NEUTRAL';
  const side=bias==='BULLISH'?'buy':bias==='BEARISH'?'sell':null;
  const volatility=atr(m5);
  const atrPoints=volatility/spec.point,spreadPoints=(quote.ask-quote.bid)/spec.point;
  const session=sessionUTC(at);
  const sequence=side?detectSequence(m5,side,spec.point):null;
  const reasons=[];
  if(!session)reasons.push('Outside configured London / New York UTC windows.');
  if(bias==='NEUTRAL')reasons.push('M15 EMA50 and recent structure are not aligned.');
  if(!Number.isFinite(atrPoints)||atrPoints<40||atrPoints>350)reasons.push('M5 ATR outside the 40–350 point filter.');
  if(spreadPoints>25)reasons.push('Live spread exceeds 25 broker points.');
  if(side&&!sequence)reasons.push('No causal M5 sweep → MSS + displacement → FVG/OTE retest with rejection.');
  const entry=side==='buy'?quote.ask:quote.bid;
  const stop=sequence?(side==='buy'?sequence.stopAnchor-30*spec.point:sequence.stopAnchor+30*spec.point):null;
  const distance=stop===null?null:Math.abs(entry-stop);
  if(sequence&&(!ok(distance)||(side==='buy'&&stop>=quote.bid)||(side==='sell'&&stop<=quote.ask)||
    distance<Math.max(10*spec.point,(quote.ask-quote.bid)*10)))reasons.push('Structure stop is invalid or too close to the spread.');
  const validated=reasons.length===0;
  return {
    version:'gold-smc-v3.0-research',source:'MT5 broker candles',executionEnabled:false,
    symbol,accountType,state:validated?(side==='buy'?'BUY':'SELL'):'WAIT',
    side:validated?side:null,validated,quoteTime:quote.time,evaluatedAt:new Date(at).toISOString(),
    bias,ema50:round(ema50),m15Close,session:session||'Outside killzone',
    spreadPoints:round(spreadPoints),atrPoints:round(atrPoints),
    structure:sequence?{sweepAt:new Date(sequence.sweepAt).toISOString(),
      shiftAt:new Date(sequence.shiftAt).toISOString(),fvgAt:new Date(sequence.fvgAt).toISOString(),
      fvg:sequence.fvg,ote:sequence.ote}:null,
    ...(validated?{plan:{entry:round(entry),stopLoss:round(stop),
      tp1:round(entry+(side==='buy'?1:-1)*distance),
      tp2:round(entry+(side==='buy'?1:-1)*distance*2.5),
      tp1PartialPct:70,riskPercent:0.5,kind:'indicative-read-only'}}:{}),
    reasons:validated?['Research conditions align. Execution remains disabled. News and broker order rules require independent validation.']:reasons,
    warnings:['Not a win-rate guarantee','Economic-calendar news filter is not evaluated in this web preview',
      'No MT5 order, dynamic lot, or partial-close action is issued']
  };
}
