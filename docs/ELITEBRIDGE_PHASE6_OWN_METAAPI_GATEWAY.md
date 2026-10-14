# EliteBridge Phase 6 — building our own MetaAPI-like MT5 gateway

**Direction:** Supabase stays as our authentication, MFA, approval, audit
and PostgreSQL database. Keep the existing MetaApi integration available.
EliteBridge will become an independently operated terminal companion
once a real MetaTrader 5 Windows terminal or supported broker API can be
connected and verified.

This phase is an **honest read-only terminal-telemetry backend**, not a
working broker gateway yet. An Android phone/Termux process cannot itself
manufacture an independent MT5 broker session.

## New code
- \`src/elitebridge-own-mt5-gateway.mjs\`: \`createOwnMt5ReadOnlyGateway\`
  - Scoped, server-only \`probe\` interface and freshness checks.
  - Reports a signed terminal heartbeat/quote as \`terminal-reported\`,
    **never** \`brokerVerified=true\`.
  - No \`connect\`, \`demoOrder\`, \`market\`, \`margin\`, or execution contracts.
  - A disabled/missing device never appears to be connected.
- \`supabase/migrations/20261015000300_elitebridge_phase6_readonly_gateway.sql\`
  - Private latest signed telemetry snapshot table (RLS enabled).
  - \`elitetrade_bridge_record_packet\` atomically claims replay sequence,
    audits packet ID and saves a sanitized DEMO heartbeat/quote.
  - \`elitetrade_bridge_snapshot\` returns a redacted and owner/device-
    scoped report, service_role only.
  - SQL never accepts REAL account claims, unsupported packet types
    or orders. It re-checks device approval and account ownership.
- \`src/supabase-app.mjs\`
  - \`GET /api/elitebridge/terminal-probe?accountId=...&deviceId=...&symbol=XAUUSDm\`
    requires Supabase Auth, verified browser, completed MFA and account ownership.
  - \`ELITEBRIDGE_SNAPSHOT_ENABLED\` defaults to **false**.
  - The existing \`POST /api/elitebridge/telemetry\` chooses the new
    atomic snapshot RPC only if the Phase 6 flag is explicitly enabled,
    otherwise it retains the previous Phase 5 claim behavior.
- Tests in Node, HTTP, and disposable GitHub PostgreSQL 16 for:
  - Fresh/stale/out-of-order telemetry, scope isolation, forged signature,
    quote sanity, duplicate message replay and device revocation;
  - SQL role restrictions and atomic snapshot writing under concurrency.
  - Non-existence of any direct MT5 execution methods.

## Deployment gates
1. GitHub unit, browser and PostgreSQL 16 tests must be green.
2. Review Phase 4, 4.1, and 6 migrations together against the live schema,
   including a verified backup and approved rollback/forward-fix plan.
3. Apply migrations and validate on an **isolated Supabase staging
   environment**. They are NOT to be applied directly to production by
   blindly merging PRs; GitHub-to-Supabase integration may auto-deploy SQL.
4. Keep both \`ELITEBRIDGE_TELEMETRY_ENABLED\` and
   \`ELITEBRIDGE_SNAPSHOT_ENABLED\` off until DB validation completes.
5. Provision a separate supported MT5 terminal-side companion (typically
   a Windows PC/VPS running MetaTrader 5) or documented broker-native API.
   Use challenge-bound signatures and device-specific key storage, and
   independently verify account identity, broker server, DEMO mode, and
   streaming freshness. This must not be implemented by trusting a
   terminal's self-reported \`connected\` flag.
6. Only after those proofs and risk/reconciliation/rollback tests consider
   implementing a broker execution adapter. Live orders and switching
   away from MetaApi are **outside this milestone**.

## Status
No new hosted service, no external database, no order execution, no live
MetaTrader connection, and no current production deployment. Our own
read-only gateway is implemented as development code and depends on
reviewed Supabase SQL activation.
