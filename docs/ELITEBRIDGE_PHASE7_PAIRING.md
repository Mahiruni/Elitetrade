# EliteBridge Phase 7 — verified terminal pairing and signed telemetry health

This milestone secures the read-only terminal enrollment process. It does NOT
provision a Windows VPS, verify an MT5 broker login, switch away from MetaApi,
activate an automated trading bot, or permit REAL orders.

## Why the extra proof matters

A terminal public key is not sufficient evidence that the terminal owns
its private key. Phase 7 therefore blocks administrator APPROVE until
an owner-bound, time-limited challenge is signed locally and verified by
the server against the registered Ed25519 public key.

## Pairing workflow

1. On the final trusted Windows VPS, run npm run bridge:terminal:init
   to create a private terminal signing identity.
2. As the authenticated/device-verified EliteTrade administrator, enroll
   the public PEM for a saved MT5 account with accountMode demo or real,
   via POST /api/elitebridge/terminals. REAL registration must also supply
   realAcknowledgement=REAL_OBSERVATION_ONLY. Every new terminal is PENDING.
3. Admin requests POST /api/elitebridge/terminals/{deviceId}/challenge
   with an empty JSON body. The server returns a single-use opaque
   challenge and a 10-minute expiry. Each request ROTATES the nonce.
4. Carry the challenge to the Windows terminal; run

       npm run bridge:terminal:prove -- <challenge-from-admin>

   This command validates the domain-separated message, device/account IDs,
   account mode and expiration, signs it locally, and prints ONLY the base64url
   signature and public fingerprint. Never share the private key.
5. Admin submits POST /api/elitebridge/terminals/{deviceId}/prove
   with JSON {signature:"<signature-from-terminal>"}. The server verifies
   signature, account ID, mode, nonce, deadline and pending state, then
   atomically consumes the nonce. Invalid, expired or replayed proofs fail.
6. Admin separately POSTs /api/elitebridge/terminals/{deviceId}/approve
   only after manually confirming the fingerprint/terminal owner out-of-band.
   Approval requires proof_verified_at, enforced both in API query and a
   PostgreSQL CHECK constraint. Revocation permanently blocks new ingest.

## Status and scope

GET /api/elitebridge/terminals lists owner-scoped terminal labels, account
modes, approval and proof state, last signed telemetry and freshness. The
Android EliteBridge page may display "not approved", "never received",
"recent" or "stale" with the last observed packet age. This means a
signed telemetry packet was received, NOT that the broker verified an MT5
session or that order execution is enabled.

All device administration actions require existing bearer authentication,
browser-device verification, MFA when configured, and admin role. The public
key and nonce never appear in the listing. Database tables have RLS and
service-role-only permissions. There is no public challenge endpoint.

## Test on Android Termux without a Windows terminal

    git fetch origin
    git switch feature/elitebridge-phase7-proof-pairing-20261015
    node --test test/elitebridge-device-proof.test.mjs
    node --test test/elitebridge-terminal-uplink.test.mjs

These are offline tests with temporary device keys. They do not connect
to MT5, MetaApi, a funded account or production cloud.

## Remaining engineering and operational gates

- Merge and deploy Phase 4, 5, 6 and 7 in sequence with successful CI and
  a reviewed Vercel release. The cloud feature flags must be explicitly
  enabled on the server after schema updates; not in Android.
- A Windows MT5 terminal, operator-controlled private key and live broker
  feed are still missing. No proof was issued for a real external terminal.
- The Node private PEM on Windows should ultimately use hardened Windows
  ACL/DPAPI or stronger key isolation, encrypted backups and rotation.
- Real-money trading needs its OWN dedicated execution identity, separately
  authorized order-signing protocol, pretrade broker checks, exposure/SL/TP
  caps, reconciliation, kill switch and approved end-to-end tests.
- The existing MetaApi DEMO execution pathway is not changed.

**No new REAL orders or broker credentials are used by Phase 7.**
