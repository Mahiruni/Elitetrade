# EliteBridge: verified audit and supervised telemetry milestone

Audit date: 2026-10-16. Baseline: repository main `9662b140921f3b98fd459f3bf645e34427e0c575`.

## Evidence and limits

Vercel's deployment API reported production READY at the baseline commit. A read-only query of the connected EliteTrade Supabase project returned **0 terminal registrations, 0 approved terminals, and 0 packets**. Both bridge tables have RLS enabled. The claim and health functions grant execution only to `postgres` and `service_role`; browser roles do not have execute privileges.

These observations establish deployed scaffolding and database isolation configuration, not a working independent broker connection. No broker credentials were read and no orders were submitted. No Windows terminal was available to this development environment. A database count is a point-in-time observation and may change after commissioning.

| Capability | Status | Evidence / limitation |
| --- | --- | --- |
| Production application | Verified working | Vercel READY for baseline; independent terminal remains unverified |
| Private bridge storage and RPC permissions | Verified working | Live catalog inspection; does not establish every authorization path |
| Ed25519 telemetry signatures and scope validation | Implemented but unverified | Synthetic automated tests; no enrolled terminal has published |
| Single-use pairing challenge and explicit approval | Implemented but unverified | Owner/admin routes and challenge consumption code; zero production enrollments |
| Durable monotonic replay rejection | Implemented but unverified | PostgreSQL claim RPC plus protocol tests; live disconnect behavior not commissioned |
| Windows MT5 heartbeat and quote publisher | Implemented but unverified | Existing Python observer and one-shot sender; needs terminal host |
| Continuous read-only supervisor | Implemented but unverified | This milestone; fresh collection, bounded retries, lifetime lock; Windows broker trial pending |
| Local account and position snapshot | Implemented but unverified | SDK fixture tests; stdout only on Windows; no cloud transport |
| Independent cloud positions / orders / history | Missing | Existing v3/v4 packet contracts permit heartbeat and quote only |
| Independent execution ledger and reconciliation | Missing | No independent execution authority or order API |
| Account-level live trading activation | Missing | REAL mode currently means observation only |
| Single executor fencing and hot failover | Missing | Supervisor lock is local process exclusion, not distributed execution fencing |
| Streaming and SDK/webhook platform | Missing | Current operator UI uses bounded polling; no independent public SDK/webhook offering |
| Independent MT5 broker validation | Blocked | Requires operator-controlled Windows x64 terminal, SDK and approved broker login |
| Demonstrated advantage over MetaApi | Blocked | Needs comparable production measurements; no superiority claim |

## Current system boundary

The existing MetaApi adapter remains the live broker provider for its existing account-data and demo-engine flows. EliteBridge's signed observation path is separate:

1. Operator signs into an approved Windows MT5 terminal locally.
2. Python reads `terminal_info`, `account_info`, and `symbol_info_tick` via the official SDK.
3. Node validates the observation and durably reserves fresh sequence numbers before signing heartbeat and quote packets.
4. HTTPS ingestion verifies the pinned approved key and calls the atomic replay/storage RPC.
5. Owner-scoped diagnostics report server receipt freshness to the web/Android control surfaces.

The optional local snapshot uses `positions_get`; its financial output is not signed or ingested by the quote protocol. App account records do not yet independently attest the terminal's broker login/server. The local probe checks expected identity; a trusted-device signature alone is not broker-side proof. Cloud identity-binding enhancement belongs before independent execution.

## Changes in this milestone

- `npm run bridge:terminal:watch`: Windows-only, sequential observation loop. Default interval 15 seconds after completion. No accumulated quote backlog.
- Network errors, HTTP 429/5xx and specifically allowlisted temporary probe failures get bounded exponential backoff with jitter, capped at 5 minutes. Eight consecutive failures stop the process for inspection.
- Every retry reruns the probe and reserves new durable sequences; a lost response never causes an old packet to be resent. A partial heartbeat/quote batch can remain incomplete until a later fresh collection succeeds.
- Authentication, revocation, protocol/sequence rejection, account/server/mode mismatch, malformed acknowledgment, missing SDK and unknown failures stop immediately. A blocked process is not automatically restarted by this code.
- Exclusive `watch.lock` prevents two watches sharing an identity directory. It never steals a stale lock. Existing sequence locking remains authoritative for local reservations.
- SIGINT/SIGTERM cancel waits and stop the publisher child. Child output and arbitrary errors are excluded from supervisor status logs. Logs do not contain quote prices, credentials or broker login.
- Web operations sections: overview, terminals, receipt diagnostics, commissioning readiness, security. Unavailable diagnostics show Unknown. Key fingerprints are visible before approval.
- Refresh preserves enrollment drafts, focus, disclosure state and scroll, including edits made while requests are pending. Hidden tabs pause checks, visibility/network recovery triggers a fresh check, and disposed views cannot receive late refresh results.
- Android status polling uses STARTED lifecycle scope and propagates cancellation. Backgrounding cancels the periodic loop; resume refreshes. Existing read-only account probes remain separate user actions.

## Commissioning runbook

Do not purchase a host or enable trading to test the UI. Once an authorized Windows x64 host is available:

1. Follow `ELITEBRIDGE_PHASE9_WINDOWS_READINESS.md` to configure MT5, Python SDK, Node 24, expected broker identity and public-key enrollment.
2. Generate private keys only on that Windows machine. Store them under a restricted Windows account with appropriate NTFS ACLs. The watch does not configure Windows ACLs, scheduled tasks, service accounts or RDP security.
3. Complete key-possession proof and explicit administrator approval. Use DEMO first.
4. Run `npm run bridge:windows:check -- --probe`, then `npm run bridge:terminal:publish`. Inspect the authenticated server diagnostics.
5. Run `npm run bridge:terminal:watch` in the same secured Windows environment. Optional `ELITEBRIDGE_PUBLISH_INTERVAL_MS` accepts an integer from 10000 through 300000.
6. Inspect server receipts, disconnect/reconnect behavior, host restarts and revoked-key rejection. Ctrl+C stops the watch. After an abrupt host/process crash, independently confirm the previous process is gone before manually removing only `watch.lock`. Never delete/reset the key's sequence ledger to resume an enrolled identity.
7. A blocked watch requires operator diagnosis. Never configure an unconditional OS restart loop that defeats its failure budget. A production service wrapper needs separate review and commissioning.

Termux can run the existing secret-free availability monitor. It cannot run this Windows publisher or replace MT5. An Android APK is not a terminal host.

## Verification

Run `npm run build`, `npm run check`, `npm test`, `node test/elitebridge-browser.mjs`, and the Windows preflight CI. New supervisor tests model lost acknowledgments, durable sequence continuation, bounded recovery, revocation, malformed outcomes, lock exclusion and cancellation. Browser fixtures cover drafts, pending-request edits, outages, network recovery, cleanup, widths 320–1440px and both themes. Fixtures explicitly identify themselves as synthetic; passing them does not demonstrate MT5 or broker connectivity. Android source must compile in the Android debug CI before release.

No database migration or provider switch is required by this milestone. APK source changes require a newly built and installed APK; a web deployment alone does not update native Kotlin screens.

## Next evidence gate

Commission one authorized Windows DEMO observer and record genuine heartbeat/quote receipts. Then define a new signed full-snapshot protocol with strict account binding, source and receipt timestamps, bounded canonical data, complete/empty snapshot semantics, durable epoch/sequence rules and owner access. Only after those tests and migrations should independent positions appear in the app. Execution requires a separate signing domain, durable command ledger, single-account execution owner, risk limits and broker reconciliation.

## Comparison methodology

MetaApi's current official client documentation lists account state, execution, history and streaming market data. EliteBridge currently has a much smaller verified scope. Track enrollment time, synchronization time, source quote age, recovery duration, command acknowledgment/reconciliation latency, duplicate execution incidents, mobile task success and cost per active account. Mark absent measurements Unmeasured rather than zero. Report sample count and p50/p95/p99 only for adequate samples; separate network, terminal, broker and application timings. Server receipt age alone is not end-to-end latency or quote source age.

Reference sources inspected:

- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5terminalinfo_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5positionsget_py
- https://metaapi.cloud/docs/client/
