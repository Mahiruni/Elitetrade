# EliteTrade Phase 5 — persistent Windows MT5 verification (Android-operated)

**Status:** Research planning, **no VPS provisioned**, Exness demo connection NOT verified, no real-tick report or orders yet. The user has an Android phone with Termux and no PC.

## Why this stage exists

Our official, signed MetaTrader 5 binary and independently compiled EA launch on an ephemeral Windows GitHub runner. The MT5 process exits without any Strategy Tester report; the secure classifier labels the log `TESTER_START_FAILED`. We did not see evidence of Exness login success or true tick coverage. The 2026-10-15 diagnostic found `metatester64.exe` present; **zero MetaTester Windows services is normal for local testing agents** according to MetaQuotes: https://cloud.mql5.com/en/faq/settings. Do **not** install remote services or elevate permissions solely to change the service count.

A **persistent, interactive Windows MT5 desktop** controlled by Android Remote Desktop is the next verifiable path. Prefer a private research environment to avoid broker account credentials being exposed by modifications to a public repository.

## Environment prerequisite (must be provided/approved by user)

- Windows 10/11 or Windows Server with desktop/RDP interactive access; at least ~2 vCPU, 4–8 GB RAM, and adequate disk for broker ticks. Not a Linux-only VPS.
- Use a reputable provider; purchase or provision **only after** user authorization. Do not share administrator passwords in chat.
- Restrict RDP access, use a strong unique Windows password and MFA where supported; patch Windows and allow only needed outgoing MT5 access. Do not place broker passwords or RDP credentials in Git source or CI output.

## Android-only procedure

1. On the phone, purchase/provision a Windows VPS if authorized, then use an Android RDP client to reach its interactive desktop. This is a **remote computer**; nothing is installed locally on Android beyond an RDP client.
2. Install official **Exness MT5** from your Exness Personal Area on the remote Windows desktop. Confirm the signed installer. Use a disposable Exness **MT5 demo** account with a unique password.
3. In the MT5 UI, log in with the account's numeric MT5 login, correct trading password and exact demo server. Confirm broker synchronization in the terminal itself before launching Strategy Tester. Do not assume stored GitHub secrets prove MT5 authenticated.
4. Show `XAUUSDm` in Market Watch. Inspect symbol contract details (point, tick size, lot size, trading hours), and confirm actual historical M1 bars and ticks are available.
5. Retrieve **independent** compiled `EliteTrade_SweepResearch_v1.ex5` from GitHub Actions run `38734987113` (artifact retention may expire). Verify EX5 SHA-256:
   `16627b5419bd777662472479f4fed23f187ca6c3853e4352d0c01d0bc2168528`
   Install in `MQL5/Experts/EliteTradeResearch` under **the current terminal data folder** (File > Open Data Folder), then refresh Navigator.
6. In MT5 Strategy Tester, select independent EliteTrade EA, `XAUUSDm`, `M1`, **Every tick based on real ticks**, `2026.10.05` through `2026.10.07` (sample only), deposit 10000 USD. Verify history coverage; real-tick mode selection alone is not sufficient evidence.
7. First choose `InpExecuteOrders=false` (signal-only): expect zero trades. Export actual Strategy Tester HTML report, Journal, and both `EliteTradeEvidence` decision and event CSVs if produced.
8. Only if the test completes with genuine history and captures, run a separate **Strategy Tester simulation** with `InpExecuteOrders=true`, never on a live chart. Validate commissions/swap/spreads/tick quality and compare report to deal CSV using `research/phase3/tools/evaluate_capture.py`. Do not claim profitability or equivalence to proprietary `Scalpin SS.ex5` without reference trades.
9. Keep broker logs, reports, journal and passwords private. If sharing results for analysis, export a redacted report without account/server details and share only through a private channel.

## Release gates

- [ ] Windows environment accessible interactively from Android
- [ ] Exness MT5 demo login **verified within terminal**
- [ ] XAUUSDm M1 history and real-tick coverage confirmed
- [ ] Independent EA SHA-256 verified
- [ ] Signal-only tester report plus genuine decision logs
- [ ] Separate simulated-trade tester with complete position captures
- [ ] Phase 3 analyzer produces complete evidence and meaningful statistics
- [ ] Out-of-sample, slippage, max drawdown and spread sensitivity reviewed
- [ ] Only then evaluate future live-trading capability through explicit risk approval

**Do not merge draft PR #56 into production, do not use real account credentials, and do not run live trades at this stage.**
