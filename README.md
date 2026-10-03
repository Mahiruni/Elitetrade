# Elite Bot / Elitetrade

An editable, runnable trading-account application reconstructed from the public EliteBot interface. The original retrieved files remain in `recovered-frontend/` and `archives/` for reference. This app has its own database; it does not contain the original site's private users, backend, broker integration, or trading strategies.

## Run locally

Requires Node.js 24.12 or later in the Node 24 release line.

```sh
npm ci
cp .env.example .env
npm start
```

Open `http://localhost:3000`. Register an account, then grant that existing account administrator access from the server:

```sh
npm run admin -- your-email@example.com
```

Sign in again and open Administration. Add your payment methods before accepting subscriptions. No default administrator password, payment destination, sample balance, or funded account is supplied.

## Implemented workflows

| Area | Behavior |
| --- | --- |
| Accounts | Persistent registration, login/logout, profile updates, password changes, hashed passwords, server sessions, rate limiting, CSRF and origin validation |
| Recovery | Single-use, expiring reset links sent through configured SMTP; revokes existing sessions on reset |
| Two-factor authentication | Authenticator QR enrollment, verified activation, login challenge, replay protection, password/code-verified disable |
| Subscription | Configurable lifetime price, payment destinations, duplicate-reference protection, member payment history, administrator review and activation |
| Ebook | $50 Strategy Rulebook on the homepage, a free PDF preview, manual payment approval, and protected buyer downloads; see [ebook sales](docs/EBOOK_SALES.md) |
| MT5 | Encrypted credential storage, administrator review, broker gateway adapter, confirmed connection status, account removal |
| Bots | Persistent account/strategy/risk configuration; start/stop only with gateway acknowledgment; unresolved commands show unknown status |
| Pool | Administrator-created rounds, contribution submissions, approved allocations, total funding, and explicitly administrator-reported profit/loss |
| Referrals | Actual referral attribution, commissions on approved subscriptions, payout requests, administrator completion/rejection |
| Support | Private guest/member conversations, stored messages, live replies, administrator inbox and closure |
| Administration | Member access/roles, payment review, payment methods, MT5 review, rounds, payouts, price, service status, Telegram alert test, activity log |
| Interface | Responsive desktop/mobile navigation, light/dark theme, loading/empty/error states, accessible forms and dialogs |

## Connections still required for production

- **Hosting:** run this Node service on a persistent server or container. The included Docker Compose/Caddy setup provisions HTTPS and persistent database volumes. A static host or ephemeral serverless filesystem cannot run this database safely.
- **Email:** set SMTP variables and `MAIL_FROM` for password-recovery delivery. Without these, the app reports that recovery is unavailable.
- **Trading:** supply a working MT5 gateway implementing [the contract](docs/MT5_GATEWAY.md), and the actual EA/strategy execution service. The website is the control plane, not a broker or a recovered trading engine. No original EA source was present in the public files. Until a gateway is connected, trading stays unavailable and balances are not fabricated.
- **Payments:** add the operator's real payment destinations in Administration. Payments and payout transfers are verified/completed manually; this build does not automatically debit cards, verify blockchain transfers, or transfer pool funds.
- **Existing members:** migration requires an authorized export from the original database. Original users are not copied from elitebot.live.

See [deployment and operation](docs/DEPLOYMENT.md). Publishing to GitHub does not by itself deploy to `elitebot.live`.

## Verification

```sh
npm run check
npm test
```

The integration suite exercises real HTTP requests and SQLite persistence for auth, MFA, reset links, authorization, payments, referrals, pools, support, encrypted MT5 credentials, and gateway acknowledgments. Email and trading tests use controlled adapters; they do not send email or execute broker trades.

Optional full browser verification:

```sh
npm install --no-save playwright
npx playwright install chromium
node test/browser.mjs
```

The browser script uses an isolated in-memory database and local port 4389. It does not modify production data. Screenshots are written to ignored `test-results/`.

## Source layout

- `src/`: HTTP API, SQLite schema, authentication/crypto, service adapters.
- `public/`: editable browser application, theme, original brand asset.
- `scripts/`: syntax checks, administrator bootstrap/MFA recovery, online database backups.
- `test/`: API integration and browser verification.
- `docs/`: deployment, operations, integration boundaries.
- `recovered-frontend/`: unchanged original public retrieval and function map.

All application data, local encryption keys, credentials, and backups are excluded from Git.
