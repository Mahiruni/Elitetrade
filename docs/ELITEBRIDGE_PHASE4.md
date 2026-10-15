# EliteBridge Phase 4 — Optional cloud enrollment, no PC required for preparation

**Status:** guarded server and database implementation. This does not install Windows
MT5, open a broker session, or create a working MetaApi replacement. No order
function or account provider migration is provided.

## Secure components

1. src/elitebridge-cloud.mjs: only an authenticated, device-verified administrator
   may register an Ed25519 terminal public key for their own saved EliteTrade
   account. Registration starts PENDING. Separate manual approval is required.
   Revocation is permanent; a new key and terminal identity must be enrolled.
2. supabase/migrations/20261015130000_elitebridge_phase4_cloud.sql: private
   terminal registry and DEMO telemetry history, RLS enabled with no public,
   anon or authenticated access. The service-role-only atomic PostgreSQL
   claim checks approved state, account, increasing sequence and unique message
   IDs inside a single database transaction, including concurrent Vercel calls.
3. POST /api/elitebridge/telemetry: pins the key and checks signed Phase 3
   envelopes, expiry, freshness and DEMO-only message kinds. The response
   always reports brokerVerified:false and ordersEnabled:false. No private
   signing keys or broker credentials are embedded in the Android APK.
4. Android dashboard differentiates Cloud Phase 4 availability from broker
   connectivity. Broker verification remains false without a real terminal.

## Rollout prerequisites

Apply the SQL migration to the correct EliteTrade Supabase project and run CI
plus database smoke tests. Configure only the trusted Vercel backend with
ELITEBRIDGE_CLOUD_ENABLED=true and SUPABASE_SECRET_KEY (or the legacy
SUPABASE_SERVICE_ROLE_KEY). Never expose these variables in public builds.
Without both the flag and the secret, enrollment and ingestion fail closed
with HTTP 503. Existing MetaApi bindings and execution remain untouched.

## API endpoints

- GET /api/elitebridge/terminals — list own registrations, no public key or
  broker credentials in the response (admin only).
- POST /api/elitebridge/terminals — owned MT5 account UUID, label and Ed25519
  PEM public key, creates status:pending (admin only).
- POST /api/elitebridge/terminals/{terminalId}/approve — approve after
  independent fingerprint/ownership checks (admin only).
- POST /api/elitebridge/terminals/{terminalId}/revoke — revoke (admin only).
- POST /api/elitebridge/telemetry — accepts only signed and approved
  terminal.heartbeat and terminal.quote packets. No bearer needed because
  device authentication is cryptographic. REAL claims and order commands are
  forbidden. Replay and out-of-order messages are rejected.

## Windows VPS is a separate future milestone

When a Windows VPS is provisioned (a Windows remote desktop can later be
managed from an Android phone), install official MetaTrader 5 and log in to
a DEMO broker account. Then implement a Windows-only terminal companion.
Generate its private key locally on the VPS, and securely display a public
key fingerprint for out-of-band administrator verification. Never upload an
MT5 password or private key to the app, GitHub, or Vercel.

The companion must independently verify true MT5 DEMO account mode, sign
broker-derived telemetry and resend after outages with nonreused sequences.
Only after independent live market validation and a separate safety review
should broker-order idempotency, position reconciliation and risk controls
be explored. None of those execution capabilities are enabled in Phase 4.

## Operations

- Windows VPS hosting is generally paid. None has been purchased or
  configured here. Neither Vercel serverless nor Render Linux is a substitute
  for the Windows MT5 terminal.
- Enable WAF/anti-abuse protection and monitor ingest costs before raising
  quote frequency.
- Keep auditable enrollment, revocation, and key fingerprints. Retire old
  telemetry rows only under an agreed retention policy; do not reset the
  persistent per-terminal last_sequence.
- Signed packets expire within 90 seconds and rely on accurate system time.
- Database revocation is checked in the atomic claim, not just at ingress.
