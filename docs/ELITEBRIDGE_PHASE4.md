# EliteBridge Phase 4 — durable security foundations (NOT active broker connectivity)

Phase 3's Termux sandbox is passing signature validation and replay rejection.
Phase 4 adds an **unapplied, dormant** Supabase/PostgreSQL migration and a
backend-only security adapter for future owner-scoped terminal enrollment.
No enrollment HTTP route, trading provider, real broker link, automatic orders or
APK secret is supplied. Live Phase 1–3 functionality is not changed.

## Architecture
- Owners stage an Ed25519 DER/SPKI public key, never a private key. The backend
  validates canonical Ed25519 format and stores its SHA-256 fingerprint.
- A separately authorized administrator must explicitly approve the pending
  device. An owner or administrator can revoke it; revoked enrollment cannot
  be reapproved.
- Only one device can be approved per account in this initial rollout.
- Only a trusted backend service-role connection may invoke staging, approval,
  revocation, key lookup or replay-claim SQL RPCs. No authenticated-user, anon
  or public execute grants are included.
- The backend verifies the Ed25519 signature, role, DEMO-only payload, timestamps
  and account/device scope before attempting an atomic PostgreSQL replay claim.
- A device row lock, monotonically increasing persistent sequence, unique
  message ID and accepted-message audit row reject replays across server
  restarts and concurrent Vercel instances. Revocation and claims take the
  same row lock; no in-memory anti-replay fallback is permitted.
- The accepted-message table is an audit of **accepted telemetry**, not proof
  that a broker or terminal was ever connected.

## Rollout gates (manual review)
1. **Do not merge this PR until the database change is reviewed.** Supabase's
   GitHub integration may automatically apply migrations when a PR is merged;
   disabled preview branches do NOT guarantee production migration safety.
   Confirm the intended Supabase project, back up the database and validate
   the SQL in a staging database before any merge.
2. Secure the trusted server-side Supabase service-role credential. Never expose
   it in Termux scripts, Android APKs, logs, API responses or browser bundles.
3. Build a verified-device + MFA-authorized enrollment API and administrative
   approval UI. These are NOT present in this phase.
4. Add broker-verified DEMO attestation from a real terminal or supported broker
   API, per-account identity reconciliation, heartbeat liveness, durable
   execution idempotency and independent risk review BEFORE enabling any orders.

## Safe checks
Run 'node --test test/elitebridge-phase4-registry.test.mjs' and then 'npm test'.
The Termux Phase 3 offline sandbox still runs with
'node scripts/elitebridge-sandbox.mjs' and requires no credentials.
Vercel redeployment does not itself apply this SQL, but the connected
Supabase GitHub integration may run migrations on merge. Do not merge first
and assume it is inert. Record the reviewed migration outcome before rollout.
