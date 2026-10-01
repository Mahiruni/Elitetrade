# Verification record — 1 October 2026

## Verified locally

`npm run check` passed for all application, script, and test JavaScript files.

`npm test` passed 10 integration tests using real HTTP requests and SQLite:

1. Registration, durable profile, login/logout, password whitespace handling, CSRF and role authorization.
2. Single-use password recovery, password changes, session revocation.
3. TOTP enrollment, login challenge, replay prevention, disable.
4. Payment approval, one-time review, activation, referral commission and payout reservation/completion.
5. Pool creation, contribution verification, total and personal allocations.
6. Private guest support, administrator replies, conversation closure.
7. Missing-service errors and encrypted broker credentials.
8. Gateway contract, confirmed controls, stopping after deactivation, unknown status, ownership, account deletion.
9. All public application routes/static assets, security headers, unknown-route behavior.
10. Disk-backed database close/reopen persistence.

`node test/browser.mjs` passed in Chromium at 1440×1000 and 390×844:

- Registration → session → subscription page.
- Profile edit → API → persistence → reload.
- Administrator payment-method and pool-round creation.
- Administrator navigation, member and configuration screens.
- MT5 account form → encrypted record → pending account display.
- Bot configuration → saved settings → updated card.
- Mobile payment submission → administrator review → active subscription after reload.
- Customer support message → administrator reply → live delivery in customer browser.
- All member routes fit the mobile viewport; light/dark controls work.
- No browser page errors or unexpected console errors in the tested flows.

## Limits of this verification

SMTP delivery and live broker execution were tested using controlled adapters at the API boundary. No production mailbox, MT5 gateway, EA, broker account, payment transfer, or Telegram service was used. The browser run used isolated local data, not original elitebot.live accounts. Docker deployment and domain cutover require the intended production host. This record does not claim a deployment to elitebot.live.
