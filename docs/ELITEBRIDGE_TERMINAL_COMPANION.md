# EliteBridge — our first independently operated MT5 terminal companion

## Milestone
An operator-owned Windows PC can use MetaQuotes' official `MetaTrader5`
Python SDK to attach to an **already authenticated** MT5 DEMO terminal,
read a fresh quote and build locally signed EliteBridge v3 packets.

This does not need a MetaApi API token. It also does **not** yet replace
MetaApi for live market feeds, cloud connectivity, bots, or trade execution:
the companion is **local and read-only**. We must not claim otherwise.

We preserve the existing production MetaApi integration and our existing
EliteTrade DEMO/M1/S15 bot configuration. The self-issued `ebd_` tokens
introduced in PR #48 have *status-only scope* and are neither MT5 passwords
nor permission to send telemetry. Reusing one of those keys to submit
terminal packets is expressly prohibited.

## Requirements

- Windows 10/11, 64-bit; Python 3.11+ 64-bit; Node.js 24.
- MetaTrader 5 desktop installed **and currently running**.
- The terminal must be already logged into an MT5 **DEMO** account using
  the broker's ordinary MT5 sign-in UI. Do not enter broker credentials into
  EliteBridge.
- Installed Python package `MetaTrader5` (MetaQuotes official SDK).
  To install on your own Windows PC, run:
  `python -m pip install MetaTrader5`.
  Choose the official Python SDK only; do not install similarly named
  unofficial packages.
- A broker symbol in this terminal such as `XAUUSDm`, exactly as shown
  under Market Watch. A closed market or stale quotes fail verification.

## Test without an MT5 terminal

On Windows, Linux, or Android Termux, from the repo:

```sh
npm run bridge:sandbox
```

This generates ephemeral Ed25519 test keys and proves local replay rejection.
**It does not access or authenticate to any trading account.**

## Real read-only probe, on Windows only

Run from an authorized Windows PowerShell terminal at the repository root:

```powershell
powershell -NoProfile -File scripts/elitebridge-windows-demo-probe.ps1
```

The guided launcher asks for your existing **DEMO login ID**, broker
server **name**, and market **symbol** (no password or API token).

For the advanced command-line option, set the following process-local
environment variables and run `npm run bridge:mt5:local`:
`ELITEBRIDGE_MT5_EXPECT_LOGIN`,
`ELITEBRIDGE_MT5_EXPECT_SERVER`, `ELITEBRIDGE_MT5_SYMBOL`,
`ELITEBRIDGE_ACCOUNT_ID`, `ELITEBRIDGE_DEVICE_ID`.

The last two IDs are *temporary local test UUIDs*, not Supabase enrollment
records or credentials. The Windows launcher generates them automatically.

### What must appear on success

- `REAL WINDOWS MT5 DEMO TERMINAL: read-only observation collected`
- `LOCAL Ed25519 PACKETS VERIFIED: 2`
- `BROKER VERIFIED BY SERVER: NO (terminal-reported only)`
- `DEVICE ENROLLED: NO | NETWORK REQUESTS: 0 | ORDERS: 0`

No buyer/seller action, terminal login, password exchange, order placement,
network request, hosted broker connection, or long-running worker is created.
The signed messages are verified **in memory** and discarded. The token
management service and these local packets are independent components.

### Failure conditions

The companion fails closed for Windows/architecture mismatch, disconnected
terminal, non-DEMO/REAL/CONTEST account, login/server mismatch, stale quote,
invalid bid/ask, malformed identity scope, invalid Ed25519 signature and
replayed packets. It uses a 20-second process timeout.

### Security rules

1. Never send MT5 account passwords, Supabase service role/secret keys,
   MetaApi tokens, raw account data, or private signing keys via chat.
2. Do not publish a private Ed25519 key in GitHub, Vercel, app assets or APK.
3. Real companion deployment must use an **enrolled** hardware/device identity,
   approved/public-key pinning, revocation, mutual challenge proof, and
   durable PostgreSQL anti-replay storage before enabling remote telemetry.
4. Ensure TLS, a per-device rate limit, admin approval, audit trails,
   and server-side account ownership checks. A local probe is not enough.
5. Before any actual DEMO trade, broker-mode verification, lot limits,
   margin, spreads, stop loss/take profit, drawdown limits, duplicate order
   locks and execution receipts must be independently tested.
6. None of this allows REAL-account execution or guarantees profitable
   or faster trades.

## Rollout status

This is a **development-only** companion branch stacked on the earlier
`feat/elitebridge-self-issued-status-tokens` PR #48. No production
Supabase migration was applied, no broker credentials or token scopes
changed, and no live MT5 connection has been verified. A real Windows
DEMO terminal test is still required before network telemetry enrollment
can be considered.

## Our own EliteBridge API token check (separate from MT5)

After PR #48's private token migration has been approved, deployed and
enabled, an administrator can issue a **read-only** EliteBridge key on the
EliteBridge Android page. On any Node 24 device (including Termux), an
operator can verify only **our token service**, without an MT5 terminal:

```sh
# Set these locally in your terminal; never paste a secret into chat.
export ELITEBRIDGE_SERVER_URL=https://elitetradee.vercel.app
export ELITEBRIDGE_OWN_STATUS_TOKEN='YOUR_ISSUED_EBD_TOKEN'
npm run bridge:token:status
unset ELITEBRIDGE_OWN_STATUS_TOKEN
```

The script uses a single HTTPS GET to
`/api/elitebridge/token/status` with a 10-second deadline, does not
follow redirects, never prints the token, and refuses any response
claiming broker verification or order-execution authority. Revoked and
expired tokens fail. This is **not** a quote upload or an authenticated
terminal link; the MT5 Windows probe remains a separate local-only
exercise.

If the token service is not yet deployed, this command will fail
`STATUS_BACKEND_NOT_READY` (or `TOKEN_UNAUTHORIZED_OR_REVOKED`).
No amount of token generation can replace a running, authenticated MT5
terminal or a broker-supported direct API.

## Next milestone

Build separately reviewed, secure terminal-device enrollment (not status
tokens), approved pinned Ed25519 keys, account binding and durable
PostgreSQL replay/audit storage, then forward signed **read-only**
terminal updates through our own gateway. MetaApi remains the working
provider until independently verified DEMO quotes and broker sessions
can be maintained safely and continuously.
