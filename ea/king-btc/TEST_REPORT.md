# Verification status

This is an original experimental EA, not a decompiled/reconstructed EX5.

## Included executable checks
- C++ numeric tests compile the exact pure .mqh sizing functions used by the EA, with equivalent standard math shims.
- 500,017 assertions cover minimum-lot rejection, commission inclusion, maximum cap, valid volume steps, no upward rounding, tick price rounding and fixed-stop equity scaling.
- Preset test verifies all 52 input names/defaults against source.
- Windows job downloads signed official MetaQuotes installer and checks compiler log for zero errors/warnings, presence of EX5 and SHA256.
- Actual run results are in GitHub Actions; BUILD_REPORT.md is created only on successful compilation.

These checks do not execute the EA event loop in MT5. Arithmetic was exercised outside the MQL runtime.

## Still unverified in a broker terminal
- Broker-specific symbol properties, order acceptance and execution.
- Cashflow/protection accounting with real history.
- Restart persistence with active broker exposure.
- Netting foreign-deal behavior.
- Latency, quote/feed failure, partial fills, rejection recovery.
- Historical and out-of-sample profitability, win rate, expectancy, profit factor and drawdown.
- Forward demo operation.

No historical trade count or performance statistic has been invented. All numeric strategy defaults are hypotheses.

## Required manual/terminal acceptance cases

1. BTC symbol with minimum lot whose stop risk exceeds USD2.50: zero entries; explicit skip reason.
2. Different tick sizes/volume steps: valid prices/volume; exact planned risk never above budget.
3. Commission allowance increase: volume cannot increase; entry may become ineligible.
4. Restart after day-loss latch: no new entry until next configured day.
5. Restart after drawdown/fault latch: no new entry until explicit reset while flat.
6. Deposit/withdrawal: baselines shift; latched locks remain latched.
7. Disabled Algo Trading/disconnection: entries blocked; exits log inability; SL/TP persist at broker.
8. Timeout/uncertain entry: consume setup; do not resubmit; review latch.
9. Foreign netting/manual deal: EA does not modify/close mixed position.
10. Trailing then restart: original R remains unchanged.
11. Many ticks on same candle and duplicate EA instance: at most one submitted setup attempt.
12. Terminal off over day rollover: new day baseline clearly sampled at first return, not fictitious midnight data.
