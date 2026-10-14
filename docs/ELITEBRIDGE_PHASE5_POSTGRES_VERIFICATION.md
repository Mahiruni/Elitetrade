# EliteBridge Phase 5 — real PostgreSQL CI verification

This branch validates the portable device-registry schema against a **disposable
PostgreSQL 16 database** in GitHub Actions. It is not a production backend,
migration, or paid hosting resource.

## What runs

The isolated `postgres-integration` check provisions a fresh PostgreSQL
service container for the duration of one GitHub Actions job. The integration
suite uses a temporary database and tests:

- A private `elitebridge` schema that denies an unprivileged DB role.
- Pending-only owner enrollment and administrator-only approval.
- Correct signature verification and rejection of modified packets.
- Persistent monotonic sequence / audit state using actual SQL transactions.
- Two concurrent attempts to claim the same signed message; only one may pass.
- Prevention of a second approved terminal on the same account.
- Revocation, key invalidation, owner isolation, and redacted inventory.

The application test runner (`npm test`) remains independent: this test is
named `elitebridge-postgres.integration.mjs` and requires an explicit disposable
`ELITEBRIDGE_TEST_DATABASE_URL`. The PostgreSQL driver is installed into CI
only. There is no new application runtime dependency or production environment
variable.

**Never point the integration suite at production.** The script creates a
schema and test identities. CI credentials are intentionally valid only within
its ephemeral container, not in Supabase or any deployed service.

## Remaining blockers before independent hosting

1. Inspect GitHub CI results and fix failures (unit/browser/PostgreSQL).
2. Secure a distinct hosted database with confirmed price and owner account;
   do not create chargeable services without approval.
3. Set up least-privileged roles, isolated networks/TLS, authenticated runtime
   pool construction, connection limits, observability, backup and restore drills.
4. Implement and test authorization callbacks backed by your currently
   trusted user/account records rather than trusting input IDs.
5. Verify a secure migration of non-secret device state, dual-run reconciliation,
   explicit switch and rollback. Preserve Supabase Auth, MFA, payments and
   current MetaApi DEMO workflows until their own milestones.
6. Do not infer independent MT5 trade execution from having independent
   PostgreSQL infrastructure. No broker orders are enabled.

## Termux

You can run the existing seven no-network adapter tests immediately. The real
PostgreSQL test runs in GitHub Actions automatically and needs no PC or local
database installation.
