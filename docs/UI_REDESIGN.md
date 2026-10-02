# Elite Bot TradingView-inspired interface

The frontend now uses blue actions, dark navy and neutral panels, white light-mode cards, bold sans-serif headings and a compact terminal workspace. The existing Elite Bot name and all product information are retained; the interface does not claim a TradingView affiliation.

## Presentation changes

- New blue ET monogram and matching favicon replace the gold frontend mark.
- Rebuilt homepage composition with centered headline, horizontal operations panel, feature cards and consistent section hierarchy. Existing copy and links are retained.
- Compact sidebar and header plus account, bot and support shortcuts. Gateway labels distinguish configuration from verified live connectivity.
- Restyled account statistics, cards, badges, tables, administrator tabs, forms, notices, dialogs, support conversations, subscription and legal pages.
- Authentication uses the same material and type system in both themes.
- Light/dark preferences, browser theme color, accessible drawer, keyboard focus, responsive wrapping and reduced-motion handling remain supported.

Only frontend files change for this redesign. Supabase records, payment/access states, MT5 connections, API configuration, backend authorization and trading-engine boundaries are retained. No new external dependencies, fonts, trackers or fake market/performance data are added.

## Verification

- `npm run check`: JavaScript syntax and entrypoint checks.
- `npm test`: 24 application/provider tests.
- `CHROMIUM_EXECUTABLE=/path/to/chromium node test/browser.mjs`: public and member overflow checks at 320, 360, 390, 430, 768, 1024, 1280, 1440 and 1728 pixels, both themes.
- Browser journeys exercise registration, profile persistence, admin tabs, payments, MT5 details, bot settings and support replies, plus drawer and theme controls.
- Inspect desktop and mobile homepage/authentication/workspace screenshots.

Browser verification uses isolated SQLite and a test-only auth adapter. It does not mutate production data or verify a live MetaApi connection. Production deployment is checked separately.
