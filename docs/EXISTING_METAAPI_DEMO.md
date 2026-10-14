# Reuse an existing connected MetaApi MT5 demo account

The EliteTrade administrator can **link an existing MetaApi hosted DEMO** to a saved MT5 record, avoiding the creation of a duplicate chargeable MetaApi host.

## Steps
1. In EliteTrade MT5, verify an account entry has the **exact login and broker server** displayed by MetaApi. If absent, add an MT5 account in EliteTrade and await approval.
2. In **Administration → MT5 accounts**, choose **Link existing demo** for the matching record. Copy only the MetaApi account **ID** from MetaApi MT Accounts (never a token or password).
3. If the saved EliteTrade link is disconnected, explicitly choose to replace it. This changes only the local association: **the former hosted account is neither deleted nor undeployed**. Review MetaApi Billing for any older instances.
4. The server checks administrator authorization, active account owner, duplicate binding, exact MT5 login/server, provider connection and broker-reported `ACCOUNT_TRADE_MODE_DEMO` before saving.
5. After successful link, open the EliteTrade MT5 page to verify balances; Gold SMC remains **read-only**. Demo orders require a separately configured, authorized worker and explicit risk checks. Linking never enables execution.

The imported link uses the `metaapi-existing:` prefix. Removing this linked account in EliteTrade never deletes the external MetaApi host. Original EliteTrade-created `metaapi:` links retain their existing deletion behavior.

### Safety
- Do not include MetaApi API keys or MT5 passwords in screenshots or URL parameters.
- The production server uses the already configured `METAAPI_TOKEN` environment variable. No new secret is required.
- A hosted MetaApi account may incur charges even when disconnected; importing does not alter provider billing.
- All imported accounts are checked against provider identity each time their broker snapshot is fetched.
