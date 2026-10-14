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
  if (complete.length < conf.min) throw new Error(key.toUpperCase() + ': insufficient closed candles (' + complete.length + '/¶»§q«^