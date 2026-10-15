# EliteTrade Phase 4 — Phone-only Windows MT5 Tester, research mode

**Do not merge this branch into production.** The compiled independent research EA is not a reconstruction of the original `Scalpin SS.ex5`; no profitability or reference equivalence has been measured.

## What is verified

- Repo `Mahiruni/Elitetrade`, research branch `research/cloud-compile-ea-20261015`, draft PR #56.
- Windows compilation completed on run **38734987113**. Binary SHA-256 **16627b5419bd777662472479f4fed23f187ca6c3853e4352d0c01d0bc2168528**. The cloud tester downloads that exact binary; mismatches are rejected.
- The Phase 4 Python configuration guard and encrypted-artifact vault have repeatable offline tests.

## Why no PC is required

GitHub Actions supplies a temporary Windows machine. The cloud test runner installs the official, Authenticode-verified MetaQuotes terminal, then starts `terminal64.exe /portable /config:<temporary-ini>` with `[Tester] Model=4` and `ShutdownTerminal=1`. This is **the MT5 Strategy Tester**, not a live chart robot. The EA remains non-live, and the config explicitly disables chart expert trading and DLLs.

**Important:** A compiled EA plus an MT5 install does **not** give the tester historical broker real ticks. Model 4 is a request, not a data provenance certificate. We still need **an exclusively dedicated DEMO MT5 broker account** with actual tick history. Never use live account credentials, the EliteBridge/MetaApi production token, or a financial account password reused anywhere else. The GitHub repository is public; prefer a private, access-controlled testing repo for repeated sensitive testing. GitHub Actions environment secrets are not exposed to ordinary fork PRs, but anyone who can change trusted workflows may still be able to misuse configured secrets.

## From an Android browser

1. Open https://github.com/Mahiruni/Elitetrade/settings/secrets/actions . Add repository Secrets **MT5_DEMO_LOGIN**, **MT5_DEMO_PASSWORD**, **MT5_DEMO_SERVER**, and **MT5_EVIDENCE_PASSPHRASE** (unique 20+ character passphrase known to you, retained outside GitHub). **Never paste any of them into this chat or commit them as files.** The broker server name must be exactly what that dedicated demo terminal expects. A disposable demo is strongly recommended.
2. Open https://github.com/Mahiruni/Elitetrade/settings/variables/actions . Add repository Variable `ELITETRADE_PHASE4_ALLOW_RUN=yes-demo-only`, `ELITETRADE_PHASE4_MODE=signal`, and `ELITETRADE_PHASE4_SYMBOL=XAUUSD` (or the broker's actual symbol like `XAUUSDm`). **Leave the enable variable unset until you want a cloud trial.** Default execution is signal-only and should yield zero orders.
3. Workflows on **research branches** cannot initially use GitHub's normal **Run workflow** button until the workflow also exists on the default branch. To run again *without a PC*, open the research branch in the mobile GitHub site and edit a line of `research/phase4/README.md`, committing it to the same research branch. That triggers the branch-scoped workflow. You can also use Termux with Git if preferred. Never merge this research PR merely to reveal the button.
4. Go to https://github.com/Mahiruni/Elitetrade/actions , select **Phase 4 phone-cloud MT5 research**. The `validation` job runs without credentials; optional `demo-tester` job is skipped unless the enable variable is set to the exact required value. Any run missing demo secrets is marked blocked, not reported as a backtest.
5. If and only if the tester finishes, download the artifact `elitetrade-phase4-encrypted-evidence`. `safe-status.json` is redacted; `evidence.aesgcm` is encrypted using your private secret. Original raw broker files are **never uploaded in plaintext**.
6. On Termux, install Python, `pip install cryptography`, put `evidence_vault.py` and the `evidence.aesgcm` file together, run `python evidence_vault.py open --source evidence.aesgcm --output decoded-evidence`, and enter your evidence passphrase when prompted. Do not put the decoded records in a public GitHub repository.

## Future research test execution mode

Once the **signal-only** tester is confirmed to produce valid MT5 records and **zero trades**, you may explicitly select `ELITETRADE_PHASE4_MODE=execution`, and separately set `ELITETRADE_SIMULATION_CONFIRMATION=TESTER_ONLY_NO_LIVE_ORDERS`. Orders are **only simulated by MT5 Strategy Tester**. This does not authorize live trading. When an actual complete trade CSV and report are available, run the Phase 3 analyzer. MT5 report profit factor and drawdown must be independently cross-checked; tick history quality is not established by the mere presence of a file.

## Security / implementation limitations

- Research job does **not run automatically with broker secrets** unless the exact opt-in variable is present. All commits still run synthetic offline tests.
- Installer is verified via Windows Authenticode, and compiled binary pinned to a previously verified SHA-256. Other external dependencies include GitHub official Actions, Python and the `cryptography` package.
- Sensitive config file lives only in the temporary runner and is deleted on exit. Evidence is stored on the worker only until it is encrypted using PBKDF2-SHA256 (350,000 iterations) plus AES-256-GCM. Incorrect passphrases and modified ciphertext cannot decrypt.
- Public GitHub runner logs are not safe places for broker login details. Do not print protected INI files or share raw journals.
- Windows hosted runner installation, MT5 real-tick history, scheduled headless test completion, file locations, and historical trade quality **are not yet verified**. Tests intentionally fail closed when a report or trade-decision evidence is missing.
- The original EX5 has not been included in the new workflow, compared, decrypted or uploaded publicly.

**Official MT5 CLI**: https://www.metatrader5.com/en/terminal/help/start_advanced/start

**MT5 testing model**: https://www.metaquotes.net/en/metatrader5/algorithmic-trading/tester
<!-- Phase 4 signal-only demo smoke-test requested via Android Termux, 2026-10-15; no credentials or accounts stored in source. -->
