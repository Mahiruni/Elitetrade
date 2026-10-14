# EliteBridge Phase 5.2 — Offline signed DEMO telemetry (no database)

This milestone replaces **none** of the existing backend or broker connections.
Render PostgreSQL provisioning is parked following a TLS-related connection
failure. Supabase is left untouched. This branch adds only a local, no-network
transport-reliability primitive for a future terminal companion.

## What works
- Ed25519-signed, strictly DEMO-only heartbeat and synthetic quote packets.
- Atomic local outbox journal with restrictive file permissions.
- Recovery of queued messages across a simulated companion restart.
- Verification of queued packet signatures against a pinned public key.
- Bounded offline queue that rejects overflow, expires stale packets, and
  does not reuse issued sequence numbers.
- Controller-signed acknowledgments tied to exact message IDs with a durable
  monotonic receipt counter and replay rejection.
- A two-packet offline demonstration script that sends **zero HTTP/SQL/broker
  requests**, removes its own temporary test directory, and prints results.

## Safe Termux commands
  cd ~/Elitetrade
  git fetch origin
  git switch --track origin/feat/elitebridge-phase5-2-offline-transport
  node --test test/elitebridge-phase52-offline.test.mjs
  node scripts/elitebridge-offline-demo.mjs

## Current boundaries
- Only simulator keys and synthetic DEMO data; no MT5 process or broker feed.
- Device enrollment and the Phase 4/4.1 database changes remain gated.
- Local journal is not a remote durable replay authorization system and is
  not proof that a broker authenticated the account.
- Signing private keys are never written to the queue; the simulator uses
  ephemeral keys. Real registered key lifecycle and Keystore integration are
  separate work.
- Local outbox lock fails closed if left behind after an abrupt shutdown.
  An operator must verify there is no active companion before removing it.
  The simulator uses its own disposable directory, so this does not affect
  any existing Termux files.
- This milestone does NOT place orders, connect to MetaApi, execute bots,
  access Render or Supabase or move production accounts.

## Before real transport
Implement a supervised endpoint with device-specific authorization, explicit
revocation, mutually authenticated communication, backoff, and durable
server-side receipt persistence. Independently verify an actual supported
MT5 terminal or broker API in DEMO mode before considering any execution
capabilities. Leave all production trading disabled for EliteBridge until
risk controls and reconciliation are reviewed.

This code is stacked on earlier PRs for review, not merged or deployed to a
production API, and is safe to execute without network credentials.
