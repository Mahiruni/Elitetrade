#!/usr/bin/env bash
# Interactive, no-echo setup for the original EliteTrade Termux worker.
# Does not start the worker, enable execution, call a provider, or print secrets.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

if [[ ! -t 0 ]]; then
  echo "Open Termux interactively to enter the credentials privately." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js first: pkg install nodejs-lts" >&2
  exit 1
fi
echo "EliteTrade secure Termux configuration"
echo "IMPORTANT: The old Supabase legacy service_role key and MetaApi token were exposed."
echo "Create a new Supabase sb_secret_ key and revoke the exposed MetaApi token."
echo "After Vercel/other clients migrate, deactivate the compromised legacy Supabase key."
read -r -p "Type NEW_KEYS_CREATED after creating the replacement Supabase secret and MetaApi token: " verified
if [[ "$verified" != "NEW_KEYS_CREATED" ]]; then
  echo "Setup canceled. Create replacement keys before continuing."
  exit 1
fi

if [[ -e .env ]]; then
  read -r -p "Replace the current private .env (old keys will NOT be backed up)? [yes/NO]: " consent
  if [[ "$consent" != "yes" ]]; then
    echo "Existing .env unchanged."
    exit 0
  fi
fi

printf 'Paste NEW Supabase sb_secret_ backend key (input hidden), then Enter: '
IFS= read -r -s service_key
printf '\n'
printf 'Paste NEW MetaApi API token (input hidden), then Enter: '
IFS= read -r -s metaapi_token
printf '\n'

# The Node process validates the keys and removes invisible Unicode
# formatting marks that sometimes accompany mobile copy/paste.
ELITETRADE_LOCAL_ROLE="$service_key" ELITETRADE_LOCAL_METAAPI="$metaapi_token" node --input-type=module <<'NODE'
import {writeFileSync} from 'node:fs';

const clean = text => String(text || '').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'').trim();
const secret = clean(process.env.ELITETRADE_LOCAL_ROLE);
const meta = clean(process.env.ELITETRADE_LOCAL_METAAPI);
const segments = token => token.split('.');
const decode = token => JSON.parse(Buffer.from(segments(token)[1] || '', 'base64url').toString('utf8'));
try {
  if (!/^sb_secret_[A-Za-z0-9_-]{16,}$/.test(secret))
    throw new Error('Enter a NEW sb_secret_ backend key from EliteTrade Supabase Settings → API Keys (not the leaked legacy JWT or publishable key).');
  // Opaque sb_secret_ tokens cannot be locally tied to a project by decoding.
  // The read-only termux-doctor verifies ownership online via Supabase.
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(meta))
    throw new Error('MetaApi API token format is invalid. Paste the complete NEW API access token.');
  const m = decode(meta);
  const now = Math.floor(Date.now()/1000);
  if (Number.isFinite(m.exp) && m.exp <= now)
    throw new Error('MetaApi token is expired. Generate a new one in MetaApi.');
  const vars = [
    'SUPABASE_URL=https://cgpvhayfwnpipktyltho.supabase.co',
    'SUPABASE_SECRET_KEY=' + secret,
    'METAAPI_TOKEN=' + meta,
    'METAAPI_REGION=london',
    'DEMO_EXECUTION_ENABLED=false',
    ''
  ];
  writeFileSync('.env',vars.join('\n'),{mode:0o600,flag:'w'});
  console.log('Saved a clean private .env (mode 0600).');
  console.log('DEMO_EXECUTION_ENABLED=false; no worker or broker order has been started.');
  console.log('NEXT: node --env-file=.env scripts/termux-doctor.mjs');
  console.log('Note: only the remote preflight can confirm this opaque key is valid for EliteTrade.');
} catch(error) {
  console.error('Setup failed:',error.message);
  process.exitCode=1;
}
NODE
unset service_key metaapi_token
