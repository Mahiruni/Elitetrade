# EliteTrade — Phase 3: Real-tick validation (research only)

**Status as of October 15, 2026:** Windows MetaEditor compiled our **independently authored** M1 sweep-reversal candidate into an EX5. **No genuine Strategy Tester run, broker real-tick history, demo fills, or profitability claims are available yet.** This package is a **test plan, reproducible configuration, and fail-closed capture evaluator**. It does NOT reproduce, decrypt, or authenticate `Scalpin SS.ex5`.

## What is actually complete

- `configs/real_ticks_execution.ini`: documented MT5 Strategy Tester command-line template; `Model=4` requests **every tick based on real ticks**. Do not assume tick data are available just because this setting is present.
- `configs/execution.set`: explicit test-order mode, `InpExecuteOrders=true`. The EA gates live accounts in source; test on a **dedicated demo terminal** anyway.
- `configs/signal_only.set`: non-trading baseline; expects decisions but **no deals**.
- `tools/evaluate_capture.py`: consumes the research EA's own `*-events.csv`, optional `*-decisions.csv`, and saved tester report plus a run manifest. It validates fields, source file hashes, order and timestamp consistency, episode completeness, and computes *net completed-episode returns* including recorded commission/swap. It **does not** conflate signal/request rows with fills.
- `examples/manifest.TEMPLATE.json`: run metadata placeholder; includes compiled EX5 fingerprint `16627b5419bd777662472479f4fed23f187ca6c3853e4352d0c01d0bc2168528`.
- `tests/`: synthetic-only test data; no broker markets are simulated.

## Run on Windows MT5 when available (Windows VPS is OK)

1. Use a dedicated **DEMO** MT5 instance connected to a trusted broker. Do **not** put demo passwords in the GitHub repository, tester `.ini`, or ZIP files; keep credentials entirely in the terminal's protected storage. No live trading is authorized for this research EA.
2. Copy the SHA256-verified EX5 into the terminal's **MQL5/Experts/EliteTradeResearch/** directory. Restart Navigator or refresh, confirm selected file name and compile hash. Copy `execution.set` into the terminal's **MQL5/Profiles/Tester/** directory and ensure inputs load exactly as specified. You may need to save the `.set` via MT5 GUI to ensure correct value syntax on your terminal build.
3. Change the **symbol to your broker's actual name** (e.g. `XAUUSDm` if it is not exactly `XAUUSD`) and adjust explicit in/out-of-sample intervals. Create `reports` folder in the terminal installation directory to match the `.ini` Report setting; the example dates 2026 Q1 are a historical **planning choice**, not tested coverage.
4. Synchronize broker tick history and M1 bars. In Strategy Tester, select **Every tick based on real ticks**, **M1**, fixed risk parameters and **demo** profile. Confirm broker/server, tick availability, data quality, actual first/end ticks, symbol digits, point value, stops level, spread distribution, commission and swap schedule. *Model=4 does not independently prove history is complete or genuine.*
5. Perform a **signal-only run first** using `signal_only.set` and verify **0 orders/deals**; then use `execution.set` in the **Strategy Tester only**, not on a live account. Run fixed in-sample and separate out-of-sample/forward intervals. For sensitivity, vary broker tick datasets, spread, execution delay and months, while preserving an immutable baseline. No forced-trade workaround.
6. Save the **actual Strategy Tester HTML report**, the **Tester Journal**, `*-events.csv`, and `*-decisions.csv`, plus finalized `manifest.json`. MQL5 `FILE_COMMON` records may appear under the common terminal files path or testing agent paths depending on how the terminal runs; confirm the real output location and never substitute manually invented rows. Ensure the captures include the *entire run* with complete position opens and closes.
7. Inspect the tester report separately for **reported max equity drawdown**, profit factor, modeling quality/data coverage and order/deal consistency. The Python tool calculates *realized-balance* drawdown only (closed-trade P&L), **never equity drawdown**. A reported **net profit factor from episodes** may differ from MetaTrader's own summary due to aggregation.
8. Only after receiving authenticated reference-run evidence, compare candidate against original EX5 on compatible feeds, settings and intervals using the existing Phase-2 verification comparator. There is **no reference behavioral equivalence claim** from Phase 3.

## CLI usage (Windows, Termux or any Python 3.10+)

```shell
python -m unittest discover -s tests -v
python tools/evaluate_capture.py --manifest manifest.json --events candidate-events.csv --decisions candidate-decisions.csv --tester-report actual-mt5-tester.htm --out evaluation.json
```

The evaluation exits nonzero on incomplete evidence, rejected data, or a **synthetic** fixture (synthetic outputs are always explicitly classified). The JSON output is informational, not proof of a real-tick provenance. If `--tester-report` is absent, the output is `INCOMPLETE_EVIDENCE` even if closed-deal statistics are available.

**Notes on interpretation:** The EA's `OnTradeTransaction()` logs deal events, including entry/exit cash changes. Missing commissions, swaps, fees, position truncation, grid/hedge interactions, broker-side edits, or alternative cash adjustments can make the cash summary differ from MT5 reports. The analyzer deliberately rejects reversals/unsupported entry types and incomplete positions rather than guessing. Decision logs alone do not establish fill performance.

## Why not run the tester blindly on GitHub Actions?

Our previous Windows cloud runner could **compile** without credentials or quote history. However, an MT5 Strategy Tester real-tick run depends on a configured broker/data source and downloaded M1 and tick history. CI cannot safely invent a broker feed or accept account secrets from a public pull request. This phase automates the **verification tooling**, not the real historical trading simulation.

## Sources

- Official MT5 command-line tester file: https://www.metatrader5.com/en/terminal/help/start_advanced/start
- Broker tick/M1 history and real-tick model: https://www.metatrader5.com/en/terminal/help/algotrading/test_preparation
- Real versus generated ticks and variable spreads: https://www.metatrader5.com/en/terminal/help/algotrading/tick_generation