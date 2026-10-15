# EliteBridge — operator-controlled Windows VPS for MT5 (DEMO-only)

## Why full Windows VPS

The official MetaTrader5 Python package connects to a Windows MT5 desktop
terminal. A full x64 Windows Server with Desktop Experience and RDP is required
for this companion, not MetaQuotes built-in Virtual Hosting, Vercel, Render
Linux, or Android Termux.

Current stage: a local read-only Windows DEMO probe. It does not transmit
terminal data to EliteTrade, register an actual device, or execute orders.
Our ebd_ API tokens remain status-only. MetaApi is unchanged.

## Select and order a VPS

Choose an operator-controlled Windows Server VPS with:
- Windows x64 Desktop Experience and RDP with a valid license.
- Minimum 2 vCPU/4 GB RAM, preferred 4 vCPU/8 GB RAM and SSD.
- Broker-near region chosen by measured trade-server latency.
- Provider IP-restricted RDP firewall/VPN, console recovery and snapshots.
- Transparent price including setup/renewal, OS license, tax and support.

Purchase in the provider dashboard after reviewing terms. Do not put
payment information, RDP credentials or broker passwords in ChatGPT.
A Windows VPS must be acquired before we can run a real MT5 terminal.

## Access it using your Android phone

Use a trusted Android RDP client and the provider's confidential
connection details. Restrict TCP 3389 at provider level to a VPN or
trusted source IP; enable security updates and take a snapshot.
Do not disable the firewall, publicize RDP or enable insecure auto-logon.

## Install on the remote Windows desktop

Install official MetaTrader 5 for your broker, supported 64-bit Python
3.11+, Node.js 24, and Git for Windows. Open PowerShell on the VPS,
then run after reviewing the commands:

    python -m pip install MetaTrader5
    git clone https://github.com/Mahiruni/Elitetrade.git
    cd Elitetrade
    git fetch origin feat/elitebridge-windows-mt5-demo-local-companion
    git switch -c elitebridge-vps-lab --track origin/feat/elitebridge-windows-mt5-demo-local-companion
    powershell -NoProfile -File .\scripts\elitebridge-windows-vps-preflight.ps1 -Mode Audit

The audit checks Windows architecture, CPU, RAM, Defender Firewall,
Git, Node, Python SDK, running MT5 process, and local companion files.
It changes no settings, attempts no MT5 login and transmits nothing.
Use -Mode Ready to fail when any prerequisite is missing.

## Verify a genuine DEMO terminal

In the remote MT5 desktop interface itself, sign in to an authorized
DEMO account. Never type the trading password into an EliteBridge
script. Run the guided local-only broker probe:

    powershell -NoProfile -File .\scripts\elitebridge-windows-demo-probe.ps1

Supply the expected public login number, exact DEMO server name and
symbol such as XAUUSDm when prompted. The Python probe reads the
already-authenticated terminal and rejects REAL/CONTEST accounts,
mismatched logins/servers, stale quotes and malformed bid/ask.

Expected successful labels:

    REAL WINDOWS MT5 DEMO TERMINAL: read-only observation collected
    LOCAL Ed25519 PACKETS VERIFIED: 2
    BROKER VERIFIED BY SERVER: NO (terminal-reported only)
    DEVICE ENROLLED: NO | NETWORK REQUESTS: 0 | ORDERS: 0

The packets use temporary in-memory signing keys. They do not go to
Supabase or our gateway, and are not market-order authorizations.

## 24/7 reliability and security limitations

VPS uptime is not the same as persistent MT5 terminal uptime. After
reboot, updates and Remote Desktop disconnects we must separately
verify MT5 GUI startup, Windows interactive session persistence, broker
reconnection, quote freshness and network outages. Prefer RDP
disconnect over session logoff when monitoring; do not assume the
desktop terminal will run as a non-interactive Windows service.
Never store broker passwords in startup scripts or enable insecure
Windows auto-logon to make the GUI persist.

Next development phase: approved device enrollment with unique
pinned Ed25519 keys, challenge-response, secure TLS delivery,
durable PostgreSQL replay protection and signed read-only terminal
quote reports. Independent DEMO execution (and eventual REAL
execution) need separate verified risk and order-reconciliation
milestones. Nothing in this runbook sends a trade.

## Official references

MetaTrader desktop installation:
https://www.metatrader5.com/en/terminal/help/start_advanced/installation

MetaTrader Python initialize API:
https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py

MetaTrader built-in virtual hosting restrictions:
https://www.metatrader5.com/en/terminal/help/virtual_hosting/virtual_hosting_migration

Deployment state: development branch PR #49 stacked on PR #48.
Production, Supabase migration, MetaApi and current bots unchanged.
