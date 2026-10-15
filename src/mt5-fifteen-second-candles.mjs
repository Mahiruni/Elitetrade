// Experimental, DEMO-only 15-second bars constructed from REAL MetaApi MT5 ticks.
// MetaTrader candle timeframes start at 1m: no invented 15s provider candles.
// Do not interpolate gaps or reuse future, stale, or malformed tick data.
const fail=msg=>{throw new Error(msg)};
export function build15sTickCandles(raw,at=Date.now()){
  if(!Array.isArray(raw)||raw.length>1000)fail('Invalid MetaApi MT5 tick history.');
  if(!Number.isSafeInteger(at)||at<1)fail('Invalid evaluation time.');
  const bars=new Map();
  for(const tick of raw){
    if(!tick||typeof tick!=='object'||Array.isArray(tick))fail('Invalid broker tick.');
    const ms=Date.parse(tick.time);
    if(!Number.isFinite(ms))fail('Invalid broker tick timestamp.');
    if(ms>at+5000)fail('Future broker tick is not eligible.');
    if(ms<at-300000||ms>at)continue;
    const bid=Number(tick.bid),ask=Number(tick.ask);
    if(!Number.isFinite(bid)||!Number.isFinite(ask)||
       bid<=0||ask<bid||ask>100000000)fail('Invalid broker tick prices.');
    const bucket=Math.floor(ms/15000)*15000;
    // Use only completed 15s buckets, never the current forming interval.
    if(bucket+15000>at)continue;
    const mid=(bid+ask)/2;
    if(!Number.isFinite(mid)||mid<=0)fail('Invalid broker tick midpoint.');
    const bar=bars.get(bucket)??[];
    bar.push({ms,mid});
    bars.set(bucket,bar);
  }
  // Require actual observed ticks in each interval. Missing history leads to
  // a no-signal result in evaluateStrategy, not a fabricated flat candle.
  return [...bars.entries()].sort((a,b)=>a[0]-b[0]).map(([bucket,points])=>{
    points.sort((a,b)=>a.ms-b.ms);
    const values=points.map(p=>p.mid);
    return {time:new Date(bucket).toISOString(),open:values[0],
      high:Math.max(...values),low:Math.min(...values),
      close:values.at(-1)};
  });
}
