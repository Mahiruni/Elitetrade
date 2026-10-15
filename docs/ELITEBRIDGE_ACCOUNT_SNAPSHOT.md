# EliteBridge — next milestone: read-only local account and open-position snapshots

## Exact status

The EliteTrade Vercel cloud and signed v3 DEMO/v4 REAL **heartbeat + quote** transport already exist. An account and position snapshot is **not** yet a signed cloud packet or Android live positions feed. This milestone adds a *separately invoked, local-only* MT5 SDK read operation for validating genuine account values before cloud schema/protocol work. No host has been provisioned and no live broker data has been observed during development.

## Launch on the eventual operator-controlled Windows x64 terminal

1. Install and start official desktop MetaTrader 5; sign into the correct authorized broker account locally.
2. Install Python 3.11+ x64 and the official `MetaTrader5` Python package. Clone the reviewed EliteTrade repository on Windows.
3. Configure process-local environment variables (never broker passwords or Supabase secrets):

   - `ELITEBRIDGE_MT5_EXPECT_MODE=demo` initially, or `real` for **observation only**
   - `ELITEBRIDGE_MT5_EXPECT_LOGIN` — your account number
   - `ELITEBRIDGE_MT5_EXPECT_SERVER` — exact MT5 broker server
   - `ELITEBRIDGE_MT5_SYMBOL=XAUUSDm` (or the correct broker instrument)

4. Run `npm run bridge:terminal:snapshot` **locally on Windows**.
5. Inspect the result locally: `snapshot.currency`, `balance`, `equity`, `margin`, `freeMargin`, `floatingProfit`, `openPositionCount` and bounded `positions` (symbol, buy/sell, volume, entry/current prices, SL/TP, floating profit and swap). The `positionKey` is a truncated account-scoped hash, **not** a broker order ticket.
6. Repeat manually while a position changes. A changing MT5 snapshot demonstrates that the local terminal SDK can read the position; it does **not** prove cloud synchronization.

## Safety guarantees

- Regular `npm run bridge:terminal:publish` still calls the original default quote probe **without `--snapshot`**. Existing v3/v4 signature canonicalization and backend SQL permit only heartbeat/quote; they will never ingest a snapshot by accident.
- No `MetaTrader5.login`, `order_send`, saved passwords, authentication keys, server mutations or broker orders are added.
- The probe verifies the expected MT5 login, exact server, account mode and a fresh valid market tick **before** reading positions. It re-checks identity after `positions_get`. Bad or changed account identity, invalid fields, SDK failures, or more than 100 open positions cause fail-closed errors; the application will not silently present incomplete positions as a complete portfolio.
- The CLI emits locally observed financial data to **stdout**, so run it only in your secured Windows session. Do not paste this output into public chat, GitHub Actions logs, support tickets, APKs or frontend telemetry.
- Real account snapshots are **read-only**. Both DEMO and REAL return `brokerVerified:false` and `ordersEnabled:false`; the broker terminal is the data source, not independent broker-side attestation. MT5 can report different values across quote/account/position calls as markets move.
- The observed position profit and account floating profit may differ owing to fees, swap, multi-asset exposure and snapshot timing. Do not combine them as if they were identical.

## Next release gate for real dashboard positions

After Windows terminal and local position snapshot checks are observed, define a new strictly signed, owner-scoped positions protocol (separate from the already-deployed v3/v4 quote contract). Require canonical payload limits, durable replay/idempotency, last-complete-snapshot semantics (including zero positions), reconciliation after disconnects, per-owner RLS, server-received freshness, stale/redacted UX, and security-tested production migration. Only then surface changing positions in EliteTrade web/Android. **Never enable order execution through this observation protocol.**

## Development verification

- `node --test test/elitebridge-account-snapshot.test.mjs` uses a fake SDK and does **not** connect to MT5.
- `npm test` includes the observer regression tests in normal CI.

Source: official MetaQuotes MT5 Python `account_info`, `positions_get`, `symbol_info_tick` reference.
