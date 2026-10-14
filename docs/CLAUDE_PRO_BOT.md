# Claude Pro Bot

The authenticated web route `/claude-pro-bot` and Android hamburger entry **Claude Pro Bot** host the same bundled React/TypeScript interface. The existing `/claudebot` page remains available.

## Data and execution

- **Demo preview** runs deterministic sample OTC/stock signals. The source is labeled on every screen. It does not connect to PocketOption or execute orders.
- **My MT5** loads the member's `/api/accounts` and `/api/bots`, then requests the existing authenticated `/api/bots/:id/preview`. Server strategy/risk evaluation remains authoritative. Missing/stale quotes, unknown account types, insufficient candles, and rejected risk plans cannot produce an actionable direction.
- **Auto run** repeats analysis while Signal is open: 25 seconds after a demo result or 60 seconds after an MT5 result. Leaving Signal, hiding the app, navigating away, going offline, canceling, or a provider error stops the loop. Preferences persist; automation and expired results do not resume after reload.
- **MT5 demo automation** controls the existing `/api/bots/:id/control` only when the account-data demo engine is available. The backend verifies membership, ownership, worker health, demo account type, trading permissions, risk, exposure, and margin. No new worker or live-money execution is introduced. The UI shows worker state returned by the server. Stopping analysis does not stop an independently armed worker; its dedicated Stop control stops new entries.
- Sonnet 5, Opus 5.5, and Fable 5.1 are display presets. No Anthropic model has been integrated. MT5 uses the saved server strategy rather than a client preset or five-second binary expiry.

## Build and release

`npm run build` type-checks the page, bundles React and selected Lucide icons with esbuild, generates prefixed Tailwind utilities without preflight, and copies identical assets into `android-native/app/src/main/assets/claude-pro`.

The web page is lazy-loaded inside the current EliteTrade shell. Its CSS preserves other routes and hides the global mobile tabs on this page so only Today/Signal/Profile appear. Inter and Instrument Serif fonts are self-hosted.

Android renders only packaged assets at the reserved app-assets HTTPS origin. Requests to all other origins are blocked in that WebView. Its small bridge exposes sanitized display data and specific accounts/bots/preview/demo-control operations, with no access token, refresh token, or device cookie passed into JavaScript. PocketOption opens externally. Existing native account/trading/settings links navigate to their native screens.

Android changes trigger the repository's existing signed release workflow on main. Older installed APKs need that release update to receive the new menu and packaged page.

## Verification

Run `npm run build`, `npm run check`, `npm test`, and `node test/claude-pro-browser.mjs` with Playwright Chromium installed. The feature tests cover mobile overflow, the hamburger link, selectors, sequential readings, countdown expiry, both sample directions, repeated analysis, stopping/backgrounding, session history, profile, isolated MT5 previews, and broker errors. Existing regression and Android debug workflows must pass before merge.

## POI Trader OS — new read-only MT5 analysis path

POST /api/bots/:id/preview with poi:true now requests the member's verified broker quote, symbol specification and genuine W1 (1w), H4 (4h), M15 (15m), M5 (5m) candle series through the configured MetaApi account. The native Android bridge passes only the allowlisted poi boolean; no provider credentials enter the webview.

The server-side POI strategy evaluates closed broker candles only. It rejects stale/malformed/missing/duplicate data and recent M15/M5 gaps, determines W1 bias, checks H4 POI proximity, then requires M15 liquidity sweep followed by structure shift and later M5 displacement/break. Spread and entry-distance gates must pass. Results display a timestamped BUY, SELL or WAIT / NO TRADE outcome and eight auditable POI readings. Indicative entry/SL/TP are labeled read-only and do not constitute broker risk approval.

This is NOT a new order execution strategy. Existing MT5 demo worker orders still use the saved trend/scalping/breakout strategy with their established server risk checks. POI results never start or authorize worker orders. Real MT5 accounts are permitted for read-only research only, not unattended live-money execution. Demo OTC readings remain explicitly synthetic and separated from genuine MT5 data.

The model labels in this release refer to display presets only. No Anthropic or other AI inference API, long-running POI worker, historical backtester, live POI order executor or continuous browser-independent polling is supplied by this milestone. Those components require their own integrations, deployment, risk controls and testing and should not be presented as running.

Documentation: MetaApi historical candle endpoint supports 1w, 4h, 15m and 5m for MT5. Broker account status and provider entitlements must be valid for requests to succeed.
