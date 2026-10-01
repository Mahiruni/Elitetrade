# Recovered routes and functions

Evidence comes from the public compiled browser files in this package and the public support page. A server-call reference means that the client attempts to invoke a backend function; it does not prove that the operation succeeds or that its server implementation was recovered.

## Route inventory

| Route | Recovered interface and behavior | Evidence |
| --- | --- | --- |
| `/` | Root application metadata and authentication/subscription navigation | `index-CLwec8P_.js`, `auth-W4ffuZEE.js` |
| `/login` | Email/password inputs; login request; pending/inactive account handling; links to signup, recovery, and support | `login-C8ZIoxH5.js` |
| `/signup` | Email/password registration; eight-character minimum; next step is subscription activation | `signup-BcccYUP_.js` |
| `/forgot-password` | Email input and recovery success message | `forgot-password-CG9S2JMh.js` |
| `/reset-password` | New-password and confirm-password inputs; navigation to login on submit | `reset-password-c2NWN6hi.js` |
| `/logout` | Clears the client identity and redirects | `logout-DLoOPEb6.js` |
| `/subscribe` | Account email; payment-method selection; account/wallet detail copying; transaction reference; payment submission and activation paths; Telegram community link | `subscribe-BBe0KygN.js` |
| `/support` | Start a support conversation; message composer; realtime replies; direct customer-care link; four FAQ topics | `support-CcXmZSpE.js`, `support.functions-CdHaasSb.js` |
| `/dashboard` | Redirect alias to `/mt5`; no separate dashboard component is defined for this route | Route definition in `index-CELiIWTZ.js` |
| `/mt5` | Responsive menu; broker/account/password/server form; password visibility; pending/approved/rejected account status; balance/equity fields; account removal; bot start/stop; live-pool navigation | `mt5-BC3pRJQQ.js` |
| `/bots` | Three sample bots; enable/disable toggles; configuration dialog; strategy, risk, stop loss, take profit, drawdown, daily loss, and lot-size controls | `bots-D-8Z-qCP.js`, `mock-data-BNOexhK3.js` |
| `/pool` | Pool-round/history/membership queries; round status, dates, contribution and performance displays; contribution request and payment details | `pool-x48Tkf2y.js` |
| `/referrals` | Referral-link copy control; earnings, pending payout, referred-trader count, and referral table | `referrals-CA60-mNu.js`, `mock-data-BNOexhK3.js` |
| `/settings` | Profile fields and save button; password fields; 2FA toggle; logout; administrator-console link | `settings-ClVfMczi.js` |
| `/subscription` | Current-plan display; payment methods and amount; transaction-reference input; payment submission/verification states | `subscription-dab9M6jc.js` |
| `/admin` | User/subscription search and management; MT5 approval/rejection/editing; subscription price; administrator management; payment methods; Telegram-alert settings and test action; pool rounds and membership review | `admin-B7O7dBoY.js`, `admin.functions-X0VyiQO1.js` |
| `/admin/support` | Support conversation list, message history, and reply composer | `admin.support-B2sAhu1r.js` |

`/_authenticated` is an internal route wrapper, not a separate user-facing page. It checks the client identity and subscription/admin query results before rendering child routes. The six named public pages were retrieved as HTML; the gated-screen map was recovered from their publicly downloadable client chunks.

## Integration boundaries

| Area | Recovered evidence | Remaining verification |
| --- | --- | --- |
| Account registration and login | Browser calls through payment/account server-function handles | Credential checks, server sessions, authorization, and database behavior |
| Client identity | `ghosttrader:auth` localStorage record and auth-change events | Server-side identity binding and authorization enforcement |
| Subscriptions and payments | Server-call handles; payment-method/price queries; payment-reference forms; USDT verification path | Provider responses, confirmations, account activation, and administrator authorization |
| MT5 | Server calls for retrieving/saving/removing account details and changing bot state; status polling every 15 seconds | Broker connection, saved credential handling, execution, and actual account telemetry |
| Support | Conversation/message server handles and a bundled Supabase browser client | Access rules, database schema, live replies, and message persistence |
| Pool | Server-call handles for rounds, history, membership, and contributions | Live pool values, approval workflow, and persistence |
| Administration | Public interface code and server-call handles | Server-side role enforcement and all administrator operations |

The built frontend includes React, TanStack routing/query code, and a Supabase browser client. The source repository and original project settings were not located among the connected repositories or matching saved files searched in this conversation.

## Confirmed client-code findings relevant to the redesign

These are observations from the downloaded handlers, not production penetration tests.

1. **Password recovery does not send a request in the recovered handler.** The forgot-password form calls `preventDefault()` and changes its local success state. No email-service or server call is made by that handler.
2. **Password reset does not update a password in the recovered handler.** Its submit handler prevents the default form action and navigates to `/login`. No backend update, reset-token handling, password comparison, or password-strength validation appears in that handler.
3. **Profile save only shows a notification.** The settings save button displays “Profile updated” without a persistence call in that handler.
4. **The settings 2FA control only changes local component state.** It starts enabled in the component and toggles with a success notification. No enrollment, verification, or security-service request appears there.
5. **The `/bots` management page uses sample data and local state.** Its toggle and configuration-save handlers update React state and display notifications. This is distinct from the server-backed start/stop control on `/mt5`.
6. **Referral figures and the referral link are imported sample values.** The referral screen imports its content from `mock-data-BNOexhK3.js`; these values are not evidence of the signed-in user's earnings.
7. **The MT5 “Live market analysis” graph is a fixed animated SVG.** Its line and filled area are hard-coded paths, and the accompanying analysis steps are fixed labels. That component does not accept or query live market data.
8. **Brand names are inconsistent.** Elite Bot/EliteBot branding appears alongside Ghost Trader AI in titles, settings text, localStorage keys, and the sample referral URL.
9. **Subscription pricing has a fallback.** The price hook queries a server function and falls back to 140. The fallback is not proof of the currently configured production price.
10. **Several field labels and regular controls use very small text.** The recovered CSS/class names include 10px labels and 12px controls, creating a concrete readability issue for the redesign.

## Public support content observed

- Payment activation topic: submit a transaction reference on `/subscribe`; administrator activation is described as taking a few hours.
- MT5 connection topic: check broker, account number, server, and password; relink through the MT5 tab.
- Recovery topic: points to `/forgot-password`.
- Crypto-network topic: describes Tron TRC20 for USDT, Bitcoin for BTC, and Ethereum ERC20 for USDC.

These are the site's displayed instructions. Payment availability, supported networks, response times, and provider behavior were not independently tested.

## Redesign implementation boundaries

The retrieved build is enough to recover the interface baseline and identify the complete named route set. A production redesign still needs the editable project and its backend integration points. Preserve the actual server-backed workflows, replace local/sample controls with real implementations where required, and verify account, payment, pool, support, and MT5 behavior against the original backend before release.

No redesign has been published to elitebot.live.
