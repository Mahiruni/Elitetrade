import { planTrade } from './trading-strategies.mjs';

// Read-only broker risk affordability diagnostics.
// A suggested setting is not a trade authorization: margin, broker exposure,
// slippage, session conditions and loss limits remain worker-side gates.
const round2=n=>Math.round(n*100)/100;
const finitePositive=n=>Number.isFinite(n)&&n>0;
const riskMessage='Risk budget cannot cover the minimum broker lot.';

export function brokerRiskAffordability({bot,market,at=Date.now()}) {
  const unknown=(reason='Broker specification or quote is not verified.')=>({
    status:'unverified',reason,tradeAuthorized:false,suggestion:null
  });
  if(!market?.info||market.info.type!=='ACCOUNT_TRADE_MODE_DEMO'||
      market.info.platform!=='mt5'||market.info.tradeAllowed!==true||
      market.info.investorMode!==false)
    return unknown('Requires a verified, trade-enabled MT5 demo account.');
  const {info,quote,spec}=market;
  if(!finitePositive(info.equity)||!finitePositive(info.freeMargin)||
     !finitePositive(quote?.bid)||!finitePositive(quote?.ask)||
     !finitePositive(quote?.lossTickValue)||!finitePositive(spec?.minVolume)||
     !finitePositive(spec?.tickSize)||!Number.isInteger(spec?.digits)||
     !finitePositive(bot?.stop_loss)||!finitePositive(bot?.take_profit)||
     !finitePositive(bot?.risk_percent))
     return unknown();
  if(!Number.isFinite(Date.parse(quote.time))||Math.abs(at-Date.parse(quote.time))>30000)
    return unknown('Broker quote is not fresh enough for a risk check.');
  const riskBudget=round2(info.equity*bot.risk_percent/100);
  const directional=[];
  for (const side of ['buy','sell']) {
    let failure=null;
    try {
      const candidate=planTrade({bot,...market,side,at});
      directional.push({side,status:'affordable',estimatedRisk:round2(candidate.estimatedRisk)});
      continue;
    } catch(error) { failure=error.message; }
    if(failure!==riskMessage) {
      directional.push({side,status:'unverified',reason:'Other broker or risk condition prevents trade.'});
      continue;
    }
    const entry=side==='buy'?quote.ask:quote.bid,delta=entry*bot.stop_loss/100,
      down=side==='buy',rawStop=entry+(down?-delta:delta),
      stop=Number((Math.round(rawStop/spec.tickSize)*spec.tickSize).toFixed(spec.digits));
    const distance=Math.abs(entry-stop);
    const minimumRisk=round2(distance/spec.tickSize*quote.lossTickValue*spec.minVolume);
    let proposal=null;
    // Scan ONLY lower stop distances. A tighter stop can be inadvisable in
    // volatile markets: user must explicitly review, never auto-update bot.
    // Use the same executable broker validation as the actual worker.
    const maxStep=Math.min(Math.floor(bot.stop_loss*100)-1,Math.floor(
      (info.equity*bot.risk_percent/100*.85)/(entry*spec.minVolume*quote.lossTickValue/spec.tickSize)*10000));
    for(let step=Math.max(0,maxStep);step>=10;step--){
      const stopPct=round2(step/100);
      try {
        const safe=planTrade({bot:{...bot,stop_loss:stopPct},...market,side,at});
        // Preserve original configured nominal target/stop ratio in this
        // informational proposal. Do not mutate target or bot settings.
        const targetPct=round2(Math.min(50,stopPct*bot.take_profit/bot.stop_loss));
        if(targetPct>=.1)proposal={stopLossPercent:stopPct,takeProfitPercent:targetPct,
          minimumLot:spec.minVolume,approxEstimatedLoss:round2(safe.estimatedRisk)};
        break;
      }catch {/* Continue testing tighter stops until all broker limits pass. */}
    }
    directional.push({side,status:'blocked_minimum_lot',minLotRiskAtConfiguredStop:minimumRisk,suggestion:proposal});
  }
  if(directional.some(entry=>entry.status==='affordable'))
    return {status:'affordable',riskBudget,configuredStopPercent:bot.stop_loss,
      minimumBrokerLot:spec.minVolume,tradeAuthorized:false,
      reason:'Broker minimum lot appears within the per-trade risk allowance for at least one direction. Other execution gates remain unchecked.',
      suggestion:null,directions:directional};
  const blocked=directional.filter(entry=>entry.status==='blocked_minimum_lot');
  if(blocked.length)
    return {status:'blocked_minimum_lot',riskBudget,configuredStopPercent:bot.stop_loss,
      minimumBrokerLot:spec.minVolume,
      minLotRiskAtConfiguredStop:Math.max(...blocked.map(x=>x.minLotRiskAtConfiguredStop)),
      suggestion:blocked.find(x=>x.suggestion)?.suggestion||null,
      tradeAuthorized:false,directions:directional,
      reason:'The minimum MT5 lot would exceed your saved per-trade risk allowance at the current stop distance. A tighter stop can get hit more often; review suggested values before manually saving and backtest before use.'};
  return unknown('Trade cannot be approved using the current broker quote, account or stop limits.');
}
