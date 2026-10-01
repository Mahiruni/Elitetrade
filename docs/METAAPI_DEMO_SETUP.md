# MetaApi setup for EliteTrade

The hosted adapter supports separate MT5 demo and real account connections for every member. It provides verified account data; automated trading is not implemented.

## Configure once in Vercel

Open Vercel → elitetradee → Settings → Environment Variables. Add these for Production and redeploy:

| Variable | Value |
| --- | --- |
| `MT5_GATEWAY_PROVIDER` | `metaapi` |
| `METAAPI_TOKEN` | Private MetaApi API token |
| `METAAPI_REGION` | Your MetaApi deployment region, such as `new-york` |

Remove the old `METAAPI_ACCOUNT_ID` and `METAAPI_LOCAL_ACCOUNT_ID` variables: they are no longer used. Keep the token server-side; never use a public frontend variable. The token needs account list/read/create/deploy/delete permissions and account-information access. A reader-only token cannot provision members. Configure provider capacity and review https://metaapi.cloud/#pricing before approving accounts; every provisioned connection can incur charges.

## Existing website flow

1. An active member opens MT5 terminal → Add account and supplies their broker, numeric MT5 login, exact broker server, and password. Demo and real broker servers are supported. An investor password is recommended because this integration only reads account data.
2. The details remain pending in EliteTrade. Existing ownership policies and Vault credential storage stay in place.
3. An administrator approves the connection. The backend retrieves that account's secret and creates its individual MetaApi connection. No manual provider ID entry is required for each user.
4. If MetaApi is still provisioning or connecting, approval reports processing or retains the pending connection. Wait and retry approval. The stable transaction ID and exact local-account metadata resume the connection instead of creating another account.
5. Approval becomes connected only after matching the provider ID, local binding, MT5 login/server, platform, account type and connected terminal response. Members see their own verified balance and equity.
6. Removing a connected or bound pending account removes that MetaApi connection before deleting its EliteTrade record. This does not close the broker account or its positions. Removal is refused while bots have a non-stopped status.

The regional account-information endpoint is derived from each provider account's actual region. Broker server names are never used as API hosts. Provider errors are sanitized, tokens are not returned to the browser, and passwords are sent only to the fixed MetaApi provisioning host over HTTPS.

## Pending requests and recovery

MetaApi may return HTTP 202 before allocating an account ID. Retry approval for the same saved EliteTrade account after the provider's waiting period. Do not delete/recreate that local account while provisioning is processing. An administrator should inspect the MetaApi dashboard if provisioning fails, a database write fails after provider creation, or multiple bindings are detected. These external operations are not an atomic database transaction.

## Verification and limits

`/api/config` reports `gatewayConfigured: true`, `connectionMode: "account-data"`, `tradingEnabled: false` when the server token is configured. This indicates configuration, not validated token access. Only a real successful account approval verifies provider connectivity.

Tests simulate provider responses for separate accounts, demo/real identity, retries, delayed deployment, ownership mismatches, deletion and trading rejection. Live provider validation requires the token and account credentials; no paid connections were created during development. MT4, contest and unknown account types are rejected.

Bot controls remain disabled on the page and rejected by the backend. Connecting a real account does not implement or start a strategy.

## Official references

- https://metaapi.cloud/docs/provisioning/api/account/createAccount/
- https://metaapi.cloud/docs/provisioning/api/account/readAccounts/
- https://metaapi.cloud/docs/provisioning/api/account/deployAccount/
- https://metaapi.cloud/docs/provisioning/api/account/deleteAccount/
- https://metaapi.cloud/docs/client/restApi/api/readTradingTerminalState/readAccountInformation/
