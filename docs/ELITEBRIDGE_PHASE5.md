# EliteBridge Phase 5 — independent PostgreSQL storage foundation

**Proof of concept only. No external database has been created; no live data
has been copied; nothing has been merged or deployed.**

## Why a phased migration?
Supabase itself runs PostgreSQL. Hosting a PostgreSQL service with our own
application credentials is feasible without implementing a new database engine.

EliteTrade currently depends on Supabase Auth and MFA, verified-device sessions,
owner/account tables, billing, support, RPCs, payment ledgers, and running
DEMO-engine state. Migrating everything at once risks lockout, reconciliation
failures and unsafe trading state. Phase 5 separates ONLY EliteBridge device
approvals, key fingerprints, revocation, and replay state into a portable
PostgreSQL schema.

## Deliverables
- db/elitebridge-standalone.sql: portable, private PostgreSQL schema; deliberately
  OUTSIDE supabase/migrations so merges cannot automatically apply it to
  production Supabase.
- src/elitebridge-standalone-store.mjs: trusted-server Postgres SQL adapter
  implementing the existing RPC-style registry interface, with injected
  pg-compatible connection pool and authoritative identity authorization.
- test/elitebridge-phase5-standalone.test.mjs: mocked transaction, signature,
  revocation, inventory, identity-scoping and replay-safety checks.

## Security boundary
The store requires all three authoritative callbacks:
  isActiveUser(userId), ownsAccount(userId, accountId), isAdmin(userId).
They must consult a trusted identity provider, not user-supplied roles or
browser JavaScript. Only explicit true authorizes actions. During migration
Supabase authentication can remain authoritative while device state lives
in a separate Postgres server. A later independent identity system can
replace it in a separate reviewed project.

The exported createStandaloneBridgeStore factory returns an RPC-compatible
server-only adapter and can eventually be injected as options.bridgeDb into
createSupabaseApplication after securely configuring the connection and
identity policy. It is NOT automatically wired into production.

Use private network access and TLS; provision least-privileged app credentials
separate from DB migrations. Do not embed passwords, service tokens, private
keys, DSNs or broker credentials in Android/Termux/frontend JavaScript.

Replay state uses a PostgreSQL transaction, SELECT ... FOR UPDATE, unique
message IDs and durable sequence updates. Revocation writes lock the same
device row. Signed terminal telemetry still does not prove a broker link and
cannot place an order.

## Release stages
1. Verify Phase 5 unit checks plus all GitHub browser and Android builds.
2. Confirm deployment provider, target account/workspace, recurring costs,
   backups, disaster recovery and secret management before any provision.
3. Apply db/elitebridge-standalone.sql to a disposable test database ONLY.
   Test syntax, grants, recovery, concurrent replay and rollback against
   real PostgreSQL (mock tests alone do not prove database correctness).
4. Build a trusted server bootstrap and connect it to a private PostgreSQL
   server using separate app-user credentials and explicit owner/admin policy.
5. Keep ELITEBRIDGE_ENROLLMENT_ENABLED disabled until Phase 4/4.1 migrations
   and API security are staging validated and existing sessions are preserved.
6. Reconcile approved device state and audit events before a monitored cutover.
   Do not copy live user passwords, financial ledgers or MT5 secrets casually.
7. Migrate Supabase Auth, payments, business data and runtime workers only
   in independent reviewed milestones, preserving existing trading safety.

## Status
Implemented: schema, server-only Postgres adapter and mocked security tests.
Not implemented: paid hosting, migration execution, live DB validation,
real DB pool bootstrap, identity migration, backup setup, direct broker/MT5
connection or independent order execution.

Termux command:
  cd ~/Elitetrade
  node --test test/elitebridge-phase5-standalone.test.mjs
