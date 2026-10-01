# Elite Bot interface redesign

The public site and operating workspace share a graphite-and-gold visual system with separately tuned light surfaces. A serif accent distinguishes the public headline from the numerical and operational interface. The homepage describes the actual connection/configuration workflow instead of displaying an invented performance chart. Existing routes, product content, form actions, backend integrations and database behavior are preserved.

## Changes

- Consolidated the stylesheet into one organized design system with shared color, radius, spacing and interaction tokens.
- Redesigned marketing, authentication, MT5, bots, subscription, pool, referrals, settings, support, administration and legal page presentation.
- Added public mobile navigation, a visible workspace drawer close control, keyboard focus containment, Escape dismissal and focus restoration.
- Added system theme preference, persisted explicit theme choice and matching browser theme color.
- Improved control contrast, password visibility state, form busy state, loading feedback, typography and responsive wrapping.
- Kept motion limited to loading and short feedback transitions, with reduced-motion overrides. No new fonts, images, libraries or third-party scripts are required.

## Verification

- `npm run check`: JavaScript syntax and entrypoint checks pass.
- `npm test`: all 15 existing application tests pass.
- `node test/browser.mjs`: public and member pages checked for horizontal overflow at 320, 360, 390, 430, 768, 1024, 1280, 1440 and 1728 pixels in both themes.
- Browser journeys pass for registration, profile persistence, admin tabs, payment submission/approval, MT5 account storage, bot configuration and support replies. Mobile navigation, drawer close/Escape behavior and workspace isolation are checked. No page or console errors are recorded.
- Desktop/mobile screenshots inspected for the homepage, authentication and workspace.

Browser journeys use an isolated in-memory database and a test-only authentication adapter. They do not create production Supabase users, send production email, verify live broker execution or establish that the production deployment is serving this commit. The adapter lives only in the browser verification script.

Production deployment status must be verified separately through Vercel. No performance scores or complete WCAG conformance claim are made from these checks.
