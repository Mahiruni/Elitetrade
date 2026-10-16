# EliteBridge cloud MT5 gateway contract (read-only milestone)

This document defines the next broker-facing integration point. It is NOT a claim
that Exness MT5 has been connected, or that live orders are supported.

## Existing code

- `src/elitebridge-broker-server-profiles.mjs`: Exness demo `Exness-MT5Trial9`,
  real `Exness-MT5Real9`; accepts broker-specific server names for others.
- `src/elitebridge-cloud-mt5-observer.mjs`: HTTPS read-only observer with a
  10-second timeout, account/broker/server/mode checks and a 30-second age limit.
- `test/elitebridge-cloud-mt5-observer.test.mjs`: mocked response regression tests.

## Gateway interface

Configure `endpoint` as the private HTTPS base URL, and `token` as a secret
stored only in the backend. The observer performs:

`GET <endpoint>/snapshot?accountId=<local-id>&mode=demo|real`

with `Authorization: Bearer <token>`. A successful response must contain
`authenticated: true`, `brokerConnected: true`, `platform: "mt5"`,
`broker: "Exness"`, `server: "Exness-MT5Trial9"`, `mode: "demo"`,
`accountId` equal to the requested local binding, a current ISO timestamp
in `observedAt`, and finite numeric `balance` and `equity`.

The gateway operator must enforce authorization for the account ID; a matching
JSON response alone does not establish broker authenticity. TLS, secret
management, broker-side authentication, durable reconciliation, and a real
terminal or licensed API integration remain gateway responsibilities.

## Deployment decision

An Exness MT5 login and server label do not expose an officially supported
REST trading endpoint. Do not reverse-engineer or guess the MT5 wire protocol.
An authorized remotely hosted MT5 terminal/gateway can eliminate the USER'S
personal Windows PC, but may still require Windows on the remote host.
Linux/Wine compatibility must be proven in a real broker session before it
is selected as the persistent production transport.

## Next acceptance gates

1. Select and operate an authorized broker-facing runtime under EliteEngine.
2. Establish a DEMO Exness connection with broker-verified login, server,
   account mode, prices, and position snapshots; test reconnect and stale data.
3. Persist authenticated observations with access control and provenance.
4. Implement a separate order adapter and reconcile unknown outcomes.
5. Test DEMO order lifecycle with explicit operator permission and risk caps.
6. Enable REAL mode only with independent authorization and kill switch.

Until the gateway is verified, show `brokerConnected: false` in production.
Never turn a simulated heartbeat into a broker-connected badge.
