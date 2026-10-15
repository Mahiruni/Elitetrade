# EliteTrade experimental 15-Second Scalper (S15)

**Development only. Do not switch the currently armed production M1 bot.**

## What it does
- Optional strategy \`scalping-s15\`, EMA 3/6 with a same-direction
  **closed-15-second bar** momentum condition.
- Produces 15-second OHLC bars from **actual MetaApi MT5 historical tick
  records**. The provider does not offer a native \`15s\` candle timeframe.
- Rejects absent, stale, future, invalid, too sparse, or gapped tick data.
  It does **not** synthesize missing candles or manufacture an entry.
- Read-only preview uses historical ticks and never sends an order.
- Production trade evaluation, if later approved, still requires verified
  MT5 DEMO mode, broker account ownership, fresh quote/specification,
  existing-risk checkpoint, protected SL/TP, exposure, spread, margin,
  one-shot DB receipt, deduplicated candle, and broker order confirmation.
- If S15 is selected for an already armed DEMO run, the trusted backend
  indicates a 15-second polling interval; other strategies remain 45 sec.
  Android cannot run indefinitely in background and may be stopped by OS.

## Provider limitations and failure behavior
- MetaApi historical ticks REST endpoint:
  \`GET /users/current/accounts/:id/historical-market-data/symbols/:symbol/ticks?limit=1000\`
  on the **market-data API** hostname for the account's region.
  Source: https://metaapi.cloud/docs/client/restApi/api/retrieveMarketData/readHistoricalTicks/
- The endpoint supports MT5, not MT4. A response can take minutes in
  cases where MetaApi/terminal must download market data.
- 1000 latest ticks may span less than the ~2+ minutes of 15-second
  candle history needed, especially for active XAUUSD markets. S15 will
  reject insufficient history rather than fill gaps or use unverified data.
- MetaApi rate limits or insufficient account provider capacity can
  block rapid polling; no gain in signal frequency is guaranteed.
- More entries mean higher spread/fees and possible faster losses;
  no verified win-rate or profitability evidence is available.

## Safe release gates
1. Validate unit, browser, Android and real SQL rehearsal CI.
2. Rehearse S15 constraint migration in isolated Supabase staging and
   verify an approved rollback and backup. No protected RPC replacements.
3. Verify real MT5 DEMO tick availability/latency over several sessions,
   and test all symbol-specific spread/slippage/lot-limit conditions.
4. Backtest and forward-test paper or DEMO execution; establish a
   sensible max-order/day and cooldown policy before production activation.
5. Separately approve deployment, then stop the existing M1 bot and
   switch it manually. Never auto-arm the bot or force a broker order.

## Scope
No MetaApi token changes, no real-account orders, no new payment or
database provider. This branch does not change the live bot, submit a
trade, or deploy its code or migration.
