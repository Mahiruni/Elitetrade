# Run the existing EliteTrade DEMO worker on Android using Termux — no paid hosting

This is a **temporary test alternative** to the paid Render background worker. It powers the **existing EliteTrade website's Start bot** functionality by publishing the worker heartbeat to its existing Supabase database. It is **not** a simulation. Eligible demo orders can be submitted through MetaApi when the user explicitly arms a bot in the website.

**Limitations:** Android 16 may stop Termux when the phone sleeps, applies battery optimization, heats up, or loses network. The worker has no guaranteed uptime, and a stale heartbeat disables new starts. **Do not use for unattended or real-money trading.** MetaApi itself may still have usage/hosting charges; Termux only replaces Render's worker hosting cost.

## 1. Prepare Termux (official current Termux build, not obsolete Play Store releases)

```sh
pkg update && pkg upgrade -y
pkg install git nodejs-lts tmux nano -y
node -v
```

Node should be **v24.12.0 or later, below v25**. Current Termux `nodejs-lts` meets this requirement. Worker imports local modules and Node built-ins, so no `npm ci` is needed merely to run it.

```sh
cd ~
git clone https://github.com/Mahiruni/Elitetrade.git
cd Elitetrade
```

If the folder already exists, instead: `cd ~/Elitetrade && git pull --ff-only`.

## 2. Create the private worker configuration

Avoid screenshots, shell history, Github commits, cloud backups or chat messages containing tokens. The Supabase **legacy service_role key** is highly privileged: using it on a mobile device is less secure than on a managed server. Only do this on your own locked, updated phone and remove `.env` when testing ends.

```sh
umask 077
nano .env
```

Paste the following **names** and enter private values locally:

```dotenv
SUPABASE_URL=https://cgpvhayfwnpipktyltho.supabase.co
SUPABASE_SERVICE_ROLE_KEY=REPLACE_LOCALLY_WITH_SUPABASE_LEGACY_SERVICE_ROLE_JWT
METAAPI_TOKEN=REPLACE_LOCALLY_WITH_EXISTING_METAAPI_API_TOKEN
METAAPI_REGION=london
DEMO_EXECUTION_ENABLED=false
```

Save with **Ctrl+O**, Enter, then **Ctrl+X**. Run `chmod 600 .env`. Do not use `termux-setup-storage` or place secrets in `/sdcard`; keep `.env` in Termux private storage.

The MetaApi API token must have access to the *same existing hosted MT5 account* linked in EliteTrade. Use the account's broker trading/master password **only inside MetaApi**, never in this Termux file. The Supabase key must be for the existing dedicated EliteTrade project.

## 3. Safe read-only preflight

```sh
node --env-file=.env scripts/termux-doctor.mjs
```

This checks Node, private environment-variable presence, Supabase account visibility and MetaApi's broker-verified account type. It does **not** start the worker, issue orders or print credentials. Investigate provider errors or missing DEMO status before proceeding.

## 4. Start the actual worker when you are ready for demo execution

**Important:** With `DEMO_EXECUTION_ENABLED=true`, arming a bot in EliteTrade can place real orders **in the broker DEMO account** when signals and risk conditions permit. Never use a real MT5 account. Confirm Exness trial/demo mode, stop-loss, risk %, symbol including suffix, and that the MetaApi subscription permits usage.

```sh
sed -i 's/^DEMO_EXECUTION_ENABLED=false$/DEMO_EXECUTION_ENABLED=true/' .env
termux-wake-lock
tmux new -s elitetrade
node --env-file=.env scripts/demo-worker.mjs
```

Wait for **`Demo evaluation cycle completed.`** messages. This means the database cycle ran; it does not by itself prove all MetaApi market-data requests succeeded. A heartbeat should appear in `elitetrade_engine_heartbeat`; the website's Start bot check requires a heartbeat newer than 90 seconds.

To detach without stopping: press **Ctrl+B**, then **D**. Reattach with `tmux attach -t elitetrade`. To stop, reattach and press **Ctrl+C**, then optionally `termux-wake-unlock`.

Set Termux battery usage to **Unrestricted**, allow notifications, and keep the device charged and connected. Android can still kill the process. A terminal app can only evaluate bots while the Termux worker is alive. A sudden stop does not close any already-open demo broker position; broker-side SL/TP protections remain.

## 5. Return to original EliteTrade

Sign in to `https://elitetradee.vercel.app/bots`, confirm the exact Exness **DEMO** account, run **Check MT5 status** and **Check broker symbols**, and preview. Only then consider pressing **Start bot**. An unavailable provider feed will still prevent safe arming even when the heartbeat exists.

**Do not** create another hosted MetaApi account, install a separate Render site, or enter secrets in the browser's frontend.

## 6. Cleanup

Stop the worker, set `DEMO_EXECUTION_ENABLED=false`, and when no longer testing, remove the privileged secret file with `rm .env` inside Termux. Do not remove broker order receipts or Supabase records; unresolved/unknown orders require reconciliation.
