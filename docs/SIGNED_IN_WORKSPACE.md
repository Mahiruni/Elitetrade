# Signed-in workspace

The application now opens `/dashboard` after password or passkey sign-in. Existing signup/subscription, ebook returns, MFA, and unfamiliar-browser verification remain intact.

## Routes and presentation

- Home: selected MT5 account, broker figures, available equity history, open positions, bot status, and actionable issues.
- Markets: configured broker symbols; explicit quote refresh through the existing read-only strategy preview. Prices show the provider timestamp and become stale after one minute.
- Bot: existing configuration and gateway controls, linked account status/type, risk disclosure, and start/pause confirmation.
- Activity and History: latest worker reports; completed trade history explicitly unavailable until a history integration exists.
- Account: MT5, profile/security, notifications, subscription, pool, referrals, support, and sign-out.

Desktop uses a compact sidebar and top bar. Mobile uses Home, Markets, Bot, Activity, Account bottom navigation, safe-area insets, table cards, and bottom-sheet dialogs. The existing public pages and authentication UI retain their styling.

Selection and date/activity filters are stored per user in session storage. Financial data and quotes are not persisted in browser storage. API responses retain `no-store`. Offline command submissions are blocked, confirmed start buttons are disabled, and displayed data is marked stale. No service worker was active in the editable app; the recovered original manifest is not installed by this change.

English and Amharic labels share the same layouts. Bundled Noto Sans Ethiopic supplies the fallback when Benaiah Amharic is not installed; its SIL OFL license is included alongside the font files. User-entered credentials and broker symbols are not translated.

## Data and controls

MetaApi snapshot reads now include open positions when allowed by the provider. Public account responses allowlist position fields; no provider credentials or metadata are exposed. Position retrieval failures preserve available balance/equity and show positions as unavailable rather than zero.

Profit/loss is summed from actual broker position profit values only when the entire returned position list supplies finite profit values. Drawdown stays unavailable without the required peak equity history. No equity history, trades, balances, connection status, or chart samples are generated for the interface.

The current MetaApi engine remains demo-only. Pausing its worker prevents new entries; existing broker positions remain open with their SL/TP. Other gateways receive the existing stop command, with a prompt to verify remaining positions in MT5. Closing positions in the web app is unavailable because no closing endpoint exists. This redesign does not add real-account execution.

All bot commands require explicit confirmation, report pending/success/error states, and prevent duplicate in-flight submissions. Live-account configuration requires a second risk-review submission. Backend ownership, account approval, membership requirements, credential encryption, gateway acknowledgments, and risk calculations remain enforced by the existing backend.

## Verification

- `npm run check`: JavaScript syntax and entrypoint checks.
- `npm test`: API/security/auth/trading/position sanitizer and provider outage tests.
- `node test/browser.mjs`: isolated registration, profile, administration, payments, MT5 forms, bot configuration, support, theme, mobile menu, signed-in routes, language, offline banner, and sign-out. 320–1728px, both themes.
- `node test/workspace-browser.mjs`: isolated broker fixture for confirmed MT5 connections, financial rendering/positions, selected-account/filter persistence, start/pause confirmation, duplicate prevention, live-risk confirmation, offline controls, password sign-in to Overview, and sign-out. 320px, 390px, 768px, and 1440px in both themes and English/Amharic.

Browser verification uses an in-memory database and controlled auth/gateway adapters. It does not verify production email delivery, live Supabase sign-in with a customer account, or actual broker execution. No production users, schemas, or account data were changed.
