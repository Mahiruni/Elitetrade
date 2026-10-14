# EliteBridge — Supabase migration rehearsal in ephemeral PostgreSQL 16

Supabase remains EliteTrade's selected Auth, MFA, and PostgreSQL backend.
This is an isolated **migration rehearsal** rather than a deployment to your
Supabase production project.

## Exact scope
The GitHub Actions job \`supabase-sql-staging\` boots its own temporary
PostgreSQL 16 container. It creates minimal synthetic accounts, profiles and
the expected Supabase database roles, then executes both existing migrations:

- \`20261015000100_elitebridge_phase4_secure_state.sql\`
- \`20261015000200_elitebridge_phase41_inventory.sql\`

The suite asserts ordinary user/anonymous roles cannot access the private
device state or security RPCs, service-role-authorized account ownership
controls staging, only the administrator can approve, and signed-message
claim replay state is monotonic/atomic. It tests actual concurrent claims,
revocation, exclusive approval, scoped key lookup and redacted inventory.

**Limitations:** This test emulates only the Supabase SQL roles and profile
tables required by these two migrations. It does NOT prove compatibility
with every existing live Supabase table, subscription, extension, role grant,
or migration. It does not test external network access, real login sessions,
actual broker MT5 connectivity or payment ledgers.

## Release gates before activation
1. All GitHub tests, browser and SQL integration suite pass.
2. Inspect live Supabase database schema read-only and reconcile any drift.
3. Take and verify an approved backup / rollback or forward-fix plan.
4. Apply SQL only to an approved isolated Supabase staging/branch project
   and repeat privilege, replay, MFA, app integration and concurrent tests.
5. Review each migration and prevent automated production migration on
   an unapproved merge. No production merge while this gate is unmet.
6. Only then consider activating ELITEBRIDGE_ENROLLMENT_ENABLED and
   ELITEBRIDGE_TELEMETRY_ENABLED, separately and with monitoring.
7. Never treat accepted DEMO telemetry as proof of an MT5 broker connection.
   EliteBridge remains unable to place orders.

## No local database needed
GitHub runs the PostgreSQL container automatically. Termux remains useful
for offline unit checks and the approved proof-of-concept signer.

This branch does not provision Render or apply any production Supabase SQL.
