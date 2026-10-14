# MT5 recovery: use existing MetaApi first

The native Android wrapper and browser use EliteTrade's existing MetaApi account-data gateway. An MT5 Windows terminal is **not** embedded in Android.

## Production audit (read-only, 2026-10-15)
- Vercel has named production settings for MetaApi provider, token, region, mobile DEMO engine and Supabase. Their values were not retrieved or published.
- Supabase lists one saved imported MetaApi account as connected and one pending unlinked account. This persisted status does not independently prove a current live broker connection.
- The persisted DEMO engine heartbeat is **stale** and the sole engine run is **disabled**. No automated worker is currently verified online.
- This PR makes the existing provider-health endpoint accessible directly from the MT5 accounts page, and makes admin worker readiness visible.
- This PR never arms bots, renews a provider subscription, reveals provider IDs, or changes MT5 credentials. It has no SQL or environment changes.

## In-app workflow

1. Sign in and open **MT5 terminal**.
2. On the imported linked MT5 account, tap **Check Live MT5**.
3. The UI fetches the existing owner-scoped, read-only
   \`GET /api/accounts/:id/connection\` status from MetaApi. It reports hosting
   state, broker connection, verified DEMO/REAL mode and a specific next step.
4. If the provider returns an error, avoid guessing. Check MetaApi billing,
   resource slots, token authorization and live MT Accounts connection state.
5. If the provider confirms a DEMO account, refresh the MT5 account balances.
6. For admins, the MT5 page also shows whether the existing DEMO worker
   heartbeat is fresh or stale. The user must intentionally arm a
   broker-verified DEMO bot only after the worker is healthy.

## Deployment & checks

- Tests prove no MetaApi resource ID or trading token enters account JSON,
  the diagnostic route requires ownership, and the health-check flow sends
  no orders.
- No automated trading should be started until a provider-verified DEMO
  account, fresh worker heartbeat, risk settings, and user approval.
- No live execution, provider account creation or new payment is performed
  by this PR.
