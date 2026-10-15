# EliteBridge Phase 5 — REAL-account observation foundation (NO real orders)

EliteBridge is being developed as an independent MT5 gateway with distinct DEMO and REAL account transport modes. This milestone accepts **read-only observations** rather than trading instructions.

## Existing MetaApi provider

The existing account health code distinguishes broker-verified MT5 REAL vs DEMO accounts. However:
- The existing MetaApi DEMO order method explicitly rejects REAL accounts.
- The DEMO engine/risk reservation path cannot safely be reused for live money.
- MetaApi account verification is not proof that our own Windows MT5 bridge has a running broker terminal.
- Existing broker connections, subscriptions and DEMO bot workers are unchanged.

## Separate signed protocols and trusted devices

- Protocol v3, signing domain EliteBridge/v3, accepts DEMO heartbeats/quotes.
- Protocol v4, signing domain EliteBridge/live-observation/v4, accepts REAL heartbeats/quotes only. Order, cancel, modify and trading commands are forbidden.
- Every envelope binds a pinned Ed25519 key, owner-scoped MT5 account UUID, device UUID, expiry, sequence and message ID, checked atomically in PostgreSQL.
- The terminal account_mode defaults to demo for backward compatibility. REAL enrollment requires accountMode=real and realAcknowledgement=REAL_OBSERVATION_ONLY; an administrator must separately approve the registration.
- The PostgreSQL replay claim verifies account_mode and approved device status in the same atomic compare-and-update as the sequence.
- A terminal's accountType=real is a self-reported claim and not independent broker verification or execution permission.

## Feature flags (server only)

The previous ELITEBRIDGE_CLOUD_ENABLED=true and SUPABASE_SECRET_KEY (or legacy service-role key) are required first. Set ELITEBRIDGE_REAL_OBSERVATION_ENABLED=true to opt in to REAL read-only observations. All remain disabled until explicitly configured. Do not place service secrets in the Android APK or public JavaScript. REAL enrollment fails with HTTP 503 when observation is disabled; protocol v4 packet ingestion is blocked when disabled.

Neither flag authorizes or enables REAL order placement.

## Windows terminal read-only probe

Install MetaTrader 5 desktop and its official MetaTrader5 Python package on a future 64-bit Windows VPS. The terminal must already be logged into the operator-approved broker account.
- ELITEBRIDGE_MT5_EXPECT_LOGIN: exact authorized MT5 login
- ELITEBRIDGE_MT5_EXPECT_SERVER: exact broker server
- ELITEBRIDGE_MT5_EXPECT_MODE: demo (default) or real
- ELITEBRIDGE_MT5_SYMBOL: a broker symbol such as XAUUSDm

Run: python companion/mt5_readonly_probe.py

The probe validates terminal connection, broker account mode, login/server match and quote timestamp; it outputs a sanitized observation. It never logs into the terminal, transmits data, imports private signing keys, or invokes order_send. No Windows VPS is currently provisioned and no live broker feed has been validated.

## REAL-trading acceptance gates (future separate release)

1. Explicit owner activation for the *specific* broker-verified REAL account, with fresh MFA, separate REAL role/capability and obvious mode labels.
2. Independent realOrder executor, dedicated ledger and an explicitly approved per-account risk policy. No DEMO-to-REAL automatic fallback or inheritance of DEMO trade authorization.
3. Durable broker-order idempotency, one-shot leases and broker reconciliation of orders, positions, fills, rejected orders and uncertain outcomes. Never blindly retry an uncertain order.
4. Server-enforced max risk per trade, daily loss, drawdown, maximum positions, volume step, margin, spread, slippage, SL/TP and absolute exposure caps, plus broker-specific instrument validation.
5. Trusted terminal identity and durable signed control-message authorization distinct from the read-only observation signing role.
6. Kill switch, disconnect/watchdog, quote-age limits, account state and broker permissions verified immediately before execution; stale/disconnected always stop new orders.
7. Confirm brokerage permission, terms and applicable local legal/account requirements, plus operator-authorized low-exposure real-money acceptance tests.

**This milestone does not place real-money trades, turn on an order adapter, or provide a new broker session.** It ensures our design never confuses permission to observe a REAL account with permission to trade it.
