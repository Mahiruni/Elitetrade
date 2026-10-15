# EliteTrade SweepBreakout Experimental v1

This is a **new experimental EA with independently defined rules**. The original `Scalpin SS .ex5` could not be decoded into its source or a verified specification. This program is not a verified reconstruction of StopHunter Pro V5.3 and carries no profitability or win-rate claim.

## Exact new strategy

The default entry period is M1. At each new bar, the program considers:

1. The preceding 12 closed bars before the sweep, forming a high/low reference range.
2. The penultimate closed candle as the sweep candle. A potential buy requires its low to extend below the range low by more than 0.05 ATR and its close to return above that low. A potential sell uses the inverse high sweep and reclaim. A candle reclaiming both extremes is rejected.
3. The latest closed candle as confirmation. A buy requires a bullish close above the sweep candle's high plus 0.02 ATR; a sell requires a bearish close below the sweep low minus that buffer.
4. The optional trend filter is enabled by default: the last closed M15 close must be above its EMA 50 for buys, below for sells.

ATR uses 14 closed M1 bars by default. No current forming candle is used for the signal. A signal is eligible only during the next bar, with no more than 0.50 ATR distance between the entry quote and the confirmation close. The EA waits for an acceptable spread within that bar and does not force entries.

Initial stop is beyond the sweep/confirmation extreme by 0.15 ATR, enlarged if necessary for broker stop restrictions and rounded to broker tick size. Take profit is 2R from requested entry by default. The default spread allowance is 0.15 ATR. Optional sessions use **broker-server hours**, including overnight windows; the session filter is off by default. There is no news-calendar filter.

## Position sizing and controls

- Requested risk is 0.25% of account equity, with a default 0.10-lot cap and 10% budget reserve. The smaller remaining daily/peak loss allowance also caps a new trade. Estimated stop-loss risk is computed with `OrderCalcProfit` in account currency, then rounded down to the broker's volume step. A minimum lot above budget causes a skipped trade.
- A 2% daily equity-loss latch and 5% peak-equity drawdown latch block **new entries**. Daily baseline is the first equity observed by this EA on a broker-server day, not a reconstructed midnight balance. Peak is recorded since this account/magic's first observation. The guards observe account equity but do not close positions, protect unrelated trades, adjust for deposits/withdrawals, or guarantee a maximum realized loss.
- Budget estimates exclude exact future commissions, swaps, slippage, and gaps. The reserve is an allowance, not a guarantee. Market execution may not honor a requested deviation cap.
- Any existing position or pending order on the symbol, including a manual or unrelated trade, blocks a new entry. Only matching symbol/magic positions are managed. Use one dedicated terminal/account allocation per strategy; local guards are not distributed coordination between terminals.
- One attached EA instance per account/symbol/magic is allowed in a terminal. Entry attempts are recorded before submission and not repeated on the same candle after restart. Uncertain/PLACED/timeout responses block retries until a genuine matching entry deal is observed or the operator reconciles the state. Definite broker rejections permit future signals, but the failed candle is not retried.
- Breakeven begins at 1R plus 0.02 ATR and ATR trailing begins at 1.5R, trailing by 1.5 ATR. Stops tighten only; broker stop/freeze constraints apply. Netting accounts require a dedicated symbol: other actors can alter the shared netting position. Do not mix manual orders or other EAs with the same magic.

`InpEnableNewEntries=false` pauses entries while owned-position management continues. It does not close positions. Removing the EA stops its trailing management; existing broker SL/TP may remain. `InpAllowRealAccounts=false` blocks both entries and management on real accounts by default. That explicit opt-in exists for future use; real-account readiness has not been established.

Persistent keys begin `ESBX1.` in MT5 terminal global variables. They are scoped using hashes of account/server/magic and symbol. An uncertainty key ends `.uncertain`. Reconcile broker history, positions, and pending orders before clearing a lock. Do not reset a drawdown latch or change magic numbers to evade a risk limit. Global-variable persistence has terminal/platform limitations and is not server-side storage. Tester passes use in-memory state.

## Files and installation

- `EliteTrade_SweepBreakout_Experimental_v1.mq5`: standalone editable EA source, without additional include files, DLL imports, WebRequest calls, broker credentials, or external service dependencies.
- The corresponding `.ex5`, when a successful build is supplied, is the newly compiled executable. Verify `build-manifest.json` and `compile.log`; a source filename or an EX5 extension alone does not prove compilation.
- `.set`: a newly generated test preset reflecting this EA's defaults; it is not a recovered original preset.
- `Compile-EA.ps1`: Windows build script using the official MetaQuotes installer and MetaEditor. It requires a valid MetaQuotes installer signature and zero compiler errors/warnings. It never attaches the EA to a broker chart.
- `test_core.py`: compiles and tests the **exact portable functions extracted from the source** as C++. This checks core arithmetic/signal behavior; it is not a test of the complete MT5 execution lifecycle.

In a desktop MT5 terminal or Windows VPS, use File > Open Data Folder and put the EX5 in `MQL5/Experts`, refresh Navigator, and open Strategy Tester. If using the source, open it in MetaEditor and press F7 first. The official MT5 Android app cannot host this EA.

Test using the intended broker's exact symbol and real-tick data, record spread/commission/swap specifications, and match the intended account mode/deposit/leverage. Load the supplied test preset, inspect the defaults, and verify actual initialization, entries, exits, sizing, breakeven, trailing, daily/peak latches, rejected requests, restart behavior, and ambiguous outcome handling. The chart and Experts log explain why entries are waiting or blocked. Audit CSV files are written inside `MQL5/Files`; they contain trade identifiers and server timestamps, not passwords.

Use demo first. No broker backtest, forward test, original-EX5 behavior comparison, or performance validation has been performed unless separately recorded. The core test suite checks 22 named scenarios and 5,000 randomized rounding/volume cases. A successful MetaEditor build establishes compilation, not profitability or full runtime correctness.

## Primary technical references

- https://www.metatrader5.com/en/metaeditor/help/beginning/integration_ide
- https://www.metatrader5.com/en/terminal/help/start_advanced/installation
- https://www.mql5.com/en/docs/trading/ordercheck
- https://www.mql5.com/en/docs/trading/ordersend
- https://www.mql5.com/en/docs/globals/globalvariabletemp

