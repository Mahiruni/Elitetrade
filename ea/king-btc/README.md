# King of Scalper BTC — experimental MT5 EA

Original BTCUSD M1 Expert Advisor, version 1.10. Designed for Strategy Tester and demo evaluation. There is no measured win rate, profitability claim, or historical backtest result in this package.

## Install

1. Download the delivery ZIP and extract it.
2. In MT5 for Windows choose File > Open Data Folder.
3. Create MQL5/Experts/King_of_Scalper_BTC and copy the EX5 there.
4. Keep the MQ5 and King_BTC_Risk.mqh together if editing/compiling.
5. Refresh Navigator > Expert Advisors.
6. Open your broker's actual BTCUSD chart (suffixes are accepted) and select M1.
7. Attach the EA, load King_of_Scalper_BTC_Demo.set, and allow Algo Trading.
8. Begin with a USD 1,000 DEMO account. Input monetary amounts use ACCOUNT CURRENCY, not automatic USD conversion.
9. Check Experts and Journal. The EA waits for the next completed M1 candle after attachment.

If EX5 is unavailable, open MQ5 in MetaEditor with the MQH beside it and press F7. Confirm zero errors/warnings. MetaEditor creates EX5 beside MQ5.

Android MT5 cannot execute an EA. Keep Windows MT5 running and connected, or use a suitable Windows VPS.

## Actual entry rules

All indicator/candle decisions use completed bars.

Default mode:
- Direction is M5 EMA20 above/below EMA50, sampled at shift 1.
- Momentum is M1 close[1] minus close[4], requiring at least 0.15 ATR in the direction.
- Pullback bar is M1 bar[2]. For a buy its low must touch EMA20 + 0.20 ATR and its close must be at/above EMA20. Sells reverse this condition.
- Confirmation bar[1] must close above the maximum high of bars[2..6] for buys, or below their minimum low for sells, with a directional candle body.
- Entry is a market order during the first 20 server seconds of the next M1 bar, subject to all risk/cost checks.
- In baseline candle mode: one submitted attempt per setup bar. A rejected attempt is not retried on that setup. Tick mode uses a consumed quote window plus cooldown instead.
- One symbol position or pending order of ANY owner blocks a new entry.

Alternative rolling tick mode (v1.10):
- Enable InpTickFlow to evaluate incoming changed bid/ask quotes continuously; this mode does not wait for the next M1 close or three closed M1 momentum bars.
- Uses a rolling 3-second window, a minimum 250ms observed span, and directional confirmations.
- Both bid and ask must move in the same net direction, with sufficient net movement and directional efficiency; spread-only changes are rejected.
- Minimum movement is the maximum of 2 symbol ticks, 0.04 times completed-M1 ATR, and the configured spread multiplier.
- M5 EMA trend filtering is optional. The new FAST demo preset disables it to permit either direction.
- The rolling window is consumed before an order attempt. It warms from new quotes after an attempt or position exit; gaps and out-of-order quotes reset it.
- A millisecond setup identity replaces the one-attempt-per-M1 restriction in this mode.
- Same one-position, cost, margin, loss, drawdown and risk controls. No independent second strategy.
- MT5 may coalesce NewTick events while a handler is busy. This EA evaluates quotes received through OnTick; it cannot guarantee observing or trading every market movement.

No pending-order grid is created. Existing orders with this symbol/magic are blocked from further entries and canceled if stale or protection triggers. This is a deliberate one-entry baseline; there is no averaging, martingale or recovery sizing.

## Inputs in screen order

### 1. Order settings
- Auto risk: true.
- Risk: 0.25% of current equity per setup.
- Fixed lot: 0.01 (used only if AutoRisk=false, still capped by risk budget).
- Max lot: 0.10. This is a ceiling; it does not force that size.
- Stop: 1.50 ATR(14), widened if required by broker stop/freeze limits.
- Target: 1.50 times the final initial stop distance.
- Round-trip commission per lot: 0 ACCOUNT CURRENCY by default. Enter your broker's actual amount. Zero is an explicit assumption, not a detected zero-cost account.
- Slippage allowance: 3 symbol ticks for risk calculation. Actual slippage can be greater.

### 2. Breakeven
Enabled at 1R, where R is the original fill-to-stop price distance.
The stop covers configured commission plus slippage allowance when broker restrictions permit. Spread is already reflected by entry-versus-exit prices. Swap is not forecast.

### 3. Trailing
Starts at 1.25R with 1 ATR distance. Stops only tighten, respecting tick size and broker restrictions. Modifications are throttled to once per 3 seconds.

### 4. TP hunt
Disabled. Optional tighter 0.75 ATR trail beginning at 1.40R. Experimental; compare separately.

### 5. Entry/order management
Setup expires at 20 seconds. Stale same-magic pending orders expire at 60 seconds. No new pending orders are created.

### 6. Market structure
Swing 5; momentum 3; ATR14; M5 EMA20/50; M1 EMA20 pullback.
Absolute ATR price floor/ceiling are disabled at zero; the spread/ATR filter still applies.

### 7. Account protection
- Daily loss: 20 account-currency units (USD20 only on a USD account).
- Maximum drawdown: 5%, from sampled account equity high-water mark.
- Daily target: disabled.
- Close on protection: true, for this EA's owned exposure only.
- Day boundary: 00:00 broker server time.
- Reset token: change to a new integer only after reviewing the cause and ensuring no owned positions/orders remain.

Protection uses ACCOUNT equity, so other trading can trigger closure of this EA's exposure. The EA never intentionally closes unrelated trades.

Daily equity baseline is sampled on first initialization or first observation after the configured reset time. It is not reconstructed historical midnight equity. During terminal downtime there are no samples. Existing SL/TP remain at the broker; automatic EA management is unavailable.

Daily loss/target latches clear at the next observed broker-day boundary. A separate pending-exit latch survives rollover until owned exposure is confirmed gone. Drawdown and execution-fault latches persist until an explicit token change while flat. Deposits do not clear a latch.

BALANCE/CREDIT/BONUS deal flows shift both day baseline and high-water equity to avoid treating cash transfers as trading profit. Commissions, swap, fees, and ordinary trade P/L remain in equity performance. CORRECTION deals cause a review lock because their meaning is ambiguous.

State is terminal-local and keyed by account, server, symbol and magic. It survives EA/terminal restarts. MT5 terminal globals expire after four weeks without access; deleting/moving the terminal data or changing symbol/magic creates a different state namespace. Do not change magic/symbol to bypass protection. This EA is intended to be the only KingBTC instance on a dedicated symbol/account; terminal-local coordination cannot lock a second PC.

### 8. General
- Live entry: disabled by default; demo/test permitted.
- Entry cooldown: 60 seconds.
- Maximum daily submitted entry attempts: 20. Rejections count; partial fills do not count as extra attempts.
- Allowed deviation: 50 broker points. This is separate from the slippage risk allowance.
- Spread <= 0.15 ATR.
- Estimated spread + slippage allowance + commission <=20% of gross target.
- Account used margin after entry <=10% of equity; check free margin too.
- Quote age <=5 seconds.
- Optional session uses minutes after midnight in broker SERVER time; equal endpoints mean all day; overnight intervals supported.
- Unique default magic: 77101801.

### 9. Tick flow
Disabled in the baseline preset. When enabled, it uses the rolling quote window described above. Defaults: 3000ms window, 250ms minimum span, 3 confirmations, 0.04 ATR minimum move, 1.25 spread multiplier, 0.65 efficiency, optional M5 filter enabled, 3-second rearm.

## FAST demo preset: what changed

Load King_of_Scalper_BTC_Fast_Demo.set in the EA Inputs or Strategy Tester. Attaching the new EX5 without loading this preset retains conservative defaults.

- Tick mode ON; 2 directional observations after the initial quote.
- 3-second rolling window; minimum observed span 250ms.
- No M5 alignment or completed-M1 entry gate; completed-M1 ATR is still required.
- Move >= max(0.04 ATR, 1.0 spread, 2 ticks); efficiency >=0.60.
- Minimum interval between submitted attempts 5 seconds; fresh-window rearm 3 seconds after an observed exit.
- Daily attempt ceiling 200 (not a target or guaranteed number).
- Initial SL 1 ATR; target 1.20R.
- Breakeven 0.80R; trail starts 0.90R at 0.60 ATR; modification interval 1 second.
- Spread ceiling 0.25 ATR; estimated cost <=25% of gross target.
- Same 0.25% risk, 0.10 lot ceiling, 20 account-currency daily loss and 5% drawdown limit.
- Live entries remain disabled by default.
- Same magic and persistent protection state. Loading this preset never resets a lock or daily count.
- One symbol position/pending order at a time. New signals wait for that exposure to end.

This preset may submit more trades; it has no validated win rate or positive expectancy. High volatility may make minimum lot risk exceed the budget; the panel displays the dollar calculation instead of forcing an entry.

## Upgrade from v1.00

Remove the old EA from the chart, copy the new EX5, and attach v1.10 on BTCUSD M1. Load the FAST demo preset. Do not run both versions or a manual BTC position simultaneously. Existing owned positions retain original risk records; the update does not reset protection. The first v1.10 initialization migrates persisted attempt timestamps from seconds to milliseconds.

## Automatic sizing and compounding

The EA calculates account-currency loss at the final stop using OrderCalcProfit and the broker's actual minimum reference volume. It includes adverse entry allowance plus configured commission, floors volume to step, and verifies exact loss and margin.

Risk budget is the smallest of:
- 0.25% of current equity;
- remaining configured daily loss allowance;
- remaining equity distance to the drawdown threshold.

At a fixed stop/cost structure:
- Equity 1000 -> budget 2.50.
- Equity 1200 -> budget 3.00.
- Equity 1500 -> budget 3.75.
- Equity 2000 -> budget 5.00.

If the minimum valid BTC volume exceeds the budget, NO trade occurs. A wider ATR stop can reduce volume even while equity grows. Fixed-lot mode never bypasses the percentage budget.

Stops and thresholds cannot guarantee a maximum realized loss: gaps, slippage, disconnection, broker rejection or disabled Algo Trading can prevent the intended exit. A post-fill risk violation requests a protection exit.

## Ownership, execution and restart handling

- Hedging accounts: modify/close by exact ticket.
- Netting accounts: no entry if the symbol has any exposure; before management or cleanup inspect the position's deal history for foreign magic numbers.
- Foreign netting activity causes management to stop for that position. Do not manually trade the same symbol in a netting account.
- Setup identity and attempt count are persisted before submission. Baseline identities use candle-open milliseconds; tick identities use quote milliseconds.
- No automatic entry retry after an ambiguous result; execution fault latches for review.
- Partial fills are accepted without topping up; any remaining active order blocks future entries.
- Original stop and allocated budget are persisted before submission and bound to each position identifier. Delayed/partial fills are rechecked every maintenance pass. Initial R uses the immutable original stop, never the trailed stop.
- If an owned position lacks a protective stop, cleanup is requested.
- Check Experts for request retcode, order/deal IDs, skip reasons, and fault details.

## Backtest protocol

MT5 > Ctrl+R > Single test:
- Expert: King_of_Scalper_BTC.
- Symbol: your broker's actual BTCUSD.
- Period: M1.
- Model: Every tick based on real ticks.
- Deposit: USD1000; use actual account conditions, commission and leverage.
- Load supplied preset.
- Begin with several months spanning different regimes; reserve later data untouched for out-of-sample evaluation.
- Avoid optimization of dozens of parameters. Compare nearby stop/target/spread values, then test higher costs.
- Inspect sample size, net expectancy, profit factor, equity drawdown, average win/loss and consecutive losses.
- Compare default trailing against disabled trailing and tick mode separately.
- Follow with forward demo testing. Compilation and arithmetic tests do not establish trading performance.

Expected skip examples: spread too high, waiting for breakout, minimum lot exceeds risk, daily loss lock, margin limit, live disabled, incomplete history. The panel states the latest reason. Do not increase risk merely to force trades.

## Primary references

- https://www.mql5.com/en/docs/trading/ordercalcprofit
- https://www.mql5.com/en/docs/trading/ordercalcmargin
- https://www.mql5.com/en/docs/standardlibrary/tradeclasses/ctrade/ctradepositionmodify
- https://www.mql5.com/en/docs/globals
- https://www.metatrader5.com/en/terminal/help/start_advanced/installation
- https://www.metatrader5.com/en/metaeditor/help/beginning/integration_ide

- https://www.mql5.com/en/docs/event_handlers/ontick
- https://www.mql5.com/en/docs/constants/structures/mqltick
