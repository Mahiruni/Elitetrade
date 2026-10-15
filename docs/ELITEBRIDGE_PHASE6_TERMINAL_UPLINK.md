# EliteBridge Phase 6 — one-shot signed terminal uplink (READ-ONLY)

The operator-owned EliteBridge transport can eventually accept signed DEMO v3
and REAL-observation v4 packets from a running Windows MT5 terminal **without
MetaApi**. This is NOT a live trading gateway yet: no order sender exists in
this module, and no broker session is currently connected.

## What is implemented

- The official MetaTrader5 Python SDK read-only probe checks terminal
  connection, broker account mode (DEMO or REAL), exact expected MT5 login and
  server, and fresh bid/ask.
- A Node 24 one-shot Windows publisher invokes only that local Python probe,
  then signs a heartbeat and quote with the approved terminal's Ed25519 key.
- Identity resides in the operator's local user profile outside the Git repo.
  Terminal initialization prints the PUBLIC key and SHA-256 fingerprint only.
  The private PEM is not printed or sent over HTTP.
- Sequence reservations are made under an exclusive file lock, persisted to a
  local ledger before any packet is sent, and tied to the approved terminal ID,
  account ID, and key fingerprint. Missing/corrupt ledger, changed identity,
  stale lock, or lost identity marker fail closed and require safe recovery.
  A crash can skip sequence IDs; it must never silently reuse old IDs.
- The publisher targets exactly https://elitetradee.vercel.app/api/elitebridge/telemetry,
  disallows redirects and insecure/nonmatching hostnames, and expects explicit
  brokerVerified=false, readOnly=true, ordersEnabled=false acknowledgments.
- Each invocation sends at most one heartbeat and one quote and exits. No
  unattended trading worker, position mutation or repeated order mechanism.
- REAL observations use isolated v4 signing, DEMO observations use v3 signing.
  The cloud enrollment must be ADMIN-approved and account-mode matched.
- Read-only observations **cannot** authorize REAL or DEMO order execution.

## Windows VPS setup (future — no PC or VPS is available now)

Before you attempt it: merge and release the Phase 4, Phase 5, and Phase 6
changes in that order after security review and tests. Apply migrations,
configure the EliteBridge server-side cloud flag, and enable the optional
REAL observation flag only if that mode is needed. Configure the server-only
Supabase secret without exposing it to clients. Ensure your Windows VPS
provider, MT5 terminal and broker terms permit your use case.

1. Install 64-bit Windows, official MetaTrader 5 terminal, Python 3.11+
   with the official MetaTrader5 Python SDK, and Node.js 24.
2. Log in to your broker **locally through MT5** (the bridge does not ask for
   or transmit the broker password).
3. On that Windows host, in a private user profile, initialize identity:

       npm run bridge:terminal:init

   It creates a user-private Ed25519 key and prints ONLY the public key and
   fingerprint. Windows Node filesystem modes alone do not enforce a strong
   Windows ACL; harden profile permissions and consider volume encryption,
   DPAPI-backed key protection, backups and device hardening before production.
4. In the administrator-authenticated EliteBridge API, POST to
   /api/elitebridge/terminals using your owned EliteTrade account UUID,
   label, publicKey and accountMode. For REAL, explicitly send
   realAcknowledgement=REAL_OBSERVATION_ONLY. Manually inspect and approve
   the resulting pending terminal registration after out-of-band fingerprint
   confirmation; never automatically approve an untrusted machine.
5. Configure process-local environment variables on the Windows host:
   ELITEBRIDGE_ACCOUNT_ID (EliteTrade account UUID),
   ELITEBRIDGE_TERMINAL_ID (approved registration UUID),
   ELITEBRIDGE_MT5_EXPECT_LOGIN (MT5 login ID, not password),
   ELITEBRIDGE_MT5_EXPECT_SERVER (the exact broker server),
   ELITEBRIDGE_MT5_EXPECT_MODE (demo or real),
   ELITEBRIDGE_MT5_SYMBOL (e.g. XAUUSDm).
6. Send a single read-only heartbeat and quote:

       npm run bridge:terminal:publish

   The publisher refuses anything other than Windows x64, refuses stale
   or wrong-mode terminal observations, and never follows HTTP redirects.

The server must confirm the terminal's approved public key before accepting
either packet. The new CLI does not initiate the enrollment or approval itself.

## Without a Windows machine: keep testing on Termux

From the Phase 6 feature branch, run:

    npm run bridge:real:sandbox
    node --test test/elitebridge-terminal-uplink.test.mjs

These commands use synthetic quotes and local ephemeral test state only.
Do NOT run terminal:init on a phone to make production keys for a future VPS:
create the key securely on the actual approved Windows host.

## Safety and operational limits

- Existing MetaApi working connections and DEMO execution paths are unchanged.
- REAL orders remain disabled. Future live execution needs dedicated
  broker-verified identity, owner activation, kill switch, server-side risk
  limits, position/order reconciliation, one-shot idempotency, and an
  isolated REAL order executor. No automatic provider failover is allowed.
- The publisher does not automatically retry an uncertain HTTP outcome;
  its reserved sequence IDs are consumed even if the network fails.
  A later explicit invocation uses NEW IDs. This avoids accidental reuse.
- Key or ledger loss requires reenrollment with a fresh key; never manually
  reset counters for an approved public key.
- Run only one local publisher instance per terminal, respect provider/API
  rate limits and accurately synchronized server/Windows clocks.
- Protect the private PEM against theft: user profile permissions are
  necessary but not a complete production hardware-backed key solution.
  Strict production rollout should adopt OS-managed key storage.
- No automated VPS provisioning, real MT5 connectivity, continuous live
  market feed, cloud broker attestation, real orders, or APK release has
  been carried out by this change.
