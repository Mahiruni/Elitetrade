# EliteBridge Phase 8 — signed telemetry diagnostics and recovery

## What is real, and what is NOT

The backend can distinguish the last **server-received**, validly signed
heartbeat from the last **server-received**, validly signed quote of each
approved terminal. This is an observability milestone, not a brokerage
connection, execution engine, or trading authorization.

No Windows MT5 VPS has been provisioned, no independent live quote has
been received, and there are no enrolled terminals yet. The existing
MetaApi connection and its DEMO-only engine are unchanged.

## Backend and data model

Apply supabase/migrations/20261015170000_elitebridge_diagnostics.sql
after all prior Phase 4–7 migrations. The additive migration creates a
per-terminal/per-kind packet index and a private service-role-only
SECURITY INVOKER function: elitetrade_bridge_health(p_owner_id).
It filters by the authenticated administrator's user ID (supplied by
the trusted backend), caps results to 30 and retrieves the newest
heartbeat independently of the newest quote. It does not return public
keys, private keys, pairing nonces, broker account login or quote prices.

GET /api/elitebridge/diagnostics is accessible **only** to a signed-in,
device-verified administrator when ELITEBRIDGE_CLOUD_ENABLED=true and a
server-side Supabase secret are configured. A terminal cannot call it
with its signing key. Failed RPCs return a generic HTTP 503.

The response is strictly projected to:
- terminalId, label, accountMode, approvalStatus, pairingProofPresent
- state, heartbeatAgeSeconds, quoteAgeSeconds,
  terminalReportedConnected, recovery
- brokerVerified:false, ordersEnabled:false,
  accountTradingAuthorized:false

Server receipt timestamps are the trusted age basis. A signed
"connected:true" value is still a **terminal-reported claim**. It is
not direct independent broker verification. A recent quote alone is
never enough to label a terminal as healthy.

## Status policy and manual recovery

- awaiting-approval: pending enrollment requires signed proof and admin approval
- revoked: permanently blocked; replace key and enroll again
- awaiting-telemetry: neither signed heartbeat nor quote received
- incomplete-telemetry: quote exists without heartbeat or malformed connection claim
- stale: latest signed heartbeat is older than 90 seconds
- terminal-reports-disconnected: recent signed heartbeat explicitly says disconnected
- awaiting-quote: recent heartbeat but no signed quote yet
- recovering: heartbeat within 90 seconds, but quote older than 120 seconds
- receiving: BOTH heartbeat and quote recent; observation only, no broker verification

This is **manual recovery guidance**, not a daemon, order retry or
automatic broker-provider fallback. The existing one-shot Phase 6
publisher keeps reserved non-reusable message sequences even after
network errors. New manual invocations must allocate new sequences.

## Test on Termux without Windows or broker credentials

    cd ~/Elitetrade
    git fetch origin
    git switch feature/elitebridge-phase8-diagnostics-20261015
    npm run bridge:diagnostics:sandbox
    node --test test/elitebridge-diagnostics.test.mjs

The sandbox uses synthetic DEMO/REAL account samples and has no
network, broker connection, account secrets or order execution.

## Deployment gates

This draft change is stacked after PR #53, which is stacked after
#52 -> #51 -> #50. Merge/review in that order only after CI.
The SQL migration can be deployed ahead of the app because it adds a
private RPC and an index without modifying existing packet payloads.
Keep ELITEBRIDGE_CLOUD_ENABLED disabled in production until the
backend build is released, database permissions confirmed, an
operator-controlled Windows host is provisioned, and a staged
end-to-end session passes. Do not insert broker credentials or
Supabase service-role keys into the APK.

Before any REAL trading: separate live-order protocol and identity,
owner confirmation and MFA, verified broker account mode, risk limits,
broker order/position reconciliation, an emergency stop, and
controlled live-money trials are still required. No part of Phase 8
enables order placement or changes MetaApi.
