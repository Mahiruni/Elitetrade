// Read-only, non-repainting POI strategy v1. All inputs must be authentic MT5 broker candles.
export const POI_FRAMES = Object.freeze({ w1: { broker: '1w', ms: 7 * 86400000, min: 12, maxAge: 10 * 86400000 }, h4: { broker: '4h', ms: 4 * 3600000, min: 36, maxAge: 4 * 86400000 }, m15: { broker: '15m', ms: 900000, min: 40, maxAge: 3 * 3600000 }, m5: { broker: '5m', ms: 300000, min: 30, maxAge: 3600000 } });
const good = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const mean = values => values.reduce((total, n) => total + n, 0) / values.length;
const fmt = n => Number(n.toFixed(8));
function candlesFor(raw, key, at) {
  const conf = POI_FRAMES[key];
  if (!Array.isArray(raw)) throw new Error(key.toUpperCase() + ': missing broker candles.');
  const parsed = raw.map(c => ({ ...c, stamp: Date.parse(c?.time || '') })).sort((a,b) => a.stamp - b.stamp);
  if (parsed.length > 500) throw new Error(key.toUpperCase() + ': unexpected candle count.');
  for (let i=0;i<parsed.length;i++) {
    const c=parsed[i];
    if (!Number.isFinite(c.stamp) || ![c.open,c.high,c.low,c.close].every(good) || c.high < Math.max(c.open,c.close,c.low) || c.low > Math.min(c.open,c.close) || (i && parsed[i-1].stamp >= c.stamp)) throw new Error(key.toUpperCase() + ': invalid or duplicated broker candles.');
  }
  const complete = parsed.filter(c => c.stamp + conf.ms <= at);
  if (complete.length < conf.min) throw new Error(key.toUpperCase() + ': insufficient closed candles (' + complete.length + '/' + conf.min + ').');
  const last = complete.at(-1);
  if (at - last.stamp - conf.ms > conf.maxAge || last.stamp > at) throw new Error(key.toUpperCase() + ': historical candles are stale.');
  if (key === 'm5' || key === 'm15') {
    const latest = complete.slice(-6);
    for (let i=1;i<latest.length;i++) {
      if (latest[i].stamp - latest[i-1].stamp !== conf.ms) throw new Error(key.toUpperCase() + ': latest candles contain a gap.');
    }
  }
  return complete;
}
const extremes = candles => ({ high: Math.max(...candles.map(c=>c.high)), low: Math.min(...candles.map(c=>c.low)) });
const atr = bars => mean(bars.map(c=>c.high-c.low));
function shift(bars, side) {
  const recent = bars.slice(-5);
  for(let i=1;i<recent.length;i++) {
    const before=bars.slice(0,bars.indexOf(recent[i])).slice(-8);
    if(before.length<8)continue;
    const range=extremes(before), curr=recent[i];
    if(side==='buy' && curr.close>range.high && curr.close>curr.open)return curr.stamp;
    if(side==='sell' && curr.close<range.low && curr.close<curr.open)return curr.stamp;
  }
  return false;
}
function sweep(bars, side) {
  const recent=bars.slice(-8);
  for(const c of recent) {
    const before=bars.slice(0,bars.indexOf(c)).slice(-10);
    if(before.length!==10)continue;
    const range=extremes(before);
    if(side==='buy' && c.low<range.low && c.close>range.low)return c.stamp;
    if(side==='sell' && c.high>range.high && c.close<range.high)return c.stamp;
  }
  return false;
}
export function evaluatePoiStrategy({ symbol, quote, spec, timeframes, accountType }, at=Date.now()) {
  if(!/^[A-Za-z0-9._-]{3,30}$/.test(symbol || ''))throw new Error('Unverified broker symbol.');
  if(!['demo','real'].includes(accountType))throw new Error('Broker account type is unverified.');
  const quoteAt=Date.parse(quote?.time || '');
  if(!good(quote?.bid)||!good(quote?.ask)||quote.ask<quote.bid||!Number.isFinite(quoteAt)||quoteAt>at+5000||quoteAt<at-30000||quote?.symbol!==symbol)throw new Error('MT5 broker quote is stale or invalid.');
  if(spec?.symbol!==symbol||!good(spec?.point)||!Number.isInteger(spec?.digits)||spec.digits<0||spec.digits>10)throw new Error('Broker symbol specification is unavailable.');
  const series={};
  for(const frame of Object.keys(POI_FRAMES))series[frame]=candlesFor(timeframes?.[frame],frame,at);
  const weekly=series.w1, four=series.h4, fifteen=series.m15, five=series.m5;
  const lastWeekly=weekly.at(-1), lastH4=four.at(-1), last15=fifteen.at(-1), last5=five.at(-1);
  const recent=weekly.slice(-4).map(c=>c.close), prior=weekly.slice(-8,-4).map(c=>c.close);
  const wBias=mean(recent)>mean(prior)&&lastWeekly.close>mean(weekly.slice(-10).map(c=>c.close)) ? 'BULLISH' : mean(recent)<mean(prior)&&lastWeekly.close<mean(weekly.slice(-10).map(c=>c.close))?'BEARISH':'NEUTRAL';
  const hRange=extremes(four.slice(-33,-1));
  const hAtr=atr(four.slice(-14));
  const price=(quote.ask+quote.bid)/2;
  const side=wBias==='BULLISH'?'buy':wBias==='BEARISH'?'sell':null;
  const zoneLevel=side==='buy'?hRange.low:side==='sell'?hRange.high:null;
  const atZone=side==='buy'? price>=hRange.low-hAtr*.2 && price<=hRange.low+hAtr*1.5 :side==='sell'?price<=hRange.high+hAtr*.2 && price>=hRange.high-hAtr*1.5:false;
  const sweepAt=side ? sweep(fifteen,side):false;
  const shiftAt=side ? shift(fifteen,side):false;
  const swept=Boolean(sweepAt);
  const structured=Boolean(sweepAt && shiftAt && shiftAt > sweepAt);
  const m5range=extremes(five.slice(-7,-1));
  const previousBodies=five.slice(-11,-1).map(c=>Math.abs(c.close-c.open));
  const displaced=Math.abs(last5.close-last5.open)>mean(previousBodies)*1.2;
  const afterShift=Boolean(shiftAt && last5.stamp+POI_FRAMES.m5.ms >= shiftAt+POI_FRAMES.m15.ms);
  const m5Trigger=side==='buy'? last5.close>m5range.high&&last5.close>last5.open&&displaced&&afterShift:side==='sell'?last5.close<m5range.low&&last5.close<last5.open&&displaced&&afterShift:false;
  const entry=side==='buy'?quote.ask:side==='sell'?quote.bid:null;
  const candidateStop=side==='buy'?Math.min(hRange.low, ...fifteen.slice(-12).map(c=>c.low)):side==='sell'?Math.max(hRange.high,...fifteen.slice(-12).map(c=>c.high)):null;
  const stop=entry!==null&&candidateStop!==null?fmt(candidateStop):null;
  const risk=entry!==null&&stop!==null?Math.abs(entry-stop):0;
  const spread=quote.ask-quote.bid;
  const ratio=side&&risk>0?2:0;
  const spreadOk=risk>0&&spread<=risk*.1;
  const stopOk=risk>=Math.max(spec.point*10, spread*10);
  const verified=Boolean(side && atZone && swept && structured && m5Trigger && spreadOk && stopOk);
  const reasons=[];
  if(!side)reasons.push('Weekly bias is neutral.');
  if(side&&!atZone)reasons.push('Price is outside the H4 point-of-interest zone.');
  if(side&&!swept)reasons.push('M15 liquidity sweep has not been confirmed.');
  if(side&&!structured)reasons.push('M15 close beyond prior structure is missing.');
  if(side&&!m5Trigger)reasons.push('M5 closed-candle displacement and break are not confirmed.');
  if(side&&!spreadOk)reasons.push('Broker spread exceeds the 10% risk-distance limit.');
  if(side&&!stopOk)reasons.push('Invalidation distance is too small.');
  const target=verified?fmt(entry+(side==='buy'?1:-1)*risk*2):null;
  return { version:'poi-v1.0', source:'MT5 broker candles', symbol, accountType,
    evaluatedAt:new Date(at).toISOString(), quoteTime:quote.time, bid:quote.bid, ask:quote.ask, spread:fmt(spread),
    state:verified ? (side==='buy'?'BUY':'SELL'):'WAIT', validated:verified, side:verified?side:null,
    w1:{bias:wBias,closedAt:new Date(lastWeekly.stamp+POI_FRAMES.w1.ms).toISOString(),samples:weekly.length},
    h4:{description:atZone?'At weekly-aligned H4 POI':'Outside the qualifying H4 POI',support:fmt(hRange.low),resistance:fmt(hRange.high),atr:fmt(hAtr),atZone,closedAt:new Date(lastH4.stamp+POI_FRAMES.h4.ms).toISOString()},
    m15:{liquiditySweep:swept,structureShift:structured,closedAt:new Date(last15.stamp+POI_FRAMES.m15.ms).toISOString()},
    m5:{entryTrigger:m5Trigger,displacement:displaced,closedAt:new Date(last5.stamp+POI_FRAMES.m5.ms).toISOString()},
    ...(verified?{plan:{entry:fmt(entry),stopLoss:stop,takeProfit:target,riskReward:ratio,kind:'indicative-read-only'}}:{}),
    reasons:verified?['All deterministic POI conditions confirmed; NOT an executable order.']:reasons,
    executionEnabled:false };
}
