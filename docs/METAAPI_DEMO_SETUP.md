# Hosted MT5 demo connection

EliteTrade now has an optional MetaApi adapter for one explicitly bound MT5 demo account. It reads account identity, balance and equity. It does not implement an EA, execute a strategy, open orders, or claim that a bot is running. The existing custom execution gateway remains available separately.

## Provider setup

1. Create your own account at https://app.metaapi.cloud/. Review https://metaapi.cloud/#pricing before provisioning; provider subscriptions and API requests may be billed.
2. Add a broker **MT5 demo account** to MetaApi. Use its investor/read-only password if your broker supports one. The broker, login and server must match the account saved in EliteTrade.
3. Deploy the account in MetaApi and wait for its connection status to become CONNECTED.
4. Copy the provider account ID and actual account region from the MetaApi account card. Obtain an API token with reader access to that account's provisioning metadata and account-information REST endpoint. Keep the token server-side.

## EliteTrade production settings

Set these in Vercel → elitetradee → Settings → Environment Variables, for Production:

| Variable | Value |
| --- | --- |
| `MT5_GATEWAY_PROVIDER` | `metaapi` |
| `METAAPI_TOKEN` | Your server-side MetaApi reader token |
| `METAAPI_ACCOUNT_ID` | The provider's account ID, not the MT5 login |
| `METAAPI_LOCAL_ACCOUNT_ID` | The UUID of the matching `elitetrade_accounts` row |
| `METAAPI_REGION` | The account's actual region; the default is `new-york` |

Redeploy after setting the variables. `/api/config` should report `gatewayConfigured: true`, `connectionMode: "demo-read-only"`, and `tradingEnabled: false`. It never returns the MetaApi token or account binding.

An authorized EliteTrade administrator must approve the matching pending MT5 connection. The adapter verifies the exact local account binding, provider ID, MT5 login/server, deployment status and demo account type before approval succeeds. This preserves existing administrator review permissions. In hosted demo mode, approval does not retrieve the MT5 password from Vault or forward it to MetaApi.

After approval, the MT5 terminal displays verified balances/equity. Start/stop controls are disabled in demo mode, and the backend rejects execution requests as well. Unlinking an EliteTrade account does not delete or undeploy the provider account; provider billing must be managed in MetaApi separately.

## Boundaries and verification

- Only `GET` requests are made to MetaApi. Account creation, deployment, trades, EA uploads and provider deletions are not performed by the adapter.
- Real-money, contest, unknown-type, MT4, disconnected and mismatched accounts are rejected.
- Tokens are sent only to the documented provider hosts over HTTPS; redirects are rejected and requests time out.
- Adapter tests use simulated provider responses. A real provider connection cannot be verified until the operator supplies a token and deployed demo account.
- Automatic trading requires a separate strategy implementation, hosting plan, precise entry/exit/risk rules and testing. Adding this adapter does not supply that engine.

## Provider references

- https://metaapi.cloud/docs/provisioning/api/account/readAccount/
- https://metaapi.cloud/docs/client/restApi/api/readTradingTerminalState/readAccountInformation/
- https://metaapi.cloud/docs/client/models/metatraderAccountInformation/
