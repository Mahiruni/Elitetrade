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
