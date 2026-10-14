# Elite Engine — Android foreground demo monitoring (beta)

## Architecture

Original EliteTrade signed Android app → user-initiated Android foreground dataSync service (45-second interval) → authenticated, device-verified, admin-only `POST /api/engine/mobile/tick` on the **existing Vercel backend** → server-held `SUPABASE_SECRET_KEY` and `METAAPI_TOKEN` → existing Supabase leases, demo orders, risk checkpoints and broker verification.

The Android APK contains **no privileged Supabase or MetaApi key**. It uses the existing signed-in app session and its device verification. A backend flag `MOBILE_DEMO_ENGINE_ENABLED=true` is needed on production; default disabled until operator verifies all checks and removes the Termux worker.

### Boundaries

- Admin-only pilot. Each pulse processes at most one enabled run owned by that verified admin. The app cannot select an unrelated run, provide order parameters, override risk, or force a signal.
- The existing `/api/bots/:id/control` separately arms/stops a DEMO session. Merely starting Elite Engine publishes heartbeat and evaluates only already-armed runs. If no runs are armed, **zero orders** can be placed.
- The server requires verified MT5 **DEMO**, authorized trading, margin, stop-loss, daily loss limit, drawdown and no outstanding exposure/unreconciled orders before sending any order. Existing DB leases protect against concurrent workers, but **do not deliberately run Termux and Android engines simultaneously**.
- Android uses `FOREGROUND_SERVICE_TYPE_DATA_SYNC` with ongoing notification and explicit stop. Android 15+ caps dataSync FGS runtime (six hours rolling 24h), and Android can still stop the app; not suitable for unattended trading.
- This is an **authenticated serverless request**. If Vercel times out, lacks an up-to-date provider token, or cannot access MetaApi/Supabase, the service reports failure and must NOT fake a healthy connection.

### Deployment and pilot

1. Set valid **rotated** Production `SUPABASE_SECRET_KEY`, `METAAPI_TOKEN`, `METAAPI_REGION` in Vercel. Never embed these in Android or commit them to Git.
2. Stop any Termux `demo-worker.mjs` and verify the process exited.
3. Deploy this feature and verify the server endpoint with an authenticated **admin** account, app device verification, and `MOBILE_DEMO_ENGINE_ENABLED=true` only when ready.
4. Install the latest **signed** Android APK (preserving the existing app's signing identity), open hamburger menu → **Elite Engine**, and tap **Start engine**. The notification should remain visible.
5. First ensure **no bots are armed** and confirm new Supabase heartbeat every 45 seconds. In Bots configure a broker-verified DEMO and risk limits, then explicitly arm a bot to allow legitimate demo trades.
6. Tap **Stop engine** to stop pulses. Stop/close a previously armed bot separately in Bots; existing broker stops and take-profits are not canceled automatically by Android service stop.
7. Disable `MOBILE_DEMO_ENGINE_ENABLED` if incident/abuse discovered.

Test with locked screen, switching apps, loss of cellular data, denied notifications, sleep and Android FGS timeout. DO NOT market as always-on; use paid approved always-on worker when needing persistent service.
