# EliteBridge — provider-independent MT5 integration program

## Phase 1 (implemented, free, read-only)
- New **EliteBridge** entry in the existing EliteTrade Android hamburger/Account menus.
- Authenticated `GET /api/elitebridge/status` returns only provider availability, saved account binding states, and existing DEMO worker heartbeat. Scoped by verified device/user. Broker login is masked; raw gateway IDs, passwords, MetaApi tokens and Supabase administrator secrets never leave the backend.
- Current MetaApi-hosted DEMO connection remains unchanged. Existing `src/metaapi-gateway.mjs` continues broker verification, candles, risk enforcement, server-side leases and order execution. **No migration or bot interruption** is performed.
- `src/elitebridge.mjs` defines provider classification plus a strict fail-closed DEMO adapter contract (`connectionHealth`, `snapshot`, `previewMarket`, `market`, `margin`, `demoOrder`). No independent provider implements it yet.

## Future phases (not implemented)
2. Server-side broker-neutral gateway router with explicit provider enrollment and rigorous trust/risk parity tests. Switching must never happen implicitly when a provider fails.
3. Independent Windows MetaTrader 5 terminal companion (MQL5 EA or official MT5 Python integration), or a broker-supported first-party API where available. An Android APK alone cannot replace an Exness MT5 terminal.
4. Authenticated encrypted broker transport, durable idempotency/reconciliation, replay resistance, heartbeat/lag measurement, fail-closed demo-only pilot and operational disaster-recovery procedures.

## Safety and costs
- This phase creates **no Render services or paid MetaApi accounts**, performs no trades and does not remove current MetaApi dependency.
- Existing MetaApi free allowance/provider-hosting restrictions still apply.
- Connection status here is a saved database binding status, **not independently verified live MT5 connection**. Use existing MT5 connection diagnostics for live checks.
- No exposure of a raw MT5 login, provider account ID, passwords, API token or service role credential from the status endpoint.
- A reliable self-hosted bridge eventually needs a device/host running the official terminal or an actual broker API, with appropriate operational cost.

## Phase 2 — owner-scoped read-only live broker diagnostic (implemented)

- New strict provider-neutral read-only adapter in `src/elitebridge-router.mjs`.
- Authenticated `GET /api/elitebridge/accounts/:accountId/probe?symbol=XAUUSDm` verifies account ownership before accessing MetaApi. A device-verified account owner may request **3 probes/minute**; this does not poll in the background.
- Router identifies the existing bound provider and **never** falls back to a different provider. An unsupported EliteBridge binding fails closed.
- Live broker session must return `DEPLOYED`, `CONNECTED`, `brokerVerified=true` and MT5 `demo`; REAL accounts are blocked before any quote request. Only then does the adapter fetch a **read-only 5-minute preview quote** using the existing MetaApi API. A quote is valid only if its broker timestamp is within 180 seconds old and not more than 30 seconds in the future, and bid/ask are positive and ordered.
- UI shows safe provider state, broker-verified demo status, trade-permission indicator, quote and timestamp freshness. All sensitive provider errors are normalized, and the response omits account IDs, API credentials, passwords and raw history.
- Execution `src/demo-engine.mjs` is unchanged; broker order API is never invoked by the probe. Stored MT5 binding IDs are owner-scoped local UUIDs, **not raw MetaApi account IDs**.
- This **does not** implement independent MT5 connectivity. The feature will become available only after Vercel deploys the merged backend. Keep existing MetaApi free allowance while building the direct adapter.
