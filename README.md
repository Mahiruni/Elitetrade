# Elitetrade

Recovered public frontend baseline for [EliteBot](https://elitebot.live), collected on 1 October 2026.

## Current status

This repository contains the browser-delivered application files and a route/function inventory. It does not yet contain the original editable development project or an implemented redesign. The production website has not been changed by this import.

## Files

- `recovered-frontend/`: 51 original public files, plus retrieval documentation and the retrieval script.
- `recovered-frontend/FEATURE_MAP.md`: 17 named routes, controls, integration boundaries, and confirmed unfinished client handlers.
- `recovered-frontend/manifest.json`: source URLs, sizes, HTTP results, and SHA-256 hashes.
- `recovered-frontend/route-map.json`: structured route inventory.
- `archives/EliteBot_Public_Frontend_Retrieval.zip`: the complete packaged retrieval.

Recovered interfaces include login, signup, password recovery/reset, payments, subscriptions, MT5, bots, pool, referrals, settings, public support, and administrator screens.

## What is still needed for the production redesign

The original development source and backend integration points are needed to implement and publish a complete production redesign. The downloaded chunks expose UI code and server-call handles; they do not contain the private server functions, database, live account records, secrets, or hosting configuration.

The archived HTML is a record of the original responses. Opening it locally does not reproduce the server or restore authentication, payment verification, or trading execution. The feature map distinguishes server-call interfaces from controls that currently use local state or sample data.

## Validation

All 51 recovered files were checked against their manifest SHA-256 hashes. The archive passed ZIP integrity validation. No support messages, payments, account changes, or trading actions were submitted during retrieval.
