# Verification status

This is an original experimental EA, not a decompiled/reconstructed EX5.

## Included executable checks
- C++ numeric tests compile the exact pure .mqh sizing functions used by the EA, with equivalent standard math shims.
- 500,017 assertions cover minimum-lot rejection, commission inclusion, maximum cap, valid volume steps, no upward rounding, tick price rounding and fixed-stop equity scaling.
- Preset test verifies all 59 baseline inputs and fast-preset coverage, plus unchanged risk, identity and protection defaults.
- Windows job downloads signed official MetaQuotes installer and checks compiler log for zero errors/warnings, presence of EX5 and SHA256.
- Shared rolling-window tests cover bid/ask confirmation, buy/sell signals, spread-only rejection, chop efficiency, quote age windows, gap resets, consumed-signal reset, bounded buffers and both directions within a minute.
- Gold symbol tests compile the exact metadata predicate used at initialization and reject wrong/unknown base or profit currency.
- Preset verification checks the separate gold magic and byte-equivalent risk/tick algorithms against the BTC implementation.
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

1. XAU symbol with minimum lot whose stop risk exceeds USD2.50: zero entries; explicit skip reason.
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

13. FAST preset on real ticks: entries are not restricted to the start of M1 bars; multiple attempts within a minute remain subject to fresh signal, flat position, cooldown, costs and risk.
14. Compare spread/cost assumptions at higher volatility; confirm skip panel reports minimum-lot risk rather than increasing exposure.

15. Broker XAUUSDm or GOLD alias with XAU/USD metadata: accepted; BTC, silver or gold/EUR metadata: rejected.
16. Simultaneous BTC/gold use: distinct identity and owned cleanup; no claim of one shared portfolio exposure budget.
