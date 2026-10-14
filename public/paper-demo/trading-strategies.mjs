export const STRATEGIES = Object.freeze({
  trend:{timeframe:'15m',minutes:15,fast:20,slow:50,description:'EMA 20/50 crossover on closed 15-minute candles'},
  scalping:{timeframe:'5m',minutes:5,fast:9,slow:21,description:'EMA 9/21 crossover on closed 5-minute candles'},
  breakout:{timeframe:'15m',minutes:15,lookback:20,description:'Close beyond the previous 20 closed 15-minute candles'}
});
const reject = message => { throw new Error(message); };
const positive = x => Number.isFinite(x) && x > 0;
function ema(values,period) {
  const result=[];let value=values.slice(0,period).reduce((a,b)=>a+b,0)/period;
  for(let i=period-1;i<values.length;i++) {if(i>=period)value+=(values[i]-value)*2/(period+1);result[i]=value;}
  return result;
}
export function evaluateStrategy(strategy,raw,at=Date.now()) {
  const preset=STRATEGIES[strategy];if(!preset)reject('Unknown strategy.');
  if(!Array.isArray(raw))reject('Invalid candle response.');
  const duration=preset.minutes*60000;
  const candles=raw.map(c=>({...c,time:Date.parse(c.time)})).sort((a,b)=>a.time-b.time);
  for(let i=0;i<candles.length;i++) {
    const c=candles[i];
    if(!Number.isFinite(c.time)||![c.open,c.high,c.low,c.close].every(positive)||c.high<Math.max(c.open,c.close,c.low)||c.low>Math.min(c.open,c.close)|| (i&&c.time<=candles[i-1].time))reject('Invalid or duplicate candles.');
  }
  const closed=candles.filter(c=>c.time+duration<=at);const need=preset.slow?preset.slow+2:preset.lookback+2;
  if(closed.length<need)reject('Not enough closed candles.');
  const last=closed.at(-1),previous=closed.at(-2);
  if(at-(last.time+duration)>duration||last.time-previous.time!==duration)reject('Candle history is stale or interrupted.');
  for(let i=closed.length-need+1;i<closed.length;i++)if(closed[i].time-closed[i-1].time!==duration)reject('Candle history has gaps.');
  let side=null;
  if(preset.lookback) {
    const channel=closed.slice(-preset.lookback-1,-1);
    const high=Math.max(...channel.map(c=>c.high)),low=Math.min(...channel.map(c=>c.low));
    if(last.close>high)side='buy';else if(last.close<low)side='sell';
  } else {
    const prices=closed.map(c=>c.close),fast=ema(prices,preset.fast),slow=ema(prices,preset.slow),i=prices.length-1;
    if(fast[i-1]<=slow[i-1]&&fast[i]>slow[i])side='buy';
    if(fast[i-1]>=slow[i-1]&&fast[i]<slow[i])side='sell';
  }
  return {side,candleTime:last.time,timeframe:preset.timeframe,description:preset.description};
}
export function planTrade({bot,info,quote,spec,side,at=Date.now()}) {
  if(info.type!=='ACCOUNT_TRADE_MODE_DEMO'||info.platform!=='mt5'||info.tradeAllowed!==true||info.investorMode!==false)reject('A trade-enabled MT5 demo account with a master password is required.');
  if(!['buy','sell'].includes(side))reject('No entry signal.');
  if(!positive(info.equity)||!positive(info.freeMargin))reject('Account equity or free margin is unavailable.');
  for(const [key,min,max] of [['risk_percent',.1,5],['stop_loss',.1,20],['take_profit',.1,50],['lot_size',.01,10],['daily_loss',.1,10],['max_drawdown',1,30]])if(!Number.isFinite(bot[key])||bot[key]<min||bot[key]>max)reject('Invalid risk configuration.');
  if(quote.symbol!==bot.symbol||spec.symbol!==bot.symbol||!positive(quote.ask)||!positive(quote.bid)||quote.ask<quote.bid||!positive(quote.lossTickValue))reject('Invalid broker quote.');
  const age=at-Date.parse(quote.time);if(!Number.isFinite(age)||age< -5000||age>30000)reject('Broker quote is stale.');
  for(const field of ['tickSize','minVolume','maxVolume','volumeStep','point'])if(!positive(spec[field]))reject('Incomplete broker specification.');
  if(!Number.isInteger(spec.digits)||spec.digits<0||spec.digits>10||!Number.isFinite(spec.stopsLevel)||spec.stopsLevel<0)reject('Invalid price precision or stop distance.');
  if(!['SYMBOL_TRADE_MODE_FULL',side==='buy'?'SYMBOL_TRADE_MODE_LONGONLY':'SYMBOL_TRADE_MODE_SHORTONLY'].includes(spec.tradeMode))reject('Broker does not allow this trade direction.');
  if(!['SYMBOL_ORDER_MARKET','SYMBOL_ORDER_SL','SYMBOL_ORDER_TP'].every(t=>spec.allowedOrderTypes?.includes(t)))reject('Broker does not support protected market orders.');
  const entry=side==='buy'?quote.ask:quote.bid,direction=side==='buy'?1:-1;
  const rounding=x=>Number((Math.round(x/spec.tickSize)*spec.tickSize).toFixed(spec.digits));
  const stopLoss=rounding(entry-direction*entry*bot.stop_loss/100),takeProfit=rounding(entry+direction*entry*bot.take_profit/100);
  const stopDistance=direction*(entry-stopLoss),targetDistance=direction*(takeProfit-entry);
  const exitPrice=side==='buy'?quote.bid:quote.ask;
  if(!positive(stopLoss)||!positive(takeProfit)||stopDistance<=0||targetDistance<=0||direction*(exitPrice-stopLoss)<spec.stopsLevel*spec.point||direction*(takeProfit-exitPrice)<spec.stopsLevel*spec.point)reject('Stop loss or take profit violates broker limits.');
  if((quote.ask-quote.bid)>stopDistance*.1)reject('Spread exceeds 10% of stop distance.');
  const riskBudget=info.equity*bot.risk_percent/100;
  const rawVolume=Math.min(bot.lot_size,spec.maxVolume,riskBudget/(stopDistance/spec.tickSize*quote.lossTickValue));
  const volume=Number((Math.floor((rawVolume+1e-12)/spec.volumeStep)*spec.volumeStep).toFixed(8));
  const estimatedRisk=stopDistance/spec.tickSize*quote.lossTickValue*volume;
  if(volume<spec.minVolume||volume>spec.maxVolume||!positive(volume)||estimatedRisk>riskBudget+1e-8)reject('Risk budget cannot cover the minimum broker lot.');
  return {actionType:side==='buy'?'ORDER_TYPE_BUY':'ORDER_TYPE_SELL',symbol:bot.symbol,volume,stopLoss,takeProfit,estimatedRisk,openPrice:entry};
}
export function riskCheckpoint(state,info,bot,at=Date.now()) {
  if(!positive(info.equity)||!positive(info.balance))reject('Invalid account risk figures.');
  const day=new Date(at).toISOString().slice(0,10);
  const next={day,day_equity:state?.day===day?Number(state.day_equity):info.equity,peak_equity:Math.max(Number(state?.peak_equity)||info.equity,info.equity)};
  if(!positive(next.day_equity)||!positive(next.peak_equity))reject('Invalid stored risk baseline.');
  if((next.day_equity-info.equity)/next.day_equity*100>=bot.daily_loss)reject('Daily equity loss limit reached.');
  if((next.peak_equity-info.equity)/next.peak_equity*100>=bot.max_drawdown)reject('Maximum equity drawdown reached.');
  return next;
}
