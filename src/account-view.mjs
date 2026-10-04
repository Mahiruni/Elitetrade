// Allowlist broker data before returning it to the authenticated owner.
export function accountDetails(snapshot) {
  const safe = {};
  if (['demo','real'].includes(snapshot.accountType)) safe.accountType=snapshot.accountType;
  if (Array.isArray(snapshot.positions)) safe.positions=snapshot.positions.slice(0,500).filter(p=>p && typeof p==='object' && typeof p.symbol==='string' && (typeof p.id==='string'||Number.isFinite(p.id))).map(p=>({
    id:String(p.id).slice(0,100),symbol:p.symbol.slice(0,100),type:String(p.type || '').slice(0,40),
    ...Object.fromEntries(['volume','openPrice','currentPrice','profit','stopLoss','takeProfit'].filter(k=>Number.isFinite(p[k])).map(k=>[k,p[k]]))
  }));
  return safe;
}
