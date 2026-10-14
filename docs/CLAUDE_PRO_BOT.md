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
