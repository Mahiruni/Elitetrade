# EliteBridge — $0 Android/Termux monitoring stage

**Purpose:** allow the existing Android handset to monitor EliteTrade's public HTTPS application availability, with **no account minimum, no VPS, no MetaApi token, no broker password and no Supabase administrator key**. This is a read-only operator monitoring sidecar, **not** an MT5 terminal or a trading gateway.

## Install on your own Android phone

Open the official Termux app and run:

```bash
pkg update
pkg install -y git nodejs tmux
node --version
cd ~
git clone https://github.com/Mahiruni/Elitetrade.git
cd Elitetrade
node scripts/elitebridge-termux-monitor.mjs once
```

If `~/Elitetrade` already exists, replace the clone with:

```bash
cd ~/Elitetrade
git pull --ff-only
node scripts/elitebridge-termux-monitor.mjs once
```

This command performs **one GET** on `https://elitetradee.vercel.app/health`. It checks an HTTPS JSON response, rejects redirects and errors, and displays **REACHABLE** or **UNAVAILABLE** only. Reachable means the website's public /health endpoint answered, **not** that Supabase queries, broker quotes, MT5 positions, automation or orders are functioning.

To keep monitoring **while Android permits Termux to run**, use:

```bash
tmux new -s elitebridge
node scripts/elitebridge-termux-monitor.mjs watch
```

The optional long-running monitor polls **only the public health endpoint every 60 seconds**, printing on status changes and every fifth check. Detach from tmux with Ctrl+B then D; reconnect with `tmux attach -t elitebridge`. Ctrl+C stops the monitor. It cannot run 24/7 if Android kills Termux, removes network, reboots or restricts battery/background activity. A wake lock and unrestricted battery setting may help but drain battery and **do not guarantee availability**.

You can rehearse cryptographic signature and anti-replay validation without using a broker, internet or credentials:

```bash
node scripts/elitebridge-sandbox.mjs
```

The sandbox uses synthetic prices, temporary key pairs and in-memory replay checks. **No synthetic quote should ever be shown as live market data.**

## Production security boundaries

- The monitor does **not** read `.env`, contacts, device identifiers, credentials or trading API tokens; it calls no write endpoints.
- Do **not** run the older `scripts/termux-setup.sh` merely to use this monitor: that legacy **DEMO worker** flow requests a powerful Supabase backend key and a MetaApi token, and carries much greater risk on a mobile phone.
- Do not create or approve a **Windows MT5 terminal identity** from this Android monitor. A Termux key is not proof of an MT5 desktop session.
- Our existing native Windows-only MT5 Python observer cannot run against the MT5 Android application's internal session, and this monitor cannot open or close MT5 orders or read Exness positions.
- If and when the existing MetaApi subscription/broker connection is actually healthy, the *separate* existing EliteTrade DEMO worker may use that real provider connection; it is not enabled by these scripts.
- Do not store broker or admin secrets in a public repo, GitHub workflow log or chat.

## Future unlock for broker-connected Termux

Genuine account/position data or MT5 order execution needs an authorized external broker API available to the trading account **or** a continuously running official desktop MT5 terminal (Windows host, or supported Linux/Wine host subject to actual compatibility). For Exness, the announced first-party API is subject to supported account types and geographic eligibility; it does **not** automatically support standard MT5 accounts. A Termux monitoring script cannot bypass these restrictions.

This stage can be used from GitHub after merge even if Vercel's free production deployment quota is exhausted, because the monitor is **a local Node script**. It still needs the existing public website /health endpoint to be reachable to report REACHABLE.
