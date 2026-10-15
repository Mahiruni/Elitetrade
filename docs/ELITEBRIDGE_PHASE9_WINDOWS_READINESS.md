# EliteBridge Phase 9 — Hosted Windows MT5 commissioning readiness

## Scope and current truth

Phase 9 adds a Windows host checker, a REAL/DEMO-safe commissioning state
machine, an Android Termux synthetic sandbox, and a real Windows GitHub Actions
runner. **No Windows VPS has been bought or provisioned, no actual MT5 terminal
has been contacted, no broker quotes have been streamed, no REAL trades have
been placed, and MetaApi remains unchanged.**

The existing Phase 4–8 cloud code is still in stacked draft PRs and is not
automatically deployed by this branch. Vercel build-rate-limit failures also
need to be resolved before a production feature release.

## Do this NOW from Android Termux (no PC, no VPS, no credentials)

    cd ~/Elitetrade
    git fetch origin
    git switch feature/elitebridge-phase9-windows-preflight-20261015
    npm run bridge:windows:simulate
    node --test test/elitebridge-windows-readiness.test.mjs

These tests model a hypothetical Windows machine. They do NOT scan your real
phone for broker data, enroll an identity, send network requests or trade.

The Windows-specific GitHub CI verifies the actual preflight CLI runs
on a Windows x64 runner and refuses to claim readiness when MT5 is
not installed or connected. CI success does not prove a hosted terminal.

## Hosting requirements for future real MT5 use

Use a legitimate Windows x64 VPS under your administrative control with:
- A supported Windows Server or Windows desktop edition allowed by the
  provider and MT5 broker.
- Secure phone-accessible remote desktop (provider web console or a
  properly authenticated VPN/remote access service; don't expose RDP
  globally with a weak password).
- Sufficient memory/disk for MetaTrader 5, Python SDK, and logging.
  Start with a modest machine and confirm actual resource use.
- Stable clock/NTP, outbound TLS access to the explicitly allowed
  EliteBridge HTTPS API and broker servers; no inbound network access
  is needed for the read-only one-shot publisher.
- Node.js 24.12+ x64, Python 3.11+ x64 and official MetaTrader5 Python
  package, and a trusted installed MetaTrader 5 desktop terminal.
- Your own broker-authorized MT5 account already signed into the
  Windows terminal. The bridge should not ask you to paste passwords
  into chat, source code, GitHub, Vercel or the Android APK.
- App-controlled signing keys stored on the actual Windows host.
  Review Windows ACLs, disk encryption and key isolation/rotation
  before a production launch. Never generate production signing
  keys in Termux and then transmit their private PEM.

## Strict commissioning order once a Windows VPS exists

1. Review/merge the stacked EliteBridge PR chain (4 through 9), migrate
   the EliteTrade database, resolve Vercel deployment checks and enable
   the server-only cloud flags intentionally. Neither a green GitHub
   CI nor an applied SQL migration means the server is deployed.
2. Install and configure approved Windows OS, MetaTrader5 terminal,
   Node 24.12+, Python 3.11+ and official MetaTrader5 Python SDK.
3. Log into the correct DEMO or REAL broker account through MT5.
   The initial production rollout should be DEMO-first.
4. From Windows terminal, run:

       npm run bridge:terminal:init

   Generate the Ed25519 key in that Windows user's private directory.
   Register the PUBLIC PEM for the exact owner-bound account in the
   admin API. REAL enrollment is observation only.
5. Obtain a challenge in the admin API, sign it *locally*:

       npm run bridge:terminal:prove -- <challenge>

   Submit only the signature. Approve the new terminal in the
   administrator session after independent fingerprint confirmation.
6. Configure the following local Windows environment variables
   (never write a broker password or Supabase service key):
   - ELITEBRIDGE_MT5_EXPECT_MODE=demo or real
   - ELITEBRIDGE_MT5_EXPECT_LOGIN=<expected MT5 login number>
   - ELITEBRIDGE_MT5_EXPECT_SERVER=<exact broker server name>
   - ELITEBRIDGE_MT5_SYMBOL=<specific broker symbol>
   - ELITEBRIDGE_ACCOUNT_ID=<owned EliteTrade account UUID>
   - ELITEBRIDGE_TERMINAL_ID=<approved pairing terminal UUID>
7. Run local readiness only:

       npm run bridge:windows:check

   Checks platform, Node, Python 64-bit, MT5 Python SDK, explicit
   account mode, expected broker identity/symbol, UUIDs and local
   signing identity. A readiness PASS is **not** broker verification
   and never authorizes trades.
8. When ready, explicitly run read-only MT5 probing:

       npm run bridge:windows:check -- --probe

   It uses only the existing read-only MT5 Python observer to
   verify a recent quote and expected terminal identity locally;
   does not publish data or authenticate to MT5.
9. Finally, only after the correct cloud build/flags and owner
   approval are verified, send ONE signed heartbeat and quote:

       npm run bridge:terminal:publish

   Check the authenticated administrator's EliteBridge diagnostics
   and verify that the server receives fresh packets.
10. Test disconnects, missing symbols, clock skew, revoked keys,
    duplicate/out-of-order packets, TLS failures and reconnection.
    Never automatically repeat uncertain requests with the same
    sequence numbers.

## REAL account scope

REAL accounts are permitted in **observation mode** but the new
EliteBridge gateway cannot place REAL trades yet. Future order
execution requires a separate authority and signing domain,
independent broker-side reconciliation, account verification,
position/risk controls, an idempotent order ledger, an emergency
kill switch and explicit operator authorization. No DEMO-to-REAL
automatic migration or provider fallback.

## Security and availability notes

- Windows preflight CLI does not print broker logins, credentials,
  private keys, API tokens or raw quote prices.
- Readiness evaluator cannot assert cloud approval or received
  telemetry without independent verification: flags remain false
  in the local CLI until the server confirms them.
- MetaApi remains the current existing provider and is not
  silently replaced by this local preflight.
- Windows VM specs and costs vary; purchase needs your approval.
- If Windows VPS cannot be obtained, Phase 9 remains at a tested
  readiness state rather than a connected broker state.
