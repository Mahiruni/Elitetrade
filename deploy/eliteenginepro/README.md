# Archived Render Linux/Wine compatibility experiment

**Direction corrected:** EliteEnginePro is the integrated EliteTrade product at
`/eliteenginepro`. Creating this separate Render service was an agent
misinterpretation, subsequently rejected by the user. Do not create further
resources from this image or use it as the product's execution host. The observed
SDK compatibility probe failed after 90 seconds; no broker was authenticated.
The existing service still requires suspension/removal; the connected tools do
not expose those operations. Its files remain to avoid deliberately breaking an
existing auto-deploy configuration.

Render's existing
`elitetrade-paper-demo` is a static site and remains separate. This image is a
secret-free compatibility milestone for an operator-controlled Linux host. It
does not install an MT5 terminal or authenticate a broker. It has no trade API,
credential form, strategy scheduler, MetaApi dependency or database access.

The Docker build downloads Windows x64 Python and the official MetaTrader5/NumPy
wheels from vendor origins, verifies the pinned SHA-256 digests and extracts them
into an isolated Python distribution. It does not execute unreviewed installer
scripts or place passwords into image layers. Source digests were obtained from
Python.org's Sigstore digest metadata and PyPI's release JSON on 2026-10-16.
The bootstrap verifies file hashes, not Sigstore signer identities/signatures.

At startup a private authenticated Xvfb display runs Node and Windows Python under
Wine. Python actually imports the Windows SDK and exercises the NumPy extension;
it never calls MT5 initialize, login, shutdown or account/order readers. A pass
proves SDK import compatibility in that container only. No dummy terminal file is
created to make terminal readiness appear successful. Cold Wine initialization
is bounded to 90 seconds; failed imports/timeouts produce a blocked status and
sanitized logs. There is no synthetic success fallback.

`GET /health` is **process health** (HTTP 200) with explicit commissioning state.
Provider `live` means HTTP is serving, not that SDK checks passed. Verify that
`sdkCompatibility` is `passed` separately. All states report
`terminalPresent: false`, `brokerAuthenticated: false`, `executionEnabled: false`
and `persistenceVerified: false`. Other routes, including `/snapshot` and `/orders`,
return 404. No periodic traffic is generated to keep a free instance awake.

The initial deployment uses Render **free** compute solely for this compatibility
test. It sleeps after idle periods, has ephemeral storage and cannot attach a
persistent disk. It is not an always-on EliteEngine trading deployment. Do not put
broker credentials, gateway vaults or terminal profiles on this instance.

Deployment source: repository `Mahiruni/Elitetrade`, branch `main`, Docker context
`.` and Dockerfile `deploy/eliteenginepro/Dockerfile`. Runtime variable
`ELITEENGINEPRO_MODE=compatibility`; no broker/API/database secrets are needed.
Render provides HTTPS; only the HTTP status port is exposed. X TCP listening is
disabled; no VNC, remote desktop, credential panel or arbitrary command endpoint
is exposed. Tini forwards termination to the whole child process group.

Commissioning found a subprocess completion defect: Wine descendants can keep
stdout open after the requested process exits. The shared JSON process runner
now requires a complete JSON line plus a successful process exit, and settles
timeouts/cancellation immediately without waiting for inherited pipes to close.
Only allowlisted SDK error payloads may accompany a nonzero exit. Regression
tests reproduce both retained-pipe success and timeout with real subprocesses.

Before continuous broker operation: validate actual MT5 installation and broker
login under Wine, provision persistent compute/storage, review interpreter and
Wine security updates, connect the existing private demo gateway, and verify
recovery. Python 3.12.10 is an intentionally pinned compatibility fixture, not a
claim of the latest security release; update the production interpreter and
corresponding wheel pins before enabling broker authentication. CPU/memory
requirements for a real terminal have not been measured. No paid plan upgrade
is authorized or performed by creating this free compatibility instance.

References:

- https://pypi.org/project/metatrader5/
- https://www.python.org/downloads/release/python-31210/
- https://render.com/docs/free
- https://render.com/docs/docker
- https://render.com/pricing
