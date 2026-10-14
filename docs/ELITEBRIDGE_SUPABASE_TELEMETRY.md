# EliteBridge — Supabase-only signed DEMO telemetry (Phase 5S)

Supabase remains the selected EliteTrade database, authentication, MFA and
trusted account-identity backend. This branch starts from the Phase 4.2
Android-device UI foundation (PR #35), **not** the experimental Render/standalone
PostgreSQL branches (#36–#39). No external database is required.

## New development-only API

POST /api/elitebridge/telemetry
Request: {"packet": <exact protocol-v3 signed terminal packet>}

The endpoint is **disabled by default**. Set
ELITEBRIDGE_TELEMETRY_ENABLED=true only after the Phase 4 private-device and
atomic-claim Supabase migrations have been independently reviewed, tested
against staging and approved for live rollout. Keep enrollment separately
gated by ELITEBRIDGE_ENROLLMENT_ENABLED.

Flow:
1. Authenticate using existing Supabase Auth and verified-browser session.
2. Require completed MFA and server-side per-user request throttling.
3. Establish MT5 account ownership using existing authenticated Supabase RLS.
4. Use a server-side trusted Supabase service credential (NEVER browser/Android).
5. Retrieve the account/device-scoped approved Ed25519 public key through
   elitetrade_bridge_key.
6. Validate signed protocol-v3 DEMO heartbeat or quote, issuer identity,
   expiry, clock skew, payload schema and signature.
7. Invoke elitetrade_bridge_claim inside PostgreSQL to atomically reject
   duplicate/out-of-order message IDs or sequence numbers and write accepted
   message metadata. Existing SQL RPC re-checks device approval.
8. Return a minimal non-sensitive receipt with brokerVerified=false and
   ordersEnabled=false. Never infer actual MT5 connectivity.

### Failure behavior
- Feature disabled: 503, with no database calls.
- Authentication/MFA missing: 401/403.
- MT5 account does not belong to user: 404, before privileged RPCs.
- Invalid, oversize, expired, REAL or unsupported packet: 400.
- Forged signature or unapproved/revoked key: 403.
- Duplicate/replayed or out-of-sequence packet: 409.
- Unexpected database failures remain server errors; no fake acceptance.

## Deployment safety
- No schema changes in this PR. It depends on Phase 4/4.1 private-device
  migrations **still awaiting reviewed staging database rollout**.
- Do not automatically merge those earlier PRs: the Supabase GitHub
  integration may apply migrations on merge.
- Do not expose SUPABASE_SECRET_KEY or service_role credentials in phone, APK,
  Termux, client bundle, logs or screenshots.
- In-memory HTTP throttles alone are not globally distributed; the SQL replay
  claim remains the durable concurrency safeguard.
- No MetaApi provider change, orders, bot arming, account sync, brokerage
  verification, or public pairing enabled.
- Existing Supabase auth, payment, trading and admin operations remain
  unchanged. Render/Postgres experiment is parked.

## Verification
Local Termux test:
  cd ~/Elitetrade
  git fetch origin
  git switch --track origin/feat/elitebridge-supabase-telemetry
  node --test test/elitebridge-supabase-telemetry.test.mjs

GitHub CI must pass unit tests, browser regression and Android build as
applicable. Next milestone: staging migration review, true database
integration tests and UI wiring with secure device credential provisioning.
