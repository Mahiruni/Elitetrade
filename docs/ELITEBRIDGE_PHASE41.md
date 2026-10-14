# EliteBridge Phase 4.1 — staged device enrollment API

**NOT live**, **NOT a MetaApi replacement**, **NO orders**.

This branch builds upon Phase 4 durable state (PR #33). It adds:
- Distinct Ed25519 proof-of-possession during staging: a canonical,
  domain-separated, key-signed 90-second enrollment proof includes owner UUID,
  MT5 account UUID, device UUID, timestamp and nonce. Replayed staging requests
  are constrained by the database unique device/fingerprint-per-account rule.
- MFA + verified browser/user authentication on all device API endpoints.
- Owner-scoped MT5 account check before staging (no arbitrary account enrollments).
- Trusted-server-only RPCs and explicit administrator approval.
- Owner/admin revocation with durable status; revoked keys cannot reconnect.
- Redacted owner/admin inventory (no private key, no full public key exposed).
- Separate opt-in setting ELITEBRIDGE_ENROLLMENT_ENABLED, default OFF.

## API contract (after reviewed migrations and activation)
GET /api/elitebridge/devices - own devices; administrators can view up to 100.
POST /api/elitebridge/devices - owner requests enrollment.
  Body: {accountId,deviceId,displayName,publicKeySpki,proof}
  proof: {ownerId,accountId,deviceId,issuedAt,nonce,signature}
  Signature covers 'EliteBridge/v4/device-enrollment\n' followed by
  JSON.stringify([ownerId,accountId,deviceId,issuedAt,nonce]).
POST /api/elitebridge/devices/:deviceId/approve - admin only.
POST /api/elitebridge/devices/:deviceId/revoke - owner or admin.

Proof is made locally with createDeviceEnrollmentProof; the device private key
must never be sent to the server or committed to GitHub. This repository does
not yet implement phone-side key provisioning or enrollment UI.

## Security/release gates
1. Both Phase 4 and Phase 4.1 database migrations require SQL review, **staging**
   validation, verified backup and approved rollout on the right Supabase project.
   The Supabase GitHub integration may automatically apply migrations on merge:
   **DO NOT MERGE EITHER PR UNTIL STAGING IS VALIDATED.**
2. Secure server-side SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY must be
   configured; do not place them in the web frontend, APK, Termux or logs.
3. Keep ELITEBRIDGE_ENROLLMENT_ENABLED unset/false until migrations, MFA,
   authorization and manual UI flow have been verified.
4. Do not treat enrollment or terminal heartbeat as broker validation. A compatible
   MT5 terminal/broker API, broker DEMO attestation and safe reconciliation are
   separate blockers before any independent provider execution.
5. Existing MetaApi-based DEMO bot and Elite Engine are unmodified.

## Tests
Run in Termux, from this branch:
  node --test test/elitebridge-phase4-registry.test.mjs
  node --test test/elitebridge-phase41-enrollment.test.mjs
GitHub CI should pass all full unit and browser checks before approval.
