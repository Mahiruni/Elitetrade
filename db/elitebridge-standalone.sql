-- EliteBridge Phase 5: independent PostgreSQL schema for a SEPARATE database.
-- Do NOT execute this in the live Supabase project. Apply only to a disposable
-- development Postgres database first, after explicit target confirmation.
-- No auth.users foreign keys: account identity is verified through a required
-- trusted upstream authorization callback in the backend adapter.
begin;
create schema if not exists elitebridge;
revoke all on schema elitebridge from public;
create table if not exists elitebridge.devices (
  id uuid primary key,
  owner_id uuid not null,
  account_id uuid not null,
  role text not null default 'terminal' check (role='terminal'),
  display_name text not null check(length(display_name) between 1 and 64),
  public_key_spki text not null check(public_key_spki ~ '^[A-Za-z0-9_-]{58,100}$'),
  fingerprint text not null check(fingerprint ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check(state in ('pending','approved','revoked')),
  approved_by uuid,
  approved_at timestamptz,
  revoked_at timestamptz,
  last_sequence bigint not null default 0 check(last_sequence >= 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(account_id,fingerprint),
  check ((state='approved' and approved_by is not null and approved_at is not null)
      or state <> 'approved')
);
create unique index if not exists elitebridge_one_approved_terminal
 on elitebridge.devices(account_id) where state='approved';
create index if not exists elitebridge_devices_owner
 on elitebridge.devices(owner_id,created_at desc);

create table if not exists elitebridge.accepted_messages (
  message_id text primary key check(message_id ~ '^[0-9a-f]{32}$'),
  device_id uuid not null references elitebridge.devices(id) on delete cascade,
  owner_id uuid not null,
  account_id uuid not null,
  sequence bigint not null check(sequence > 0),
  kind text not null check(kind in ('terminal.heartbeat','terminal.quote')),
  accepted_at timestamptz not null default clock_timestamp(),
  unique(device_id,sequence)
);
create index if not exists elitebridge_accepted_by_device
 on elitebridge.accepted_messages(device_id,accepted_at desc);

-- This is a server-only database: never use it as a direct mobile/web API.
revoke all on elitebridge.devices,elitebridge.accepted_messages from public;
-- Provision an application-specific least-privilege DB user separately,
-- with TLS and explicit schema/table/sequence grants, not the DB owner.
-- Backups, recovery drills, network policies and key rotation are mandatory
-- before handling production device identities.
commit;
