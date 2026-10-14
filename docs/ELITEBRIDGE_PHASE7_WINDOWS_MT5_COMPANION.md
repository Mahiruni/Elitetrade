# EliteBridge Phase 7A — Real Windows MT5 DEMO read-only companion

## Objective

Keep Supabase as EliteTrade's database and account/MFA/device approval system,
and keep the existing MetaApi production pathway intact. Build an independent
terminal adapter for a **genuine** installed MetaTrader 5 DEMO terminal.

This milestone implements:
- Python adapter \`companion/mt5_readonly_probe.py\` using the official
  \`MetaTrader5\` Python SDK on **Windows 64-bit**.
- After \`mt5.initialize()\`, it checks \`terminal_info().connected\`, actual
  \`account_info().trade_mode == ACCOUNT_TRADE_MODE_DEMO\`, the expected
  account login and exact broker server. It refuses REAL and CONTEST modes,
  mismatched accounts and stale quotes.
- Reads a tick from \`symbol_info_tick()\` and stops if the symbol isn't
  already available in Market Watch. It does not select symbols, log in,
  modify account state or place orders.
- Node.js companion \`scripts/elitebridge-mt5-probe.mjs\` combines the
  terminal observation with an **ephemeral throwaway Ed25519 test key**,
  signs a heartbeat and quote in the existing EliteBridge protocol v3,
  verifies them locally, then shows only sanitized status.
- It does not retain secrets, store keys, submit telemetry to Supabase,
  enroll devices, invoke MetaApi, or execute broker orders.

**Security limit:** The local Python check uses real terminal data when run
on a Windows MT5 host, but the Supabase server cannot yet independently
authenticate the MT5 terminal or its broker. This is not a complete MetaApi
replacement and **does not activate** the Phase 6 server feature flags.

## No Windows computer yet? Do nothing on Termux.
The official MetaTrader5 Python distribution provides Windows wheels. Do
**not** try \`pip install MetaTrader5\` on Android/Termux to run this adapter.
GitHub CI uses injected simulated terminal responses to prove safety, but
cannot verify a genuine broker connection without access to a Windows MT5
terminal. The Android EliteTrade app remains unchanged.

## On a future 64-bit Windows PC or Windows VPS
Prerequisites:
1. Install MetaTrader 5 from the broker; sign in manually to a DEMO account.
   Do not supply MT5 passwords to EliteBridge or to ChatGPT.
2. Install Python 3.11+ 64-bit, Node.js 24+, Git.
3. In PowerShell under a standard (non-administrator) Windows user:
   \`python -m pip install MetaTrader5\`
   \`git clone https://github.com/Mahiruni/Elitetrade.git\`
   \`cd Elitetrade\`
   \`git fetch origin\`
   \`git switch --track origin/feat/elitebridge-phase7-windows-mt5-companion\`
4. Set four local session variables (examples below are placeholders, not real
   login credentials). Account/device UUIDs are EliteTrade application IDs,
   not MT5 login numbers:

   \`$env:ELITEBRIDGE_ACCOUNT_ID="11111111-1111-4111-8111-111111111111"\`
   \`$env:ELITEBRIDGE_DEVICE_ID="22222222-2222-4222-8222-222222222222"\`
   \`$env:ELITEBRIDGE_MT5_EXPECT_LOGIN="12345678"\`
   \`$env:ELITEBRIDGE_MT5_EXPECT_SERVER="YourBroker-Demo"\`
   \`$env:ELITEBRIDGE_MT5_SYMBOL="XAUUSDm"\`

5. Ensure MT5's Market Watch shows the requested symbol, then run:
   \`node scripts/elitebridge-mt5-probe.mjs\`

Expected status format (only when a genuine read-only DEMO terminal probe works):
\`\`\`
REAL WINDOWS MT5 DEMO TERMINAL: read-only observation collected
SYMBOL: XAUUSDm | BID: ... | ASK: ...
LOCAL Ed25519 PACKETS VERIFIED: 2
BROKER VERIFIED BY SERVER: NO (terminal-reported only)
DEVICE ENROLLED: NO | NETWORK REQUESTS: 0 | ORDERS: 0
\`\`\`
An error is reported as a **sanitized category**, never raw credentials.
Do not share login details, screenshots of trading terminals, app access
tokens, or account passwords.

## Continuous operation and actual cloud delivery are NOT implemented yet

**Phase 7B** must add a durable, encrypted/OS-bound private key,
authenticated device-specific onboarding and session tokens that don't
depend on copying a browser access token to the terminal, per-device
revocation and replay-safe delivery, exponential retry, explicit freshness,
and no execution permissions. Broker identity and terminal connection
must be independently reviewed before claiming a working MT5 gateway.

**Phase 8** can evaluate independent broker execution and reconciliation
using DEMO accounts only, but no execution changes are allowed without
a separate detailed risk assessment, broker support review, and user approval.

## Automated checks

CI workflow \`.github/workflows/elitebridge-phase7-mt5-lab.yml\` runs:
- Python unit tests with injected terminal, account and tick responses;
- Node Ed25519 signing and strict protocol validation tests;
- Existing repository build/test/browser and Supabase SQL rehearsals.

**No Supabase migrations are applied or production deployments triggered.**
The Phase 4/4.1/6 migration stack remains gated behind reviewed staging
validation and backup checks.
