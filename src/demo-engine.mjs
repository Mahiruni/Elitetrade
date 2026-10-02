import { randomUUID } from 'node:crypto';
import { STRATEGIES,evaluateStrategy,planTrade,riskCheckpoint } from './trading-strategies.mjs';
const q=encodeURIComponent;
const time=()=>new Date().toISOString();
export async function engineReady(db,token='') {
  try {
    const h=await db.one('elitetrade_engine_heartbeat','id=eq.true&select=updated_at',token);
    const age=Date.now()-Date.parse(h?.updated_at);
    return Number.isFinite(age)&&age>=-5000&&age<90000;
  } catch{return false;}
}
export async function processDemoRun({db,gateway,run,at=Date.now()}) {
  const owner=randomUUID();let receipt=null;
  if(!await db.rpc('elitetrade_engine_lease',{p_account_id:run.account_id,p_owner:owner}))return;
  const message=async text=>db.update('elitetrade_engine_runs',`bot_id=eq.${q(run.bot_id)}`,{message:text,updated_at:time()});
  const halt=async text=>{
    await db.update('elitetrade_engine_runs',`bot_id=eq.${q(run.bot_id)}`,{enabled:false,message:text,updated_at:time()});
    await db.update('elitetrade_bots',`id=eq.${q(run.bot_id)}`,{status:receipt?'unknown':'stopped'});
  };
  try {
    const current=await db.one('elitetrade_engine_runs',`bot_id=eq.${q(run.bot_id)}&select=*`);
    if(!current?.enabled)return;
    const profile=await db.one('elitetrade_profiles',`id=eq.${q(run.user_id)}&select=active,role,disabled`);
    if(!profile||profile.disabled||(!profile.active&&profile.role!=='admin'))throw new Error('Subscription access is inactive.');
    const account=await db.one('elitetrade_accounts',`id=eq.${q(run.account_id)}&user_id=eq.${q(run.user_id)}&select=id,gateway_id,status`);
    if(!account?.gateway_id||account.status!=='connected')throw new Error('MT5 account connection must be confirmed.');
    const bot=current.config,preset=STRATEGIES[bot.strategy];if(!preset)throw new Error('Unknown strategy preset.');
    const unresolved=await db.one('elitetrade_engine_orders',`account_id=eq.${q(run.account_id)}&status=in.(reserved,unknown)&select=id`);
    if(unresolved)throw new Error('Unconfirmed order requires provider reconciliation before restarting.');
    const market=await gateway.market(account.gateway_id,bot.symbol,preset.timeframe);
    if(market.info.type!=='ACCOUNT_TRADE_MODE_DEMO'||market.info.platform!=='mt5'||market.info.tradeAllowed!==true||market.info.investorMode!==false)throw new Error('Verified demo account with trading permission required; real trading is disabled.');
    const state=await db.one('elitetrade_engine_risk',`account_id=eq.${q(run.account_id)}&select=*`);
    const baseline=riskCheckpoint(state,market.info,bot,at);
    await db.upsert('elitetrade_engine_risk','on_conflict=account_id',{account_id:run.account_id,...baseline});
    if(market.positions.length||market.orders.length){await message('Monitoring demo; existing broker positions or orders block new entries.');return;}
    const signal=evaluateStrategy(bot.strategy,market.candles,at);
    if(!signal.side){await message(`Monitoring ${preset.timeframe}; waiting for a closed-candle signal.`);return;}
    const prior=await db.one('elitetrade_engine_orders',`bot_id=eq.${q(run.bot_id)}&candle_time=eq.${signal.candleTime}&select=id`);
    if(prior){await message('Signal already processed; waiting for a new candle.');return;}
    const plan=planTrade({bot,...market,side:signal.side,at});
    const dailyBudget=baseline.day_equity*(bot.daily_loss/100)-(baseline.day_equity-market.info.equity);
    const drawdownBudget=baseline.peak_equity*(bot.max_drawdown/100)-(baseline.peak_equity-market.info.equity);
    if(plan.estimatedRisk>Math.min(dailyBudget,drawdownBudget))throw new Error('Projected stop-loss risk exceeds remaining equity loss allowance.');
    const margin=await gateway.margin(account.gateway_id,plan);
    if(!Number.isFinite(margin?.margin)||margin.margin<0||margin.margin>market.info.freeMargin*.5)throw new Error('Required margin exceeds 50% of free margin.');
    // Refresh market/risk immediately before reserving the one-shot order.
    const refreshed=await gateway.market(account.gateway_id,bot.symbol,preset.timeframe);
    if(refreshed.positions.length||refreshed.orders.length){await message('Broker exposure changed; skipped signal.');return;}
    riskCheckpoint(baseline,refreshed.info,bot,Date.now());
    const freshPlan=planTrade({bot,...refreshed,side:signal.side,at:Date.now()});
    if(freshPlan.volume!==plan.volume||Math.abs(freshPlan.openPrice-plan.openPrice)>Math.abs(plan.openPrice-plan.stopLoss)*.05){await message('Price or risk changed; skipped signal.');return;}
    const freshDaily=baseline.day_equity*(bot.daily_loss/100)-(baseline.day_equity-refreshed.info.equity);
    const freshDrawdown=baseline.peak_equity*(bot.max_drawdown/100)-(baseline.peak_equity-refreshed.info.equity);
    if(freshPlan.estimatedRisk>Math.min(freshDaily,freshDrawdown))throw new Error('Projected loss allowance changed.');
    const freshMargin=await gateway.margin(account.gateway_id,freshPlan);
    if(!Number.isFinite(freshMargin?.margin)||freshMargin.margin<0||freshMargin.margin>refreshed.info.freeMargin*.5)throw new Error('Margin allowance changed.');
    receipt=await db.rpc('elitetrade_engine_reserve',{p_bot_id:run.bot_id,p_owner:owner,p_candle_time:signal.candleTime,p_request:freshPlan});
    if(!receipt)return;
    const result=await gateway.demoOrder(account.gateway_id,freshPlan,receipt);
    await db.update('elitetrade_engine_orders',`id=eq.${q(receipt)}`,{status:'confirmed',result});
    receipt=null;
    await message('Demo order confirmed by broker; monitoring protected position.');
  } catch(error) {
    // A timeout may have happened after broker acceptance: never retry an order.
    if(receipt)await db.update('elitetrade_engine_orders',`id=eq.${q(receipt)}`,{status:'unknown',result:{message:'Provider outcome requires manual reconciliation.'}}).catch(()=>{});
    await halt(receipt?'Order outcome unknown. Check broker positions and reconcile before restarting.':String(error.message).slice(0,240));
  } finally {
    await db.rpc('elitetrade_engine_lease',{p_account_id:run.account_id,p_owner:owner,p_release:true});
  }
}
export async function demoEngineTick({db,gateway}) {
  const runs=await db.query('elitetrade_engine_runs','enabled=eq.true&select=*&order=updated_at.asc&limit=20');
  for(const run of runs)await processDemoRun({db,gateway,run});
  await db.upsert('elitetrade_engine_heartbeat','on_conflict=id',{id:true,updated_at:time()});
  return {evaluated:runs.length};
}
