# EliteEnginePro — independent execution evidence

Audit date: 2026-10-16 UTC. Product remains inside EliteTrade Web and Android.

## Current conclusion

A durable independent execution **foundation** is implemented. Broker execution
is not commissioned. No order was sent, no account was migrated, no credentials
were read from existing users, and no additional hosting resource was created.

First operational blocker: an authorized persistent host running a real MT5
terminal, with securely supplied owner-approved Exness demo credentials. The
read-only SDK gateway already in the repository remains a candidate, not broker
proof. There is no executable independent order adapter or production strategy
scheduler in this milestone. Existing MetaApi/Android execution stays separate.

## Rechecked connectivity paths

| Path | Evidence and compatibility | Decision |
|---|---|---|
| Exness native API | Exness help updated September 29, 2026 explicitly excludes standard MetaTrader accounts and limits access to Vietnam/Thailand. Official REST/WebSocket capability is not proof of compatibility with these MT5 accounts. | Do not silently switch account platform or region. |
| Official MT5 terminal/Python interface | MetaQuotes documents initialize against a terminal executable, exact server and login. | Reference connector mechanism; existing demo read-only implementation retained. |
| Linux/Wine terminal | MetaQuotes documents installation using Wine. Existing experimental SDK import timed out; no terminal is commissioned. | Candidate requiring actual terminal, broker, recovery and security tests. No backend Windows-elimination claim. |
| Operator-managed Windows terminal | Requires an authorized host, terminal installation and broker session. None supplied to this task. | Possible fallback, not newly provisioned. |
| Licensed institutional gateway | No applicable retail license/access established. | Do not assume access or implement a fictitious public MT5 protocol. |

No measured broker latency, terminal resource sizing, continuous uptime, or
current production hosting cost is available for an independent runtime.

Primary references checked:

- https://get.exness.help/hc/en-us/articles/27866287512476-Exness-API
- https://www.metatrader5.com/en/terminal/help/start_advanced/install_linux
- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
- https://www.postgresql.org/docs/current/explicit-locking.html
- https://supabase.com/docs/guides/database/postgres/row-level-security

The Supabase changelog was checked. Its October 12 CBC-cipher deprecation notice
is scheduled from November 10; this change uses the existing modern HTTPS clients
and does not alter TLS configuration.

## Delivered backend increment

The CLI-generated migration
`20261016172242_eliteenginepro_durable_intents.sql` adds private account controls,
intents and audit events. It does not rewrite any legacy engine table/function.

- Account controls default stopped; no resume/arming/commissioning RPC exists.
- One unresolved intent per account, with stable signal identity and immutable
  configuration version per signal. Changed configuration cannot submit the same
  signal again under a different version.
- Typed decimal-string commands; arbitrary payload/credential fields rejected.
- Serialized account row locks, renewable worker leases and bigint fencing epochs.
- State transitions reject invalid lifecycle jumps.
- Submission requires future commissioning and authorization timestamps and an
  Exness Trial server binding. These are necessary gates, not a complete risk or
  broker authentication system. No production caller populates those timestamps.
- A new lease converts interrupted submitting intents to unknown.
- Owner stop invalidates the lease, cancels unsent intents, preserves submitting
  requests as unknown, and leaves accepted/unknown work awaiting reconciliation.
- Reconciliation remains possible while stopped and requires a receipt identifier.
  Database receipt validation does not prove the receipt came from a broker;
  authenticated adapter/history matching remains unfinished.
- No database fence can retract an HTTP request already sent to a broker. An old
  process might still have a request in flight. Unknown outcomes remain blocked;
  no exactly-once broker guarantee is claimed.

`src/eliteenginepro-ledger.mjs` supplies a trusted worker RPC client, stable signal
keys, command validation and a versioned execution-adapter capability contract.
The actual read-only observer fails that execution contract. The client does not
call a broker, schedule trades or fall back to MetaApi.

## Web and native controls

- Existing authenticated workspace: `/eliteenginepro`.
- Owner-scoped read: `GET /api/engine/pro/accounts/:id`.
- Persistent stop: `POST /api/engine/pro/accounts/:id/stop` with `{}` only.
- Separate read/stop rate limits prevent status polling consuming the stop quota.
- Ownership, current MFA and browser/device verification are checked by the API
  and private database implementation. Inactive subscriptions may still stop;
  disabled profiles remain subject to existing access restrictions.
- Public RPC wrappers use security invoker. Private privileged owner functions
  explicitly check ownership and existing browser verification.
- Worker RPCs are service-role-only. Private tables are inaccessible to clients.
- Stop affects the independent engine only, not legacy MetaApi monitoring or
  broker positions. Both interfaces say this explicitly.
- Native source includes account selection, saved stop state and stop requests.
  Debug compilation passed in GitHub Actions run 38941142156 (BUILD SUCCESSFUL).
  An APK artifact was uploaded; no physical Android device acceptance test was
  performed. Signed production release is verified separately after main deploy.

## Verification obtained

- Actual PostgreSQL 16 rehearsal succeeded on GitHub Actions run 38939809386.
  Its receipts, authorization flags and broker values are synthetic fixtures.
- Rehearsal covers owner/device/MFA isolation, competing workers, persistent stop,
  duplicate signals, configuration conflicts, invalid commands, real-server
  rejection, expired authorization, invalid transitions, crash-after-submission,
  stale worker fencing and reconciliation while stopped.
- Local suite: 405 tests passed. Responsive browser fixture passed explicit stop,
  unconfirmed stop, refresh failure/recovery, navigation during a pending request,
  four widths (320/390/768/1440) and light/dark themes.
- Migration applied successfully to existing Supabase project cgpvhayfwnpipktyltho.
- Production inspection: 3 new RLS-enabled tables and 3 worker policies;
  anonymous cannot call owner RPC; authenticated cannot call worker claim or read
  private intents; service role cannot update/delete/truncate audit events.
- At post-migration inspection: 0 new account-control rows, 0 new intents,
  0 enabled legacy runs. No customer automation was armed for verification.
- Pre-migration operational audit: 0 enrolled terminals, 0 enabled legacy runs;
  legacy heartbeat 2026-10-16 16:47:12.505+00. A heartbeat is not host/broker proof.
- Supabase advisors reported no new enginepro findings. Existing findings remain:
  private/ingest tables with no policies, guest support SECURITY DEFINER entry
  points and disabled leaked-password protection. Their behavior was not changed.
  Relevant advisor references:
  https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
  https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
  https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable
  https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Evidence boundaries

| Capability | Implemented | Locally/CI tested | Production commissioned | Broker verified |
|---|---|---|---|---|
| Private durable ledger and owner stop | Yes | Yes, real PostgreSQL and isolated API/UI fixtures | Schema installed; authenticated customer control journey not exercised with a live user session | Not applicable |
| Read-only MT5 gateway | Existing code | SDK fixtures/display checks | No | No |
| Independent scheduling and risk integration | No | No | No | No |
| Independent broker order adapter | No | No | No | No |
| Backend restart without duplicate broker order | Database case tested | Synthetic broker outcome | No live runtime test | No |
| Phone-off trading continuity | Required architecture | No physical device/backend test | No | No |
| Real-money execution | Locked | No order submitted | No | No |

## Next commissioning action

Use an explicitly authorized persistent host and one owner-approved Exness demo
account. Install/verify the real terminal, then prove identity, quotes, positions
and reconnect behavior through the existing read-only gateway. Only after that
implement the execution adapter and connect existing risk/strategy logic to the
ledger, commission worker identities and authorization, and agree a bounded demo
order scope. Credentials must enter a secure setup path, never ordinary chat.

## Experimental Render cleanup

The rejected free compatibility service srv-db95d1s9v7es739jjfj0 is not used by
EliteTrade's independent path. Its suspend/delete operation is unavailable through
the connector. Proposed cleanup: suspend this exact service, disable its automatic
deployments, then remove it when reviewed. Preserve elitetrade-paper-demo. No
cleanup success, additional service creation, paid upgrade or migration is claimed.
