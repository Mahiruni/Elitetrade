# Demo strategy execution

The engine implements the three existing presets. These are explicit baseline algorithms, not recovered proprietary rules or a profitability claim. Real-money execution is rejected by both the strategy planner and provider order adapter.

| Preset | Timeframe | Entry |
| --- | --- | --- |
| Trend | 15 minutes | EMA 20 crosses EMA 50 on a closed candle |
| Scalping | 5 minutes | EMA 9 crosses EMA 21 on a closed candle |
| Breakout | 15 minutes | Close above the previous 20 highs or below the previous 20 lows |

Buy and sell entries are symmetric. No forming candle is used. Stale, duplicate, missing or invalid bars are rejected. The broker symbol is case-sensitive, including suffixes such as XAUUSDm.

## Existing configuration semantics

- Stop loss and take profit percentages specify distances from the entry price. They are not percentages of account equity.
- Risk per trade caps estimated price-to-stop loss using current broker tick value and equity. Lot size is an additional maximum; the engine rounds down to broker volume steps and skips trades below the minimum lot.
- Spread cannot exceed 10% of stop distance. SL/TP must satisfy broker rules. Margin cannot exceed half of free margin.
- One engine per account and no new entries while any broker position or pending order exists. This includes manually placed exposure.
- Daily equity loss uses a stored UTC-day baseline. Drawdown uses persistent observed peak equity. Stopping/restarting a bot does not reset these baselines. Deposits/withdrawals also affect these equity comparisons; this is not cash-flow-adjusted performance reporting.
- Projected SL risk must fit remaining daily and drawdown allowances. Gaps, slippage and execution costs can still exceed estimated loss; this is not a guaranteed maximum loss.
- Stop prevents new entries. It does not liquidate existing broker positions; broker-side SL/TP continue to protect them. No news filter, trailing stop, TP1/TP2 split or economic-calendar integration is implemented in these presets.

## Database and website

`db/demo-engine.sql` installs owner-scoped run/order reads, service-only risk/lease writes, and guarded control functions. The private privileged function verifies ownership, profile access and MFA before arming. Account leases plus unique candle receipts prevent concurrent account execution and replay. An unknown trade response is not retried: the bot halts and the receipt requires reconciliation against the broker before restarting/removal.

The website uses a recent database worker heartbeat to enable Start. Merely setting METAAPI_TOKEN does not prove worker availability. Preview strategy retrieves broker candles and a preliminary risk plan without submitting trades. Real accounts remain usable for account data, but cannot be armed.

## Worker hosting — required before Start can work

The Vercel website is deployed separately from the persistent trading worker. Do not put an infinite loop inside a Vercel request or depend on an open browser tab.

Run this repository on an always-on Node 24 process host/VPS with these **private** variables:

| Variable | Value |
| --- | --- |
| SUPABASE_URL | https://cgpvhayfwnpipktyltho.supabase.co |
| SUPABASE_SERVICE_ROLE_KEY | Backend service-role key from your dedicated Supabase project |
| METAAPI_TOKEN | Your MetaApi token with market data, account read and trading access |
| METAAPI_REGION | Account provisioning region, such as new-york |
| DEMO_EXECUTION_ENABLED | true |

Start command: `npm run worker:demo`. Install dependencies using `npm ci`. Configure restart-on-failure through the host. Every cycle evaluates up to 20 armed bots sequentially then waits 15 seconds; this is a polling baseline, not low-latency execution. Long provider requests can make heartbeat stale and disable new starts until the worker recovers. The worker must share the website's provider/database account access. Never commit these secrets.

### Render deployment

The repository includes `render.yaml` for a single Node 24 background worker. In Render, create a Blueprint from this repository and provide the prompted private Supabase service-role key, MetaApi token and provisioning region. Review the worker compute price before creating the service; this file does not provision a free web service or move the Vercel website. The Blueprint enables demo execution but does not arm any bot.

After deployment, verify worker logs show completed cycles and the website reports a recent worker heartbeat. Then approve your demo account, preview the strategy and explicitly start the bot. A successful build alone does not establish broker connectivity or successful trade execution.

For execution, use a verified broker **demo** account with its master password, not an investor password. Existing read-only MetaApi connections may need provider credential updates. Approve the connection in EliteTrade, save your exact broker symbol/settings, preview, then Start. No automatic account approval or existing bot start is performed during installation.

## Reconciliation

Inspect the broker/MetaApi account and the service-only order receipt after a timeout or worker crash. The reserved receipt may represent a sent or unsent trade. Never blindly resubmit it or delete it. An operator must establish the broker outcome and mark the receipt confirmed (with broker ID) or cancelled (with evidence no trade was accepted). Unique candle receipts remain to prevent replay. Unknown outcomes disable execution and block removal until resolved.

## Verification boundaries

Unit/integration tests exercise closed-candle signals, broker risk rules, account isolation, receipt-before-order ordering, ambiguous outcomes and replay prevention with simulated provider responses. Database checks verify grants/RLS and account lease exclusion without leaving test orders behind. These checks are not a backtest or live broker validation. Real-money activation requires a separate reviewed implementation after demo validation.

Official provider docs:
- https://metaapi.cloud/docs/client/restApi/api/retrieveMarketData/readHistoricalCandles/
- https://metaapi.cloud/docs/client/restApi/api/trade/
- https://metaapi.cloud/docs/client/restApi/api/calculateMargin/
- https://metaapi.cloud/docs/client/models/metatraderSymbolSpecification/
