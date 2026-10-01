# Deployment and operations

## Persistent production server

Use one application process with a persistent local disk. The SQLite connection and live support event stream are designed for one server instance. Do not run multiple replicas or place the data file on network storage. For horizontal scaling, migrate persistence to a shared database and support events to a shared event bus first.

1. Clone this repository on the intended server and install Docker/Compose.
2. Copy `.env.example` to `.env`.
3. Set `APP_DOMAIN` to the intended domain and `APP_ORIGIN=https://your-domain`.
4. Generate a private encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` and put it in `ENCRYPTION_KEY`. Preserve this key separately; losing it makes stored MT5 credentials and MFA secrets unreadable.
5. Configure SMTP, MT5 gateway and Telegram only for services you actually use. Keep `.env` private.
6. Point DNS at this server and allow ports 80 and 443. For an existing live domain, perform a database backup and validate on a staging domain before changing DNS.
7. Run `docker compose up -d --build`. Caddy handles TLS and forwards to the application on its private container network.
8. Register your own user account, then run `docker compose exec app npm run admin -- your-email@example.com`. Sign in again.
9. Add verified payment destinations in Administration and check the displayed subscription price. No external destination is assumed.
10. Verify registration, sign-in, password recovery to a controlled mailbox, member access, support replies, payment review, and a demo-broker connection before enabling real trading.

Do not expose the application container's port directly when `TRUST_PROXY=true`; the included Caddy service overwrites forwarded-client-IP headers. For deployments without a trusted proxy leave `TRUST_PROXY=false`.

## Backups

Run a consistent online backup using SQLite's backup API:

```sh
docker compose exec app npm run backup
```

Backups are stored in the `app_backups` volume. Copy them to a separate encrypted storage location and retain the corresponding encryption key. A backup on the same disk is not sufficient disaster recovery. Back up before an upgrade and after configuration changes.

To restore, stop the app, preserve the current database, copy the selected backup to the configured SQLite path, remove stale WAL/SHM files from the stopped database, restore the correct `ENCRYPTION_KEY`, then start and verify the application. Do not overwrite a live database.

## MFA recovery

After independently verifying the account owner's identity, a server operator can reset a lost authenticator:

```sh
docker compose exec app npm run admin -- user@example.com --reset-mfa
```

This removes MFA, revokes sessions, and writes an audit entry. It does not grant administrator access when `--reset-mfa` is used. No public bypass or default recovery password exists.

## Service setup

SMTP requires `SMTP_HOST`, `MAIL_FROM`, and normally `SMTP_USER`/`SMTP_PASS`. Port 587 uses required STARTTLS. For port 465 set `SMTP_SECURE=true`. Recovery links use `APP_ORIGIN`, expire in 30 minutes, and place tokens in the URL fragment to reduce server-log exposure.

Telegram requires `TELEGRAM_BOT_TOKEN`. Set the numeric chat ID in Administration and use its test button to check delivery. A notification failure does not roll back a submitted payment.

MT5 requires both `MT5_GATEWAY_URL` and `MT5_GATEWAY_TOKEN`. See `MT5_GATEWAY.md`. HTTPS is required outside local development. Never put broker passwords or gateway credentials in browser code or Git.

## Operational behavior

- Subscription approval grants lifetime access; there is no recurring billing engine.
- Pool results are administrator reports. The system records contributions but does not itself custody, distribute, or trade pooled money.
- Referral payouts reserve available earnings. Administrators mark them paid only after completing the external transfer and entering its reference.
- A bot stop request remains available after subscription deactivation. Account deletion requires every assigned bot to be stopped and the gateway to confirm disconnection.
- Disabling a user with running/unknown bots is blocked until the bots are stopped.
- Access and payment changes are audited. This is an operational audit log, not immutable external compliance storage.
- Existing production accounts are not imported automatically. Migrate only from an authorized database export; preserve password-hash compatibility or provide a verified password reset path.

## Health and validation

`GET /health` returns application liveness. `npm run check` and `npm test` run in GitHub Actions on pushes and pull requests. A healthy process does not establish that SMTP or a broker connection works; validate those services separately.
