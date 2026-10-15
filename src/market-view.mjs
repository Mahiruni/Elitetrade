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

/** Safe authenticated display DTO. No provider IDs, credentials or guessed ticks. */
export function liveMarketDetails(market,{symbol,timeframe,withCandles=false,withOrders=false}={}) {
  const info=market?.info,quote=market?.quote;
  if(!info||!quote||!['ACCOUNT_TRADE_MODE_DEMO','ACCOUNT_TRADE_MODE_REAL'].includes(info.type)||
     info.platform!=='mt5'||!Array.isArray(market.positions)||
     !Number.isFinite(quote.bid)||!Number.isFinite(quote.ask)||
     quote.bid<=0||quote.ask<=0||quote.ask<quote.bid||
     !Number.isFinite(Date.parse(quote.time||''))) {
    throw Object.assign(new Error('Live broker quote and positions could not be verified.'),{status:503});
  }
  const at=Date.parse(quote.time);
  const fresh=Date.now()-at<30000&&Date.now()-at>=-5000;
  const allowed=market.positions.slice(0,500).filter(p=>
    p&&typeof p.symbol==='string'&&/^[A-Za-z0-9._-]{3,30}$/.test(p.symbol)&&
    (typeof p.id==='string'||Number.isFinite(p.id))
  ).map(p=>({
    id:String(p.id).slice(0,100),symbol:p.symbol,
    type:String(p.type||'').slice(0,40),
    ...Object.fromEntries(['volume','openPrice','currentPrice','profit','stopLoss','takeProfit']
      .filter(k=>Number.isFinite(p[k])).map(k=>[k,p[k]]))
  }));
  const profit=allowed.length===market.positions.length&&allowed.every(p=>Number.isFinite(p.profit))
    ? allowed.reduce((sum,p)=>sum+p.profit,0) : null;
  const snapshot={
    accountType:info.type==='ACCOUNT_TRADE_MODE_DEMO'?'demo':'real',
    currency:/^[A-Z]{3}$/.test(info.currency||'')?info.currency:'USD',
    updatedAt:new Date(at).toISOString(),
    positions:allowed,
    ...(Number.isFinite(info.balance)?{balance:info.balance}:{}),
    ...(Number.isFinite(info.equity)?{equity:info.equity}:{}),
    ...(profit!==null?{profit}:{})
  };
  const result={
    symbol,timeframe,
    accountType:snapshot.accountType,
    quote:{bid:quote.bid,ask:quote.ask},
    updatedAt:snapshot.updatedAt,
    retrievedAt:new Date().toISOString(),
    fresh,
    snapshot
  };
  if(withCandles) {
    if(!Array.isArray(market.candles))throw Object.assign(new Error('Broker candles are not available.'),{status:503});
    result.candles=marketDetails({candles:market.candles},timeframe).candles;
  }
  if(withOrders) {
    if(!Array.isArray(market.orders))throw Object.assign(new Error('Broker orders are not available.'),{status:503});
    result.orders=marketDetails({orders:market.orders},timeframe).orders;
  }
  return result;
}
