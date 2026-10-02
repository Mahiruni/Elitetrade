# USDT TRC20 subscription payments

The supported receiving address is `TYubnUkFUzoh2exZHzUA9ScLtihhC1bxeB` on TRON mainnet. The genuine Tether contract is `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, with six decimal places. TRX and other tokens or networks cannot activate a subscription.

## Enable automatic activation

1. Apply `db/usdt-payments.sql` to the existing EliteTrade Supabase project.
2. Deploy `supabase/functions/elitetrade-usdt/index.ts` with its `src/supabase-data.mjs` and `src/tron-payments.mjs` dependencies. Disable gateway JWT verification only because the function verifies a private 256-bit scheduler credential itself. Browser users cannot call the verifier.
3. Apply `db/usdt-scheduler.sql`. The existing Supabase database invokes the confirmation checker every minute. A trading worker or Render service is not required for payment checking.
4. Deploy the updated website. Sign in as an administrator and open **Administration → Configuration → TronGrid API key**. Obtain a production key from [TronGrid](https://www.trongrid.io) and save it here. The key stays in Supabase Vault and is never sent back to the browser. Leaving the input blank preserves the current key. No wallet private key or seed phrase is required.
5. Confirm **USDT TRC20 confirmation** becomes active after a successful scheduled check. A missing or invalid key, provider failure, or health older than five minutes prevents creating new automatic invoices. Existing manual review remains available.

## Customer flow

An inactive customer opens Subscription and creates an invoice before sending. The server locks the current subscription price, recipient, user, amount, and a 24-hour sending deadline. The quoted USDT base amount uses the numerical USD subscription price; there is no live exchange-rate feed. A disclosed matching fraction between `0.000001` and `0.009999` USDT distinguishes simultaneous customers paying to this shared address. Transfer fees are paid separately and the recipient must receive all six decimal places exactly.

The checker reads confirmed incoming transfers from mainnet TronGrid, then independently examines the successful receipt through `walletsolidity/gettransactioninfobyid`. Receipt hash, genuine contract, indexed recipient, summed transfer amount, block number, and block timestamp must match. Transfer-history entries or a customer-supplied transaction ID alone never authorize activation.

The service-only activation transaction records an approved payment, marks the invoice paid, activates the profile, and records an eligible referral commission once. Referral commission uses the original subscription price rather than the matching fraction. Repeated checks return the same payment and a transaction cannot activate two invoices. Manual references cannot reserve the verifier's `trc20:` namespace. A matching pending manual submission from the invoice owner is approved in place rather than inserted again. An already approved matching manual payment is linked to the invoice without duplicating revenue or commissions, and without reversing any later administrator revocation of access.

The customer page checks status every 30 seconds and when reopened. A customer can close the page after paying; the Supabase schedule keeps running. Chain confirmation and provider indexing times vary, so activation is not promised immediately. The account is activated when the confirmed receipt is found.

## Exceptions and operation

Transfers must occur before the invoice deadline. The scanner retains expired invoices for one additional day to allow transfers made in time to become solidified and indexed; customers must not pay the expired quote. Wrong amounts, missing invoices, late transfers, unsupported assets, and unsettled provider errors require administrator investigation and manual review. Customers should contact support before sending a second payment. Pool contributions continue to use the existing manual review flow.

Matching amounts are never reused at this destination, including after expiration, so a late transfer to an old quote cannot credit another customer. Retain invoice history when archiving. This provides up to 9,999 distinct invoices per base price; allocation may reject before that limit if its bounded random search is exhausted. Switch to unique deposit addresses or a managed payment provider for higher volume.

One scan considers up to 40 invoices and 1,000 recent incoming transfers, rotating by last check time. Scans stop processing additional invoices after a 75-second budget, have a three-minute lease, and only release their own lease. At larger volumes, add persistent provider pagination or a managed payment provider before relying on this capacity. Health indicates provider availability, not a guarantee that all pending payments were checked in that minute. Vault protects the scheduler credential; it is referenced by the job at runtime and is not embedded in the job command or source code.

Run `npm test`, `npm run check`, and the isolated browser checks. Run `db/usdt-verification.sql` through the SQL tool to exercise database ownership, exact amount and deadline checks, idempotency, replay prevention, referrals, and leases. Its synthetic users and receipts are enclosed in a rollback; no test activates a real subscription or sends funds.

Official references: [Tether supported protocols](https://tether.to/en/supported-protocols/), [TRON exchange integration](https://developers.tron.network/docs/exchangewallet-integrate-with-the-tron-network), [TronGrid account TRC20 history](https://developers.tron.network/reference/get-trc20-transaction-info-by-account-address), [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions).
