# Project Freedom — independent cloud gateway commissioning

Date: 2026-10-16. Audited production/repository baseline: `9184096c371ad006ad84babe572b9e1b89ba6603`.

## Result and first blocker

Milestone 1 audit and milestone 2 Exness server selection are present. This change
implements a **private, single-account, read-only DEMO gateway** for milestone 3.
It is a commissioning candidate, not a proven production MT5 runtime. Milestone 4
has not passed: no authorized Exness demo session was available to this environment.
No broker credentials were retrieved from existing users. No order was submitted.

The first unresolved operational blocker is a commissioned, continuously running
MT5 terminal host with authorized demo credentials. This is not a server-dropdown
or website-refresh problem. The development container has neither Wine, MT5 nor
Docker. A Vercel deployment deploys the consumer/UI, **not this long-running SDK
gateway**. No new billable service has been provisioned.

Production database inspection returned 0 registered terminals, 0 approved
terminals and 0 signed packets; account counts were 1 connected and 3 pending.
The saved connected record was not reauthenticated during this audit. Latest
engine heartbeat was `2026-10-16 16:11:32.306+00`, with 0 enabled engine runs.
The heartbeat table has no runtime identity: it cannot establish which host sent
the heartbeat, continuous uptime, terminal availability or broker authentication.
No changes were made to these records.

## Actual EliteEngine boundary

`scripts/demo-worker.mjs` requires `METAAPI_TOKEN` and calls the existing MetaApi
adapter. Its loop executes only as long as its process/host exists. `render.yaml`
describes a background worker; a committed Blueprint is not deployment evidence.
`src/mobile-demo-engine.mjs` and `/api/engine/mobile/status` implement a phone-driven
engine pulse; the API explicitly returns `phoneProcessRequired: true`. A recent
heartbeat does not turn this into independent persistent cloud compute.

This gateway owns broker authentication and observation. EliteEngine will own
strategy scheduling, risk, durable commands and reconciliation in a later
milestone. The gateway's `phoneProcessRequired: false` describes its own supervisor
only, not the current trading engine. No phone service or MetaApi worker was
disabled or migrated. Existing subscriptions, roles, bots and connections remain
under the existing code paths.

## Connectivity options evaluated

| Path | Existing Exness MT5 account | Personal Windows PC | Backend Windows OS | Reliability and latency evidence | Licensing / hosting / maintenance |
| --- | --- | --- | --- | --- | --- |
| Native Linux terminal-free MT5 SDK | No supported route established by this research | Not required if an authorized interface exists | None in principle | No authenticated evidence; no latency measured | Public client SDK uses terminal IPC; licensed broker gateway rights/access not available here; costs unknown |
| MT5 + Windows Python SDK under Wine on Linux | Candidate; exact assigned server and credentials still required | Not required | No Windows OS, but Windows binaries + Wine remain | MetaQuotes documents Linux/Wine; headless SDK, broker login, reconnect and persistence still need commissioning | No Windows OS license proposed; terminal/broker terms still apply; always-on Linux compute is not automatically free; compatibility and update maintenance required |
| Managed cloud Windows terminal | Compatible in principle via official terminal SDK | Not required | Required on managed host | Standard SDK route, but no host/session commissioned here; latency unmeasured | Windows/cloud license and persistent compute cost depend on provider; normal OS/terminal maintenance |
| Exness native API | Official help says standard MetaTrader accounts cannot connect | Not required | No | REST/WebSocket documented; eligibility not established for this user | Currently Vietnam/Thailand only according to official help; verification and account standing required; no region workaround or account migration proposed |
| Broker-neutral adapters | Architecture, not a transport by itself | Depends on selected transport | Depends on adapter | Read-only consumer now has a private terminal gateway implementation; execution contract remains separate | Supports future authorized broker APIs without pretending server names are API endpoints |

Selected engineering candidate for existing MT5 accounts: isolated cloud Linux
Wine prefix, MT5 terminal, Windows x64 Python with the official MetaTrader5 SDK,
and this private Node gateway. The official Linux terminal path is documented;
**our headless SDK combination is not live-proven here**. Do not call it the best
technically proven end-to-end solution until its broker acceptance tests pass.
Windows cloud hosting remains a possible adapter; this change does not purchase it.
Personal-PC independence and complete removal of Windows binaries are distinct:
the candidate targets the first and removal of a Windows OS, not the second.

Sources inspected 2026-10-16:

- https://www.metatrader5.com/en/terminal/help/start_advanced/install_linux
- https://www.mql5.com/en/docs/python_metatrader5
- https://www.mql5.com/en/docs/python_metatrader5/mt5initialize_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5accountinfo_py
- https://www.mql5.com/en/docs/python_metatrader5/mt5positionsget_py
- https://get.exness.help/hc/en-us/articles/27866287512476-Exness-API

## Implemented trust boundaries

- No dependency on MetaApi, Supabase service-role credentials or an Android pulse
  inside the private gateway. No broker-wire reverse engineering or web-session scraping.
- One isolated MT5 terminal, Wine prefix and saved EliteTrade account binding per
  service instance. No multi-tenant credential switching. Use an investor password
  for this observation milestone; execution authority is absent regardless.
- `companion/mt5_cloud_gateway.py` authenticates explicitly via SDK `initialize`
  with login/password/server and a specific portable terminal path. It checks
  terminal connectivity, reported Exness company, exact server, login and SDK
  DEMO trade-mode constant; it rechecks identity and connectivity after reads.
  These are trusted-terminal/SDK reports, not an independent broker signature.
- Balance, equity, margin, free margin, floating P/L and complete bounded open
  positions are returned. Empty positions means an actual empty SDK list;
  `None` is rejected. Raw position ticket, account name and MT5 login are omitted.
- A SHA-256 login digest plus exact local account/server/mode binds the snapshot
  to the saved account. The digest is an identity check, not a secret or independent
  attestation. The SDK host remains a trusted security boundary.
- Quote bid/ask and **broker-source** time are checked separately (30-second age
  limit, 2-second future tolerance). Stale/missing ticks return `quote: null` and
  `unavailable-or-stale`; no generated prices. Account observation time is not a
  substitute for price time. No candles/history/instrument specifications yet.
- Windows Python runs under a fixed reviewed launcher with no shell. Passwords
  travel only on child stdin, never argv/env, HTTP telemetry or log lines. SDK
  stderr is discarded. Unknown SDK errors become allowlisted diagnostic codes.
- Configuration is AES-256-GCM encrypted with random IV and protocol AAD. Key,
  vault and service-token files use private permissions; service directory 0700.
  Restrict backups and mount a managed key separately for stronger isolation.
  Encryption cannot protect against a compromised runtime that can read the key.
  MT5/Wine profile files may retain terminal-managed credentials: keep the whole
  prefix private, encrypted at the host/storage layer, and out of public backups.
- Gateway HTTP binds **127.0.0.1 only**, requires a high-entropy per-account bearer
  token and rejects wrong/duplicate account scopes, REAL mode, non-GET methods
  and unknown routes. Use an authenticated HTTPS reverse proxy for remote access.
  There is no browser CORS interface, password upload endpoint, order endpoint,
  connect-button provisioning, or server-side provider switch.
- Supervisor polls without the phone, serializes SDK reads, clears results on
  failure, revalidates freshness on every read, backs off to 60 seconds, and
  blocks after eight failures or immediately for identity/mode mismatch. `check`
  validates private configuration only and never claims a broker session.
- SIGTERM cancels collection and stops the listener. systemd template uses a
  process-group kill, OS file lock, persistent Wine/private state directory,
  restart rate limits and a dedicated service user. An in-process blocked state
  stays blocked until intentional operator intervention; no unconditional
  auto-restart loop defeats it. Host restart reloads encrypted configuration and
  requires a new authenticated snapshot; cached data is never restored as live.

## Cloud host commissioning

These steps apply to an operator-controlled Linux x86_64 cloud host. This is
not a request for the user to run a personal Windows PC. It is also not a claim
that a host has been provisioned. Do not use GitHub Actions as a continuous
trading host; CI runners are temporary and cannot establish persistent operation.

1. Prepare a dedicated unprivileged `elitebridge` account, Node 24, Wine supported
   by the current official MT5 Linux instructions, `xvfb`, `xauth`, `x11-utils`,
   and persistent storage. The service now creates its own private display;
   no personal desktop session is needed. Review current broker/MetaQuotes terms. Do not pipe
   unreviewed remote scripts into a privileged shell. This repo does not download
   or redistribute terminal binaries, Wine or Windows Python.
2. Install the official MT5 terminal and Windows x64 Python into the **same**
   isolated Wine prefix at `/var/lib/elitebridge/wine`. Install and record an
   exact reviewed official MetaTrader5 wheel version using that Windows Python.
   A native Linux Python installation is not a replacement for terminal IPC.
   Record terminal, Wine, Python, SDK and OS versions in commissioning evidence.
3. Configure the broker server with the exact assigned Exness demo server. The
   1–20 dropdown options are candidates; higher valid server numbers remain
   accepted by the profile. An installed terminal may require broker server
   discovery/bootstrap before SDK login can succeed. Never guess a network endpoint.
4. Install reviewed repository source at `/opt/elitetrade`. Give only the service
   user write access to `/var/lib/elitebridge`. Prepare `/etc/elitebridge/gateway.env`
   from `deploy/elitebridge/gateway.env.example`, reviewing actual binary paths
   and Wine's filesystem mapping. Do not set DISPLAY/XAUTHORITY in the environment
   file: the systemd service uses `xvfb-run --auto-servernum` with Xauthority
   authentication, private temporary storage and `-nolisten tcp`. The same service
   owns Node, Wine, MT5 and the display; shutdown kills the process group.
   On a prepared host, run the secret-free `npm run bridge:gateway:doctor` inside
   `xvfb-run` using the reviewed launcher environment and the non-secret
   `ELITEBRIDGE_GATEWAY_TERMINAL_PATH`. This needs no vault, password or service
   token. It checks Windows x64 Python, importable SDK/callable capabilities and
   terminal-file presence without calling SDK initialize/login or contacting a broker.
5. On that host, as the service user, run
   `python3 /opt/elitetrade/scripts/elitebridge-cloud-config.py`. It prompts for a
   saved account UUID, authorized demo login, exact server/symbol/terminal path,
   and hidden investor password, then passes the config privately to the Node
   AES-GCM sealer. It creates key/vault/token files, refuses overwrite and never
   prints the token. Provisioning does not authenticate. Never put passwords or
   tokens into shell commands, screenshots, chat, repository files or public logs.
6. With the reviewed environment loaded by the service manager, execute
   `npm run bridge:gateway:check`. A passing check is configuration evidence only.
   Review/install the systemd template and start it. Startup repeats the SDK runtime
   inspection using the actual decrypted terminal path before opening a listener.
   Terminal/Wine installation and live broker compatibility remain acceptance gates.
7. Configure a trusted HTTPS reverse proxy for `/snapshot` and `/healthz` to
   loopback port 8787. Preserve Authorization, disable caching and access-log
   query/body/header capture, limit request sizes/rates, configure certificate
   validation and network restrictions. Do not expose a public unauthenticated
   desktop, Wine RPC interface, debug console or the loopback port itself.
8. Transfer the generated per-account service token through the provider's secret
   management flow. Set server-only `ELITEBRIDGE_GATEWAY_URL` and
   `ELITEBRIDGE_GATEWAY_TOKEN` on EliteTrade. Do not export it into `NEXT_PUBLIC_*`,
   browser configuration, Android, build artifacts or client responses. One
   gateway binding is supported in this milestone; do not share a single token
   across customer accounts. No environment secrets were configured in this turn.
9. Open `/elitebridge`, select the saved demo account under **Cloud broker
   verification**, and verify. This invokes owner-scoped
   `GET /api/elitebridge/accounts/:uuid/cloud-probe`. It never reads stored broker
   passwords, changes account status, creates a gateway binding, starts bots, or
   falls back to MetaApi. Successful snapshots refresh while the page remains
   visible; gateway collection itself is independent of that page.

The gateway exposes `GET /healthz` for authenticated diagnostics and
`GET /snapshot?accountId=<bound-id>&mode=demo` for authenticated data. Process
health alone does not mean connected. A stopped/stale/blocked gateway returns no
usable snapshot. The existing signed v3/v4 uplink and its approval model remain
separate; no account snapshots are smuggled into heartbeat/quote packets.

## Acceptance evidence and remaining milestones

| Gate | This turn's status | Evidence needed to advance |
| --- | --- | --- |
| Repository/infrastructure audit | Executed | Baseline code, Vercel READY, live aggregate database inspection |
| Exness Trial1–20 / Real1–20 selector | Present; regression tests run with release validation | Exact assigned server remains a candidate until authentication |
| Independent private gateway implementation | Implemented; synthetic tests only | Runtime installation and real SDK/broker session |
| Authenticated Exness DEMO session | Blocked/unverified | Authorized credentials on commissioned private host; matching broker/login/server/mode and genuine financial state |
| Genuine data and positions | Code implemented; live unverified | Compare fresh source ticks, account values and complete position snapshot against broker terminal records |
| Phone-independent persistence | Service template/loop implemented; cloud unverified | Close/lock/disconnect phone, reboot service/host, interrupt broker network; timestamped observations and recovery evidence |
| Durable independent EliteEngine execution | Missing | Separate durable execution owner/fencing, strategies, risk, commands, unknown-outcome reconciliation; no MetaApi dependency |
| Authorized DEMO order | Locked; no endpoint implemented | Explicit approval, risk/spec/margin checks, idempotent ledger, then broker receipt and reconciliation; never force an order for activity |
| REAL execution | Locked | Independent authorization and all earlier evidence plus stricter risk/kill-switch review |
| Multi-broker and multi-account runtime | Not implemented | Authorized adapters, tenant-specific credential vaults/scopes and isolation |

Diagnoses for the three pending accounts cannot be narrowed to bad passwords or
wrong servers without broker authentication. The independently observed blocker
is **no enrolled terminal / no verified independent gateway session**. No enabled
engine runs were present. Strategy conditions, spread/risk, margin and broker
order rejection cannot be diagnosed from an account that has not reached this
gateway. No password failure or successful trade is inferred from a pending row.

Release verification results and provider status are recorded in the commit and
release report. Automated tests use explicit synthetic fixtures and are not
proof of live MT5, cloud uptime, execution latency or profitability.

Base gateway verification completed: application build, JavaScript
syntax/entrypoint checks, TypeScript checks, 385 Node tests (0 failed/skipped),
Python byte compilation, systemd unit verification, and browser fixtures at
320/390/768/1440px in both themes. Browser fixtures also exercise unavailable →
verified synthetic DEMO → unavailable transitions without enabling execution.
The normal Playwright browser download was unavailable; the browser tests passed
using an extracted packaged Chromium executable. No live account fixture or
production broker credentials were used. No Android source was changed and no
new native APK was built by this milestone.

### Headless startup follow-up

The private-display wrapper and secret-free runtime doctor are now implemented.
The doctor only imports/checks SDK capabilities and terminal-file presence. It
does not inspect the terminal's PE signature/version, broker installation files,
server-discovery state, broker login, prices or permissions; those remain separate
commissioning checks. A successful doctor **must return brokerAuthenticated=false**.
Startup errors use allowlisted diagnostic codes; arbitrary SDK stderr is discarded.

`test/elitebridge-runtime-doctor.test.mjs` exercises secret-free process input,
rejected runtime reports, isolated CLI operation with no vault and zero SDK calls.
`.github/workflows/elitebridge-linux-display.yml` runs the actual headless display
check on a temporary Linux runner: authorized X client succeeds, missing authority
fails, and X TCP access is disabled. A CI runner is test infrastructure, not a
persistent EliteEngine/MT5 host. No broker secrets are supplied to this workflow.
CI success is evidence of the display layer only; it is not Wine/MT5 session proof.

Hosting check: Render's free web services sleep after idle periods and do not
support persistent disks. They cannot establish the always-on, durable runtime
promised here. No paid host or plan upgrade was created. Existing Render service
inspection awaits the connector's required workspace confirmation.

Additional primary references:

- https://manpages.debian.org/bookworm/xvfb/xvfb-run.1.en.html
- https://render.com/docs/free
- https://render.com/docs/disks
