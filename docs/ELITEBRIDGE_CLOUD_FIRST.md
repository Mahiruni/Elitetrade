# EliteBridge cloud-first migration: first milestone

The existing Windows terminal uplink is **read-only**. Moving the control plane to cloud hosting does not itself provide MT5 execution connectivity.

## Added preflight

Run `node scripts/elitebridge-cloud-preflight.mjs` in the worker environment. It reports whether the HTTPS telemetry endpoint, Supabase URL, and service credential are configured. It never prints secrets, connects to a broker, or places orders. Exit codes: 0 = required settings present and real execution flag not requested; 1 = missing/invalid required setting; 2 = real execution flag detected. A passing preflight **does not** prove cloud connectivity.

## Next implementation gate

1. Select an authorized hosted MT5 terminal or supported broker gateway. Confirm costs, supported account types, and credential handling.
2. Implement a separate persistent adapter with authenticated telemetry and durable state. Keep it distinct from Vercel request handlers.
3. Test broker identity, fresh signed heartbeats, price timestamps, reconnection, and stale-data fail-closed behavior.
4. Test DEMO order lifecycle and idempotent retries with explicit risk limits. Only after separate review and operator authorization, enable REAL orders through an independent feature gate.

Never reuse a demo authorization for real trading. No fallback from missing live data to synthetic prices. The existing Render demo worker and Windows observer do not constitute a verified broker execution service.
