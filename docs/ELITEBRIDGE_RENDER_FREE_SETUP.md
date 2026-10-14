# Phase 5.1 — Render Free PostgreSQL, phone-first setup

Resource: elitebridge-postgres-dev
Render database ID: dpg-db7vjjnavr4c73bke1pg-a
Workspace: My Workspace (Frankfurt)
PostgreSQL: 16
Database name: elitebridge_postgres_dev
Postgres user: elitebridge_dev_v2
Expires: 13 November 2026
Plan: Free, 1 GB, no managed backups

**Critical**: Render reports this free instance available, but its IP allowlist
was initially empty. A temporary /32 allowlist entry for the owner's phone
was subsequently confirmed. Remove it once the dev migration is complete. Hosted Render management
tools cannot query it until a permitted connection route is configured.
Do NOT open the database to 0.0.0.0/0. Use only the newly rotated credential; revoke the exposed old credential after the new one works.

## Phone setup (Termux)

1. Open the Render database Dashboard: https://dashboard.render.com/d/dpg-db7vjjnavr4c73bke1pg-a
   On its Connect/Info page, find and copy the EXTERNAL database URL. Do not
   paste it into ChatGPT, screenshots, messages or GitHub.
2. Determine your PHONE's current public IPv4 using a trusted browser network
   checker. In the database Networking/IP Allow List add only that one IPv4
   address as a /32 CIDR. This is temporary. Mobile networks may change IPs.
3. In Termux, install the PostgreSQL client:
       pkg install -y postgresql
   Then fetch the latest development-only branch:
       cd ~/Elitetrade
       git fetch origin
       git switch --track origin/feat/elitebridge-phase5-1-render-bootstrap
4. Run local bootstrap tests and check the DB identity:
       node --test test/elitebridge-render-bootstrap.test.mjs
       read -rsp 'Paste Render external DB URL (hidden): ' ELITEBRIDGE_DEV_DATABASE_URL; echo
       export ELITEBRIDGE_DEV_DATABASE_URL
       node scripts/elitebridge-render-dev-bootstrap.mjs --verify
5. Only after verification names the exact EliteBridge development database:
       node scripts/elitebridge-render-dev-bootstrap.mjs --install
       unset ELITEBRIDGE_DEV_DATABASE_URL

   Input is hidden from terminal output/history by Bash read -s. The script
   passes credentials only as environment variables to psql (not as command
   line arguments). Do not include connection details in a screenshot.

6. Back on Render's Networking page, REMOVE your phone's /32 allowlist entry
   once installation is finished. This restores external lock-down.

The schema is isolated to elitebridge.devices and elitebridge.accepted_messages.
It does not import any Supabase data or link to MT5. No API web service is
activated by this process.

## Release safety
Render Free databases expire 30 days after creation and lack managed backups.
Do not store real account credentials, payments or live trading records here.
Do not treat external IP allowlisting as substitute for TLS, passwords and
least-privilege DB roles. Production would require separate backups, key
rotation, fully tested authorization and a durable paid service.

The Render API tool used by ChatGPT supports READ-ONLY SQL only. This file
describes the explicit owner-controlled migration route from Termux instead
of weakening network restrictions or pretending the schema was installed.
