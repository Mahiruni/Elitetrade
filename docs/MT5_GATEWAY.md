# MT5 gateway contract

The application includes an HTTP adapter for an operator-controlled gateway. It does **not** include the original EliteBot Expert Advisor or broker execution service: neither was recoverable from browser assets. A configured URL alone is not proof of a working trading strategy.

Deploy the gateway/EA where it can reach the actual MT5 terminal. Implement the endpoints below, validate the bearer token on every request, and run behind HTTPS. The service must bind every bot and account to the supplied account identifier, serialize conflicting commands, and make retries idempotent. Never report a state that the terminal has not confirmed.

All requests use `Authorization: Bearer <MT5_GATEWAY_TOKEN>`. Every successful response is JSON. Non-2xx responses fail the application request. The application uses a 15-second timeout and rejects redirects.

## Connect

`POST /accounts/connect`

```json
{"accountId":"app-account-uuid","broker":"Broker name","login":"123456","server":"Broker-Demo","password":"provided-at-runtime"}
```

Connect and verify the requested login/server. Use `accountId` as an idempotency key so retries cannot create multiple terminal sessions. Return only after authentication is confirmed:

```json
{"accountId":"gateway-account-id","connected":true}
```

Do not log or echo the password. An approval in the UI means this response was validated, not just that an administrator clicked a button.

## Account snapshot

`GET /accounts/<gateway-account-id>`

```json
{"connected":true,"currency":"USD","balance":1250.25,"equity":1247.10,"profit":-3.15,"history":[]}
```

Amounts use account-currency units. `connected` must be boolean. `history`, if supplied, is an array of `{ "time": <Unix milliseconds>, "value": <numeric equity> }`. The browser currently shows confirmed balance/equity. No artificial market chart is generated.

## Bot command

`POST /accounts/<gateway-account-id>/bots/<app-bot-id>`

```json
{"running":true,"config":{"id":"app-bot-id","account_id":"app-account-id","name":"Elite Bot","strategy":"trend","symbol":"XAUUSD","risk_percent":1,"stop_loss":1,"take_profit":2,"max_drawdown":10,"daily_loss":3,"lot_size":0.01,"status":"stopped"}}
```

The exact bot row also includes `user_id` and `created_at`; neither authorizes another account. Confirm the URL account and bot ownership independently. The gateway must implement the actual strategy identifiers (`trend`, `scalping`, `breakout`) or reject unsupported strategies. The public interface exposed these labels but did not expose their algorithms, so they must not be represented as recovered proprietary logic.

The gateway must enforce risk, stop-loss, take-profit, drawdown, daily-loss, lot-size, and broker constraints at execution time. Configuration fields are percentages except `lot_size`. Define and document the strategy's price-distance interpretation of stop-loss/take-profit and account-equity baseline for loss limits. Use demo-account validation before real deployment.

Respond only when the requested execution state has been confirmed:

```json
{"running":true}
```

A stop uses `running:false` and requires `{ "running":false }`. The stop command stops the strategy; handling of existing orders/positions belongs to the gateway and must be documented. The application explicitly tells users to check their terminal for existing positions. On a timeout or inconsistent acknowledgment, the application records `unknown`, blocks configuration/deletion, and permits another stop attempt.

## Disconnect

`POST /accounts/<gateway-account-id>/disconnect`

```json
{"accountId":"gateway-account-id"}
```

Reject while any strategy still executes. After confirming disconnection, return:

```json
{"disconnected":true}
```

## Test boundary

The repository tests this adapter contract with a controlled in-process gateway. No live broker credentials, EA, order execution, trading performance, or external terminal were available to test. Those remain deployment prerequisites.

## Confirm current bot status

`GET /accounts/<gateway-account-id>/bots/<app-bot-id>`

Return `{ "running": true }` or `{ "running": false }` from the current execution engine. If it is unavailable or uncertain, return a non-2xx response instead of an old cached success. The application rechecks previously running/unknown bots and shows `unknown` while a live status cannot be confirmed. The terminal and bot pages refresh every 15 seconds while visible.
