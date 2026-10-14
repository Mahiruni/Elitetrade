// web/claude-pro/model.ts
var DURATIONS = [3, 5, 15, 60, 180, 300, 1800, 3600];
var PRESETS = {
  sonnet: { name: "Sonnet 5", subtitle: "Balanced" },
  opus: { name: "Opus 5.5", subtitle: "Deep focus" },
  fable: { name: "Fable 5.1", subtitle: "Like a pro" }
};
var ASSETS = [
  ["EUR/GBP OTC", "Euro / British Pound", "\u{1F1EA}\u{1F1FA}", "\u{1F1EC}\u{1F1E7}"],
  ["EUR/USD OTC", "Euro / US Dollar", "\u{1F1EA}\u{1F1FA}", "\u{1F1FA}\u{1F1F8}"],
  ["USD/JPY OTC", "US Dollar / Japanese Yen", "\u{1F1FA}\u{1F1F8}", "\u{1F1EF}\u{1F1F5}"],
  ["AUD/USD OTC", "Australian Dollar / US Dollar", "\u{1F1E6}\u{1F1FA}", "\u{1F1FA}\u{1F1F8}"],
  ["USD/CHF OTC", "US Dollar / Swiss Franc", "\u{1F1FA}\u{1F1F8}", "\u{1F1E8}\u{1F1ED}"],
  ["GBP/USD OTC", "British Pound / US Dollar", "\u{1F1EC}\u{1F1E7}", "\u{1F1FA}\u{1F1F8}"],
  ["EUR/JPY OTC", "Euro / Japanese Yen", "\u{1F1EA}\u{1F1FA}", "\u{1F1EF}\u{1F1F5}"],
  ["AUD/JPY OTC", "Australian Dollar / Japanese Yen", "\u{1F1E6}\u{1F1FA}", "\u{1F1EF}\u{1F1F5}"],
  ["GBP/JPY OTC", "British Pound / Japanese Yen", "\u{1F1EC}\u{1F1E7}", "\u{1F1EF}\u{1F1F5}"],
  ["EUR/CHF OTC", "Euro / Swiss Franc", "\u{1F1EA}\u{1F1FA}", "\u{1F1E8}\u{1F1ED}"],
  ["USD/CAD OTC", "US Dollar / Canadian Dollar", "\u{1F1FA}\u{1F1F8}", "\u{1F1E8}\u{1F1E6}"],
  ["NZD/USD OTC", "New Zealand Dollar / US Dollar", "\u{1F1F3}\u{1F1FF}", "\u{1F1FA}\u{1F1F8}"],
  ["Apple", "Apple \xB7 sample stock", "A", ""],
  ["Tesla", "Tesla \xB7 sample stock", "T", ""],
  ["NVIDIA", "NVIDIA \xB7 sample stock", "N", ""],
  ["Microsoft", "Microsoft \xB7 sample stock", "M", ""]
];
var DEFAULTS = { mode: "demo", asset: "EUR/GBP OTC", duration: 5, preset: "fable", market: "OTC", botId: "" };
var durationLabel = (seconds) => seconds < 60 ? `${seconds} sec` : seconds < 3600 ? `${seconds / 60} min` : "1 hour";
var durationWords = (seconds) => seconds < 60 ? `${seconds} seconds` : seconds < 3600 ? `${seconds / 60} minute${seconds === 60 ? "" : "s"}` : "1 hour";
var countdown = (expiresAt, now) => Math.max(0, Math.ceil((expiresAt - now) / 1e3));
var formatCountdown = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
var cycleDelay = (mode) => mode === "mt5" ? 6e4 : 25e3;
var readingTitles = (prefs) => ["Trend \xB7 1h", "Support / resistance", `Move over ${durationLabel(prefs.duration)}`, "Momentum", "Session", "EMA 50/200", "Price at level", "RSI \xB7 14"];
function restorePreferences(raw) {
  try {
    const value = JSON.parse(raw || "null");
    if (!value || typeof value !== "object") return { ...DEFAULTS };
    return {
      ...DEFAULTS,
      // A reload never resumes an authenticated connection or automation.
      asset: ASSETS.some((a) => a[0] === value.asset) ? value.asset : DEFAULTS.asset,
      duration: DURATIONS.includes(value.duration) ? value.duration : DEFAULTS.duration,
      preset: Object.hasOwn(PRESETS, value.preset) ? value.preset : DEFAULTS.preset,
      market: value.market === "Stock" ? "Stock" : "OTC"
    };
  } catch {
    return { ...DEFAULTS };
  }
}
function demoSignal(prefs, sequence = 0, now = Date.now()) {
  let hash = sequence;
  for (const char of prefs.asset) hash = hash * 31 + char.charCodeAt(0) | 0;
  const up = Math.abs(hash) % 2 === 0;
  const directional = (title, detail) => ({ title, detail, available: true, tone: up ? "up" : "down" });
  return {
    id: `demo-${now}-${sequence}`,
    instrument: prefs.asset,
    mode: "demo",
    duration: prefs.duration,
    preset: prefs.preset,
    direction: up ? "higher" : "lower",
    generatedAt: now,
    expiresAt: now + 2e4,
    note: "Sample readings and direction. No broker order is sent.",
    readings: [
      directional("Trend \xB7 1h", up ? "Up" : "Down"),
      { title: up ? "Support" : "Resistance", detail: up ? "2 pips below" : "1 pip above", available: true },
      directional(`Move over ${durationLabel(prefs.duration)}`, up ? "+1 pip" : "\u22121 pip"),
      { title: "Momentum", detail: up ? "Strong" : "Weak", available: true },
      { title: "Session", detail: prefs.market === "OTC" ? "Synthetic OTC sample" : "Sample stock session", available: true },
      directional("EMA 50/200", up ? "Price above" : "Price below"),
      directional("Price at level", up ? "Bounce up" : "Bounce down"),
      { title: "RSI \xB7 14", detail: up ? "42 \xB7 below overbought" : "67 \xB7 below overbought", available: true }
    ]
  };
}
var valid = (n) => typeof n === "number" && Number.isFinite(n);
function ema(prices, period) {
  if (prices.length < period) return null;
  let average = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (const price of prices.slice(period)) average += (price - average) * 2 / (period + 1);
  return average;
}
function rsi(prices) {
  if (prices.length < 15) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= 14; i++) {
    const delta = prices[i] - prices[i - 1];
    gain += Math.max(delta, 0);
    loss += Math.max(-delta, 0);
  }
  gain /= 14;
  loss /= 14;
  for (let i = 15; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    gain = (gain * 13 + Math.max(delta, 0)) / 14;
    loss = (loss * 13 + Math.max(-delta, 0)) / 14;
  }
  return loss === 0 ? gain === 0 ? 50 : 100 : 100 - 100 / (1 + gain / loss);
}
function brokerSignal(prefs, bot, preview, now = Date.now()) {
  const quotedAt = Date.parse(preview.updatedAt || "");
  if (!Number.isFinite(quotedAt) || quotedAt > now + 5e3 || quotedAt < now - 6e4) throw new Error("Broker quote is stale or missing. Refresh the MT5 connection.");
  if (!["demo", "real"].includes(preview.accountType || "")) throw new Error("The broker account type could not be verified.");
  const minutes = /^\d+m$/.test(preview.timeframe || "") ? Number(preview.timeframe.slice(0, -1)) : 0;
  const bars = (preview.candles || []).filter((c) => c && Number.isFinite(Date.parse(c.time)) && [c.open, c.high, c.low, c.close].every((n) => valid(n) && n > 0) && c.high >= Math.max(c.open, c.close, c.low) && c.low <= Math.min(c.open, c.close) && minutes > 0 && Date.parse(c.time) + minutes * 6e4 <= now).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  const prices = bars.map((c) => c.close), last = bars.at(-1);
  const groups = /* @__PURE__ */ new Map();
  for (const bar of bars) {
    const hour = Math.floor(Date.parse(bar.time) / 36e5);
    groups.set(hour, [...groups.get(hour) || [], bar]);
  }
  const hours = [...groups.entries()].filter(([hour, group]) => minutes > 0 && 60 % minutes === 0 && group.length === 60 / minutes && Date.parse(group[0].time) === hour * 36e5 && group.every((bar, i) => !i || Date.parse(bar.time) - Date.parse(group[i - 1].time) === minutes * 6e4)).sort((a, b) => a[0] - b[0]);
  const read = (title, detail, available = true, tone) => ({ title, detail, available, tone });
  const change = last ? last.close - last.open : 0;
  const price = (n) => n.toLocaleString("en", { maximumFractionDigits: 6 });
  const levelBars = bars.slice(-21, -1), support = Math.min(...levelBars.map((b) => b.low)), resistance = Math.max(...levelBars.map((b) => b.high));
  const ema50 = ema(prices, 50), ema200 = ema(prices, 200), strength = rsi(prices);
  const side = preview.signal?.side;
  const direction = bars.length >= 15 && preview.order && (side === "buy" || side === "sell") ? side === "buy" ? "higher" : "lower" : "none";
  const trendDelta = hours.length >= 2 ? hours.at(-1)[1].at(-1).close - hours.at(-2)[1].at(-1).close : null;
  return {
    id: `mt5-${bot.id}-${quotedAt}`,
    instrument: bot.symbol,
    mode: "mt5",
    duration: prefs.duration,
    preset: prefs.preset,
    direction,
    generatedAt: now,
    expiresAt: Math.min(now + 2e4, quotedAt + 6e4),
    timeframe: preview.timeframe,
    note: `${preview.accountType === "demo" ? "Demo MT5" : "Live MT5"} strategy preview. ${preview.riskMessage || "No qualifying risk-checked entry."} No order is sent by this analysis.`,
    readings: [
      trendDelta === null ? read("Trend \xB7 1h", "Insufficient complete hourly groups", false) : read("Trend \xB7 1h", trendDelta > 0 ? "Up" : trendDelta < 0 ? "Down" : "Flat", true, trendDelta > 0 ? "up" : "down"),
      bars.length < 21 ? read("Support / resistance", "Requires 21 closed candles", false) : read("Support / resistance", `${price(support)} / ${price(resistance)}`),
      read(`Move \xB7 ${preview.timeframe || "candle"}`, last ? `${change >= 0 ? "+" : ""}${price(change)}` : "Closed candle unavailable", !!last, change >= 0 ? "up" : "down"),
      prices.length < 6 ? read("Momentum", "Requires six closed candles", false) : read("Momentum", `${((prices.at(-1) / prices.at(-6) - 1) * 100).toFixed(3)}% \xB7 five candles`),
      read("Session", last ? `${new Date(last.time).getUTCHours()}:00 UTC \xB7 hours unverified` : "Session unavailable", !!last),
      ema50 === null || ema200 === null ? read("EMA 50/200", "Requires 200 closed candles", false) : read("EMA 50/200", ema50 > ema200 ? "Bullish alignment" : "Bearish alignment", true, ema50 > ema200 ? "up" : "down"),
      bars.length < 21 || !last ? read("Price at level", "Insufficient candle history", false) : read("Price at level", last.close > resistance ? "Above resistance" : last.close < support ? "Below support" : "Inside recent range"),
      strength === null ? read("RSI \xB7 14", "Requires 15 closed candles", false) : read("RSI \xB7 14", `${strength.toFixed(1)} \xB7 ${strength > 70 ? "overbought" : strength < 30 ? "oversold" : "neutral"}`)
    ]
  };
}
export {
  ASSETS,
  DEFAULTS,
  DURATIONS,
  PRESETS,
  brokerSignal,
  countdown,
  cycleDelay,
  demoSignal,
  durationLabel,
  durationWords,
  formatCountdown,
  readingTitles,
  restorePreferences
};
