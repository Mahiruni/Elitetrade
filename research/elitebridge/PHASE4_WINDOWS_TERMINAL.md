# EliteBridge Phase 4 — Windows MT5 terminal enrollment & DEMO telemetry

**Implemented:** owner-scoped Ed25519 terminal enrollment, proof of private-key possession, explicit owner approval/revocation, authenticated replay-protected signed heartbeat/quote intake, and a read-only Windows companion with MQL5 exporter.

**Not yet connected:** no real Windows terminal enrolled; no Windows PC/VPS provisioned; no independent Exness authentication/quote received; no positions, orders, broker execution or REAL-account support. Do not confuse protocol test packets with genuine MT5 activity. Existing MetaApi provider and demo worker stay unchanged.

## Security model

- User is authenticated (Supabase Auth + MFA/device verification) for enrollment, listing, approval and revocation. Registration requires an owned EliteTrade MT5 account.
- Windows host generates Ed25519 private/public keys. Private key stays on the host under the current Windows user's application data. **Never paste or upload the private key, Exness password, RDP password or service-role key.**
- Server issues a 10-minute, one-time challenge. The Windows host signs `EliteBridge/terminal-enrollment/v1\n<terminal-id>\n<nonce>`. Only the public key is stored. Owner must explicitly approve after proof.
- Terminal sends Ed25519 signed, expiring and sequence-numbered DEMO-only packets. Postgres performs an atomic monotonic sequence/replay claim. DB row-level security has no direct client policies; only server-side secret-key operations may access the registry.
- Protocol packets are *self-reported telemetry*, never cryptographic proof of broker login, correct strategy signals, profitable trading or order execution.
- Broker trade API is **not implemented in EliteBridge**. `ordersEnabled:false`, `brokerVerified:false`; the existing third-party MetaApi connection is not replaced automatically.
- No browser-supplied trading commands, provider tokens, MT5 passwords or order RPCs are accepted by the new API. Public rate limiting and packet expiry supplement cryptographic validation.

## On a real Windows PC or hosted Windows VPS (when available)

1. Install the official signed Windows MetaTrader 5 from your broker. Log in to a **dedicated DEMO** account. Confirm `XAUUSDm` is supported. Do not use a REAL account with this read-only exporter.
2. In Windows MetaEditor compile `mt5/EliteBridge_Demo_Telemetry.mq5`. Attach it to an open chart. It runs a 2-second timer and writes only the current broker bid/ask to `Terminal/Common/Files/EliteBridge/quote.csv` with `FILE_COMMON` — no account passwords and no trade placement.
3. Install official Node.js 22+ LTS on that Windows host and clone the EliteTrade repo at a trusted commit. Run:
   ```powershell
   node scripts/elitebridge-terminal-companion.mjs init
   node scripts/elitebridge-terminal-companion.mjs public
   ```
4. In **EliteTrade → Hosted MT5 → Register Windows terminal**, select the saved MT5 account, enter a label and paste the **public PEM key only**. Record the returned terminal UUID and nonce (expires in 10 minutes).
5. On Windows prove possession (the key never leaves Windows):
   ```powershell
   node scripts/elitebridge-terminal-companion.mjs prove TERMINAL_UUID NONCE
   ```
6. Back in EliteTrade select **Check pairing status**, then **Approve identity**. Approved here means only that the signed transport is authorized; it is not a confirmed broker login.
7. Locate the file written by MT5: terminal menu **File → Open Data Folder** points to your terminal's folder, but `FILE_COMMON` uses the *common* terminal directory. Look under `%APPDATA%\MetaQuotes\Terminal\Common\Files\EliteBridge\quote.csv`. Use the actual path discovered on that machine.
8. Start the companion:
   ```powershell
   node scripts/elitebridge-terminal-companion.mjs run TERMINAL_UUID ELITETRADE_ACCOUNT_UUID "C:\\Users\\YourUser\\AppData\\Roaming\\MetaQuotes\\Terminal\\Common\\Files\\EliteBridge\\quote.csv"
   ```
   It reads local DEMO quote exports and submits signed heartbeats/quotes about every 10–20 seconds. The server permanently rejects stale price files, modified signatures, expired packets, replayed sequences, revoked devices and REAL packets.
9. In Hosted MT5 check for **Signed transport fresh**. This confirms receipt and a verified identity, not an MT5 broker account connection. Next milestones: independently verified Windows terminal identity and read-only broker snapshot, durable historical market data, demo-only reconciliation, then optional execution transport with separate audited risk controls.

**Phone/Termux:** The Android app is only the enrollment/control surface. Android MT5 does not expose the Windows MQL5 Expert Advisor runtime; Termux cannot magically provide a Windows terminal API.

## Deployment gates

- `SUPABASE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` must be set **only** in the server production environment; it is never shipped to browser or APK.
- Live Postgres has `elitetrade_bridge_terminals`, `elitetrade_bridge_packets`, `elitetrade_bridge_claim`; tables have RLS enabled without public access.
- Backend unit tests: valid, expired, invalid, revoked/replayed signatures; terminal proof/approval; real account rejection and no order calls.
- Native MQL5 must be compiled **on an actual Windows MT5 MetaEditor** before stating runtime verified. CI JavaScript tests cannot prove that the EA compiles in MetaEditor.
- No Windows host is available in this project yet: deployment of the pairing UI does **not** mean the independent broker gateway is live.
