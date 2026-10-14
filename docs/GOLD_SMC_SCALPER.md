# EliteTrade — Gold SMC Scalper Pro v3

## What is actually integrated

- Website: authenticated **Gold SMC Scalper** navigation entry at `/gold-smc`, true-black/gold research dashboard and user-initiated verified MT5 preview. An optional 60-second **read-only** polling loop runs only while this page is open and visible.
- Android: native Gold SMC Scalper item in the hamburger and Account navigation; authenticated native screen makes the same read-only preview request.
- API: `POST /api/bots/:id/preview` with `{"goldSmc":true}`. Server enforces user ownership, membership, connected MT5 account, MetaApi provider availability and per-user rate limits. Retrieves actual MT5 quote, symbol specification, M15 and M5 candles from the existing `poiMarket` gateway. Returns `goldSmc` object; it NEVER calls the order gateway.
- MT5 EA: `mt5/XAUUSD_SMC_Scalper_Pro_v3.mq5` for local MT5 terminal. **Not installed or running on the web server.** Its trade execution is an independent, opt-in MT5 capability and is not connected to EliteTrade's cloud demo worker.

## Strategy / risk gates

Research engine and EA share the intent of the strategy, but are **two independent implementations** and are not yet equivalence-tested against the same market data. The research view checks a closed M15 EMA50 bias plus recent structure, and on closed M5 candles requires: liquidity sweep against an earlier eight-bar pool, subsequent close beyond earlier structure with above-average displacement, then a three-bar FVG overlapping the 61.8–78.6% retracement and a subsequent rejecting candle. It also checks spread (25 points), ATR (40–350 points) and London/New York UTC windows. It rejects missing, stale, duplicated, malformed or interrupted broker candles, suspicious account types and invalid quote/specifications. BUY or SELL means **research alignment only**, not an executable trade.

The EA adds:
- Default `InpEnableNewEntries=false`. Attach to XAUUSD broker symbols only; **hedging account only** (netting mode is rejected because the partial-close implementation is hedging-specific).
- Risk sizing via `OrderCalcProfit` in account currency; skips minimum-lot trades that exceed the budget instead of silently upsizing. Checks available margin, stops, spread, ATR and exposure.
- Persistent, UTC-day daily-equity-baseline and drawdown halt using MT5 terminal Global Variables. These are terminal-local: multiple terminals, other EAs, manual activity and broker-account changes require independent account-wide risk management.
- Approximately 70% TP1 close at 1R and 30% runner at 2.5R, breakeven and ATR trailing where permitted. If broker minimum lot size makes a partial close impossible, the position uses breakeven protection instead. An uncertain partial-close state is never blindly retried; **manually reconcile** such a position.
- Broker return-code checking rather than trusting `CTrade`'s boolean. Economic-calendar USD high-impact news block enabled by default; missing calendar data blocks new entries.

## Safety and validation requirements

The claimed “high win rate” is **unproven**. Nothing here has been verified profitable. Backtest across years, session DST and broker timezones, broker point conventions (2/3 decimal XAUUSD), commission, spread, news, slippage, variable liquidity, stop/freeze levels and edge-case lot increments. Conduct walk-forward and forward demo validation on the exact target broker. Do not deploy live until MetaEditor compilation, review of MT5 trade records, and paper/demo equivalence with the web read-only signals pass.

The MT5 Economic Calendar uses trade-server time, while sessions are configured in UTC. Strategy Tester calendar availability can vary; fail-closed news protection may prevent historical entries unless explicitly disabled during backtests, in which case the backtest is not news-protected.

### How to use the website

1. Sign in to EliteTrade, connect an MT5 account and confirm that status is `connected`.
2. Under **Trading bots**, configure a bot symbol of `XAUUSD` or the broker's XAUUSD suffix. This does *not* enable automated SMC trading.
3. Open hamburger → **Gold SMC Scalper** → **Analyze MT5**. If broker data are unavailable, the screen stays in an unavailable/WAIT state. Optional 60-second auto scan is for research **only**.
4. For native APK, use a release that contains the Gold SMC menu. Existing installed APKs do not acquire this feature until a verified signed update is published.

### MT5 EA installation

1. Open `mt5/XAUUSD_SMC_Scalper_Pro_v3.mq5` in MetaEditor on a Windows MT5 installation.
2. Compile **in MetaEditor** and resolve broker/terminal build differences. CI for this repository does not compile MQL5.
3. Test with **visual mode / every tick based on real ticks** and a non-funded MT5 demo hedging account. Leave `InpEnableNewEntries=false` until validated.
4. Ensure Algo Trading permissions, correct broker symbol, server news calendar and margin configuration; turn on entry only in a demo validation session.
5. Inspect Experts/Journal and trade history after restart, partial closes, stop modifications, connectivity failures and daily loss lockouts.

## Production security boundary

The website never sends an order from Gold SMC analysis. Cloud `demo-engine.mjs` retains its existing three authorized trend/scalping/breakout strategies and cannot be started by this research page. MT5 EA actions originate locally in the MT5 terminal, subject to broker and user permissions. No provider tokens or credentials are sent to the research frontend.

## Verification

Run `npm ci && npm run build && npm run check && npm test`. Pull-request checks additionally run Chromium browser regression and Android debug assembly. Actual MT5 compilation and trade simulation remain manual release gates.
