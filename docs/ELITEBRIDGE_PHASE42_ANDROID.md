# EliteBridge Phase 4.2 — Android device manager (staged only)

This PR adds a native Compose trusted-device management page to EliteTrade.
It is stacked on Phase 4.1, not production-deployed.

- Accessible from the signed-in EliteBridge screen; existing navigation stays.
- Uses verified owner/admin API endpoints only; secure Supabase bearer and
  device-cookie behavior remains unchanged.
- Shows redacted fingerprint, device name, status and accepted sequence.
- Confirm-before-approve (admin only) and confirm-before-revoke (owner/admin);
  server-side authorization, MFA and revocation always determine the outcome.
- Supports retry, empty states, error states, and disabled-backend messaging.
- Keeps the MetaApi provider, Elite Engine, bot controls and order APIs untouched.
- Android key generation and new-device pairing remain **unimplemented**.
  Do not generate or export signing private keys in ordinary preferences.
- Live registration is not enabled. ELITEBRIDGE_ENROLLMENT_ENABLED defaults false
  and the API returns a safe "not activated" response.

## Before production
1. Phase 4 and 4.1 SQL migrations must be staged, peer-reviewed, backed up,
   and applied to the approved correct project. The Supabase GitHub
   integration may apply migrations during merge. Do NOT casually merge.
2. Fix Supabase branching migration errors, run Postgres/RLS tests on staging.
3. Complete Android Keystore-backed enrollment flow with explicit device
   identity verification and administrator approval. No private key in APK,
   GitHub, browser JavaScript or server logging.
4. Compile the native Android project and verify small/large phones,
   status bar contrast, offline recovery, and signed APK rollout separately.
5. Do not claim independent MT5 integration, order automation, broker
   verification or backend enrollment is live.

## Checks
node --test test/elitebridge-phase42-native.test.mjs
npm test
