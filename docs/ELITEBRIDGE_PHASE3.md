# EliteBridge Phase 3: Signed DEMO telemetry protocol

**Phase 3 is a sandbox transport specification, NOT a MetaApi replacement yet.**

This phase implements Ed25519 digital signatures for version 3, demo-only,
strict allowlisted messages: terminal.heartbeat, terminal.quote, controller.ack.
Every message contains an account UUID, terminal device UUID, unique random
message ID, strictly increasing sequence, issue/expiry times, and a signature.
Verification requires a pinned public key, explicit trusted account and device
identities, role checks, short expiry, timestamp freshness, and an atomic
durable anti-replay claim. It rejects REAL account claims and all order messages.
The result deliberately says brokerVerified=false and actionsAllowed=false.

The local sandbox simulator can run on Android Termux, offline, without PC,
without .env and without any service credentials:

    cd ~/Elitetrade
    git pull --ff-only
    node scripts/elitebridge-sandbox.mjs

It generates ephemeral test keys and signed messages in memory, proves replay
rejection, and exits. It makes no network requests, broker calls or trades.

**Production blockers before real broker use:** A real MT5 terminal or
broker-supported direct API, trusted physical-device enrollment with approval,
persistent pinned device public keys and revocation, atomic PostgreSQL replay
protection (the Map here is sandbox ONLY), TLS, broker-verified DEMO attestation,
complete trade-state reconciliation, risk checks and provider order idempotency.
The public Android APK must never contain a private signing key or MT5 password.
Vercel serverless requests must NOT rely on a process-local replay Map.

An authenticated read-only protocol capabilities endpoint is provided; the
Android dashboard accurately shows sandbox-only / not connected. Phase 1/2
MetaApi connection, mobile engine, currently armed bot states and all real broker
order APIs are untouched.

The next milestone is approved enrollment and durable audit/replay DB tables;
do not enable this as an execution provider until full broker validation.
