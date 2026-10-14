# Claude Pro Bot

The authenticated web route `/claude-pro-bot` and Android hamburger entry **Claude Pro Bot** host the same bundled React/TypeScript interface. The existing `/claudebot` page remains available.

## Data and execution

- **Demo preview** runs deterministic sample OTC/stock signals. The source is labeled on every screen. It does not connect to PocketOption or execute orders.
- **My MT5** loads the member's `/api/accounts` and `/api/bots`, then requests the existing authenticated `/api/bots/:id/preview`. Server strategy/risk evaluation remains authoritative. Missing/stale quotes, unknown account types, insufficient candles, and rejected risk plans cannot produce an actionable direction.
- **Auto run** repeats analysis while Signal is open: 25 seconds after a demo result or 60 seconds after an MT5 result. Leaving Signal, hiding the app, navigating away, going offline, canceling, or a provider error stops the loop. Preferences persist; automation and expired results do not resume after reload.
- **MT5 demo automation** controls the existing `/api/bots/:id/control` only when the account-data demo engine is available. The backend verifies membership, ownership, worker health, demo account type, trading permissions, risk, exposure, and margin. No new worker or live-money execution is introduced. The UI shows worker state returned by the server. Stopping analysis does not stop an independently armed worker; its dedicated Stop control stops new entries.
- Sonnet 5, Opu¶»§q«^