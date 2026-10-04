// Allowlist read-only market data. Provider metadata and credentials stay server-side.
export function marketDetails(market,timeframe) {
  const candles = (Array.isArray(market.candles) ? market.candles : []).filter(c =>
    c && Number.isFinite(Date.parse(c.time)) && ['open','high','low','close'].every(k=>Number.isFinite(c[k]) && c[k]>0) &&
    c.high>=Math.max(c.open,c.close,c.low) && c.low<=Math.min(c.open,c.close)
  ).slice(-120).map(c=>({time:new Date(c.time).toISOString(),...Object.fromEntries(['open','high','low','close'].map(k=>[k,c[k]]))})).sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  const unique=candles.filter((c,i)=>!i || c.time!==candles[i-1].time);
  const orders=Array.isArray(market.orders) ? market.orders.slice(0,500).filter(o=>o && typeof o.symbol==='string').map(o=>({
    id:String(o.id ?? '').slice(0,100),symbol:o.symbol.slice(0,100),type:String(o.type || '').slice(0,40),
    ...Object.fromEntries(['volume','openPrice','stopLoss','takeProfit'].filter(k=>Number.isFinite(o[k])).map(k=>[k,o[k]]))
  })) : null;
  return {timeframe,candles:unique,orders};
}
