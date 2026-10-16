import {createHash} from 'node:crypto';
import {resolveMt5ServerProfile} from './elitebridge-broker-server-profiles.mjs';

// Shared trust boundary: use an explicit account binding, not just a server label.
export function validateGatewaySnapshot(data,binding,clock=Date.now) {
  const profile=resolveMt5ServerProfile(binding);
  const fail=()=>{throw Error('Gateway snapshot identity or data invalid');};
  const number=x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<=1e12;
  const fresh=value=>{const age=clock()-Date.parse(value);return typeof value==='string'&&Number.isFinite(age)&&age>=-2000&&age<=30000;};
  if(profile.mode!=='demo'||typeof binding.login!=='string'||!/^[1-9][0-9]{0,15}$/.test(binding.login))fail();
  if(!data||data.authenticated!==true||data.brokerConnected!==true||data.platform!=='mt5'||
    String(data.broker).toLowerCase()!==profile.broker||data.server!==profile.server||data.mode!==profile.mode||
    data.accountId!==binding.accountId||data.loginDigest!==createHash('sha256').update(binding.login).digest('hex')||
    data.readOnly!==true||data.tradingEnabled!==false||!fresh(data.observedAt))fail();
  if(!['balance','equity','margin','freeMargin','floatingProfit'].every(k=>number(data[k]))||data.margin<0||
    !/^[A-Z]{3,8}$/.test(data.currency)||!Array.isArray(data.positions)||data.positions.length>100||
    data.openPositionCount!==data.positions.length)fail();
  const seen=new Set();
  const positions=data.positions.map(p=>{
    if(!p||typeof p.positionKey!=='string'||!/^[a-f0-9]{24}$/.test(p.positionKey)||seen.has(p.positionKey)||
      typeof p.symbol!=='string'||!/^[A-Za-z0-9._-]{3,30}$/.test(p.symbol)||!['buy','sell'].includes(p.side)||
      !['volume','entryPrice','currentPrice','stopLoss','takeProfit','profit','swap'].every(k=>number(p[k]))||
      p.volume<=0||p.entryPrice<=0||p.currentPrice<=0||p.stopLoss<0||p.takeProfit<0)fail();
    seen.add(p.positionKey);
    return Object.fromEntries(['positionKey','symbol','side','volume','entryPrice','currentPrice','stopLoss','takeProfit','profit','swap'].map(k=>[k,p[k]]));
  });
  let quote=null;
  if(data.quote!==null){
    const q=data.quote;
    if(!q||q.symbol!==binding.symbol||!number(q.bid)||!number(q.ask)||q.bid<=0||q.ask<q.bid||!fresh(q.observedAt))fail();
    quote={symbol:q.symbol,bid:q.bid,ask:q.ask,observedAt:q.observedAt};
  }
  return {accountId:binding.accountId,broker:profile.broker,server:profile.server,mode:profile.mode,
    observedAt:data.observedAt,balance:data.balance,equity:data.equity,currency:data.currency,
    margin:data.margin,freeMargin:data.freeMargin,floatingProfit:data.floatingProfit,
    positions,openPositionCount:positions.length,quote,marketState:quote?'fresh':'unavailable-or-stale',
    brokerConnected:true,brokerAuthenticated:true,brokerTradeAllowed:data.brokerTradeAllowed===true,
    tradingEnabled:false,readOnly:true,source:'authenticated-cloud-gateway'};
}
