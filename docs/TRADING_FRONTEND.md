# EliteBot trading frontend

EliteBot now uses a compact charcoal and gold trading workspace with a complete light theme. The approved EB logo, existing account access, authentication, subscription, administration, support, MT5 review, and bot-command workflows remain in place. Interface text is English only.

## Navigation and presentation

- Mobile: labeled Home / Markets / Trade / Bots / Account tabs, safe-area padding, a frosted bottom bar, compact logo/page header, notifications and account access. Secondary navigation and the theme toggle live in a keyboard-contained bottom sheet with Escape/backdrop dismissal.
- Desktop: compact sidebar and header; Trade places a candlestick workspace next to execution context, with broker positions below.
- Dashboard: balance/connection, open P/L, unavailable daily P/L, active positions, three primary actions, watchlist, bot state, activity, performance where supplied, and actionable notifications.
- Supporting text is 12–14px, page titles 24–28px, and financial figures use tabular numerals. Gold marks navigation/actions; green/red mark price movement, buy/sell exposure and P/L. Both themes use readable foregrounds and visible focus.

## Data and supported controls

The existing authenticated, owner-scoped POST `/api/bots/:id/preview` still performs no trading action. It now returns an allowlisted maximum of 120 valid OHLC candles, the strategy's native timeframe, and pending-order fields already supplied by the provider. It does not expose provider credentials or metadata. Unknown account types stay unverified.

Trade loads these candles on explicit request and lazy-loads `market-chart.js` only when candles exist. Candlesticks use responsive dimensions; phone views show the most recent 40 candles with readable axes. SMA 20 is a display overlay, not a change to execution strategy. Expansion and Chart / Positions / Orders / History tabs work by mouse, touch and keyboard.

Watchlist percentage change is explicitly **sample change** across loaded broker candle closes, not 24-hour movement or a return. Prices are request-based, with provider timestamps; freshness expires after one minute, including while a view stays open. Failed refreshes retain clearly stale values and show an actionable error. No sample prices or simulated results are shipped in the frontend.

Position tables show entry, SL, TP, lots, side, status and reported P/L. Unknown positions/orders differ from confirmed empty arrays. Per-bot returns, daily realized P/L and completed trade history remain unavailable because the connection does not supply them. Equity performance appears only when the account snapshot supplies history.

There is no manual order entry, order cancellation or position-closing endpoint. These controls are not shown. Execution uses the existing bot configuration and confirmed start/pause workflow. Production MetaApi execution remains demo-only, subject to provider availability, administrator approval, worker heartbeat and existing risk gates. Pausing does not close existing broker positions.

## Performance and safety

Memory-only account/bot snapshots keep navigation immediate while fresh reads run. The previous snapshot banner, stale command locks, per-user account/filter preferences and duplicate-submit prevention remain. Instrument selection, Trade tab, SMA preference and search are saved per user in session storage; market quotes remain memory-only. Configuration mutations clear quote snapshots, and a generation guard rejects preview responses from before a mutation. Reduced-motion preferences disable animation and transitions.

No production users, broker credentials, auth settings or database schema were changed.

## Verification

- `npm run check`: syntax and entrypoint checks.
- `npm test`: 92 passing API/security/auth/trading/payment tests, including candle/order allowlisting and read-only preview response checks.
- `test/browser.mjs`: registration, profile, admin review, subscription/payment flow, MT5 forms, bot configuration, support, navigation, light/dark themes and responsive overflow checks.
- `test/workspace-browser.mjs`: connected-account fixtures, navigation under blocked reads, stale locking/recovery, account/filter persistence, confirmed start/pause, duplicate prevention, live-risk review, offline states, Trade chart/SMA/expansion/tabs, pending orders, instrument search and broker outages. Screens include 320, 360, 390, 768 and 1440px in both themes.
- Browser verification uses an isolated in-memory database and controlled provider/auth fixtures. It does not verify production email delivery, paid MetaApi verification or actual broker execution.
