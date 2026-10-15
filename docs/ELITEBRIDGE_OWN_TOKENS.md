# EliteBridge API Tokens — Stage 1 (read-only, NOT MetaApi keys)

EliteBridge can issue its own cryptographically random `ebd_` status-only tokens
once the reviewed private Supabase schema is deployed. **These cannot be used
on metaapi.cloud** and do not replace a broker connection, or enable any trade.

## Authentication contract

- Token format: `ebd_` followed by 43 Base64URL characters (256-bit key).
- The server returns the secret **only once** when the key is issued.
- SHA-256 with a domain-separated prefix is persisted in the
  `elitetrade_private.elitetrade_bridge_api_tokens` table. The original
  plaintext is never stored or returned by the inventory endpoint.
- Scope: `bridge:status` only; no MetaApi token, MT5 password, brokerage
  trade execution, bot-control command, quote or account detail can be read.
- Creation and revocation require existing Supabase admin identity, verified
  browser/device, completed MFA (`aal2`), and active privileged RPC grants.
- Lifetime 1–720 hours; max 5 active keys; any key can be revoked immediately.
- A key cannot be created if MFA has not been enrolled and verified.
- The status verifier uses a Supabase **server-side secret** only. It does
  not authenticate via a user session and never embeds a secret in Android.

## HTTPS endpoints (feature-flagged OFF until production review)

An authenticated, MFA-completed administrator can manage keys with:

- `GET /api/elitebridge/tokens`: redacted active/expired/revoked inventory.
- `POST /api/elitebridge/tokens` body `{"label":"Terminal monitor","expiresHours":168}`: receive `token` exactly once.
- `POST /api/elitebridge/tokens/revoke` body `{"id":"<issued UUID>"}`: revoke owned key immediately.

A registered client can query a non-sensitive capability heartbeat:

```sh
curl -H "Authorization: EliteBridge ebd_<your-secret>" \
     "https://YOUR-ELITETRADE-HOST/api/elitebridge/token/status"
```

This endpoint confirms only **our token authentication is online**.
A valid token must never be interpreted as proof of a verified broker session.
The response always explicitly says `mt5TerminalConnected:false`,
`brokerVerified:false`, `tradeExecutionEnabled:false`, and
`metaapiFallbackPreserved:true`.

## Deployment gates

1. Review PR and pass browser, application, native Android, and **real
   disposable PostgreSQL 16** security integration checks.
2. Confirm completed production Supabase backup, rollback plan, authorized
   admin MFA accounts, and any outstanding Supabase migration drift. Stage the
   SQL on a disposable project before applying to production.
3. Apply `supabase/migrations/20261015000600_elitebridge_owned_tokens.sql`
   as a discrete migration and verify grants, owner isolation and expiry.
4. Confirm a production `SUPABASE_SECRET_KEY` (or legacy service role key)
   is present only on the server and is never exposed. Do not copy it into
   mobile builds, user messages or browser code.
5. Set `ELITEBRIDGE_TOKENS_ENABLED=true` only after the DB RPCs exist;
   deploy the app backend and signed Android app; test issuance, validation,
   immediate revocation, cross-account denial, and log redaction. Never print
   a token in application logs, error traces, screenshots or test output.
6. Keep the MetaApi integration, DEMO engine and any armed trading bot
   unchanged. The existing EliteBridge signed telemetry/Windows MT5
   companion in stacked development PRs require separate reviewed enrollment
   and terminal testing, including a real broker DEMO validation, before
   any self-hosted market feed or order execution.

## Operational limits

EliteBridge's own API token is **not** a MetaApi-issued token, broker password,
terminal session or replacement for MetaApi's market-data infrastructure.
Real MT5 connectivity still requires an appropriate Windows MT5 terminal,
EA/companion or supported broker API, plus device enrollment and continuous
verified communication. A phone-only Termux demonstration cannot itself
authenticate to MT5 or generate genuine independent market data.
