# EliteBot public frontend retrieval

Retrieved for the requested redesign of https://elitebot.live on 1 October 2026.

This package contains the browser-delivered build recovered from the public website. It is **not the original development repository or a complete backend backup**. Original files are preserved without redesign changes.

## Contents

- Seven HTML responses: the root page and six named public pages.
- Forty-one JavaScript files, including application chunks and the website's public telemetry script.
- The compiled stylesheet, Elite Bot logo, and favicon.
- `manifest.json`: source URLs, HTTP results, file sizes, SHA-256 hashes, and external references.
- `FEATURE_MAP.md`: routes, controls, integration boundaries, and confirmed client-code findings.
- `route-map.json`: a structured route inventory.
- `retrieve-public-files.py`: the retrieval script.

All 51 distinct files discovered through the downloaded build's local dependency references were recovered. The root HTML and entry JavaScript were reused from successful downloads earlier in this conversation; the other responses were retrieved during this retrieval pass. External references are listed in the manifest and are not included as website-owned files.

## What this makes available

The files expose the interface structure, visible copy, styling, client-side interactions, navigation, and server-call boundaries for the named screens. Authentication-gated route chunks were publicly delivered assets; they were downloaded without signing in or accessing account records.

## What remains unavailable

- Original TypeScript/TSX source, source control history, development configuration, and package lockfiles.
- Private server-function implementations; the browser bundles contain callable handles, not their server source.
- Database schema, records, migration history, secrets, and infrastructure configuration.
- Live account state, payment results, MT5 connections, real trading execution, and production administrator records.
- Hosting/project access needed to publish changes at elitebot.live.

No original source maps were advertised by the recovered scripts. No passwords were entered, authentication state was forged, server mutations were invoked, support conversations were created, payments were submitted, or trades were placed.

## Using this package

Use it as the recovered interface baseline and evidence for a redesign. The HTML responses use the original website's URL paths and depend on its server routes. Opening these files locally does not reproduce the private backend or establish that login, payments, account activation, or MT5 execution work.

The live website has not been changed.
