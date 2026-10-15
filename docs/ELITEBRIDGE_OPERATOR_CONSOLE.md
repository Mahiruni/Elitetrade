# EliteBridge — secure mobile commissioning console

This document describes the existing **Hosted MT5 → EliteBridge cloud** administrator
console. It is an operational user interface, **not** a provider switch or a
replacement for an actual Windows MT5 terminal. Broker verification and independent
trading remain disabled until further engineering and approved host commissioning.

## Verified infrastructure (2026-10-15)

- EliteTrade's **production** `ELITEBRIDGE_CLOUD_ENABLED` flag is `true` and
  the `SUPABASE_SECRET_KEY` is configured only server-side.
- Supabase contains the terminal registry, atomic signed replay claim, pairing
  proof gate, and read-only health diagnostic migrations.
- As of the latest read: **0 enrolled terminals, 0 approved terminals,
  0 signed telemetry packets**. Do not treat installed backend code as an
  MT5 connection or make an order through a different provider.
- Existing user MetaApi account bindings and the separate DEMO worker remain intact.

## Administrator workflow from an Android phone

1. Open `https://elitetradee.vercel.app/hosted-mt5` and sign in as the authorized
   administrator. The page fetches `/api/elitebridge/protocol`,
   `/api/elitebridge/terminals`, `/api/elitebridge/diagnostics`, and
   `/api/accounts?fast=1` using existing browser/device-authenticated access.
2. Provision your *own* secure Windows x64 desktop/VPS first. This app cannot
   provision a paid VPS or convert Termux/Android into the official Windows MT5
   runtime. Access Windows securely from Android using a trusted remote desktop
   connection with MFA or VPN where possible. Never expose open RDP to the world.
3. Install official MetaTrader 5 and the independent read-only terminal companion
   on Windows, and verify the correct broker DEMO account and symbol locally.
   No MT5 password should be sent to the website or GitHub.
4. Generate Ed25519 identity **on Windows only**:
   `npm run bridge:terminal:init`
   The private key remains in the Windows user's secure local directory.
   Copy only the PUBLIC PEM into the web pairing form.
5. Choose the owned EliteTrade MT5 account ID, enter a label and enroll the public
   key. This creates a pending identity, not an active broker connection.
6. In the web console, issue a **one-time 10-minute challenge**. On Windows:
   `npm run bridge:terminal:prove -- '<challenge>'`.
   Paste only the returned **signature** into the console's proof field.
7. Compare the 64-character SHA-256 **public-key fingerprint shown by the web console** with the fingerprint printed by `npm run bridge:terminal:init` on the actual Windows computer. Verify the fingerprint and actual terminal owner over a trusted separate
   channel, then click Approve. The backend and SQL constraints require the
   successful signed proof before approval.
8. Once Windows MT5 locally confirms the intended broker and a real fresh quote,
   send the one-shot read-only uplink:
   `npm run bridge:terminal:publish`.
   Signed payloads use monotonic durable sequences with replay rejection.
9. Read diagnostics. `receiving` means a recent **signed heartbeat and quote
   packet were stored**. It does NOT prove independent broker connection,
   real-time data entitlement, profitable strategies, or any permission to trade.
10. If a device is lost or its key is exposed, revoke it. A revoked terminal
    requires a new local key and full re-enrollment.

## Security and operating guarantees

- The UI never asks for or logs MT5 passwords, private PEMs, access tokens,
  service-role credentials or brokerage order instructions.
- All API actions are authenticated, device verified and administrator/owner
  scoped server-side. The browser role is only for presentation.
- REAL account telemetry (if server feature-gated) is **observation only**.
  This console enrolls **DEMO only** by default, and cannot initiate or
  authorize orders. No broker-provider fallback is triggered by outages.
- Review the actual remote desktop, installed terminal, MT5 server, clock
  synchronization, region, broker account permissions and symbol availability
  independently before any connection is claimed as verified.
- Your broker's terms and trading permission still apply. Do not leave automated
  trading running indefinitely from an Android foreground service.

## Operational truth labels

| Label | Meaning |
|---|---|
| Enrollment available | Server can accept an authorized public key registration |
| Pending | Public key stored; pairing signature not necessarily verified |
| Key ownership proven | Matching private key signed the single-use challenge |
| Approved | Explicit administrator-approved telemetry identity |
| Signed data received | Signed telemetry with server-received timestamp; not independently broker verified |
| Broker verified | **Not implemented** in EliteBridge direct adapter |
| Trading enabled | **No**; MetaApi DEMO worker remains separate |

Full Windows readiness steps: `docs/ELITEBRIDGE_PHASE9_WINDOWS_READINESS.md`.
