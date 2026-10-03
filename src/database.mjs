import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDatabase(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')),
      active INTEGER NOT NULL DEFAULT 0, disabled INTEGER NOT NULL DEFAULT 0,
      referral_code TEXT NOT NULL UNIQUE, referrer_id TEXT REFERENCES users(id),
      mfa_secret TEXT, mfa_pending TEXT, mfa_counter INTEGER NOT NULL DEFAULT -1,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      csrf TEXT NOT NULL, verified INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS session_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS reset_tokens (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, hits INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    INSERT OR IGNORE INTO settings VALUES ('price_cents','14000'),('commission_percent','20'),('telegram_chat','');
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('crypto','bank','mobile_money')),
      details TEXT NOT NULL, network TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS pool_rounds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, goal_cents INTEGER NOT NULL CHECK(goal_cents>0),
      profit_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('open','trading','closed')),
      starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
      CHECK(ends_at>starts_at)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), method_id TEXT NOT NULL REFERENCES payment_methods(id),
      reference TEXT NOT NULL UNIQUE, amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
      kind TEXT NOT NULL CHECK(kind IN ('subscription','pool')), round_id TEXT REFERENCES pool_rounds(id),
      method_snapshot TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewer_id TEXT REFERENCES users(id),
      CHECK((kind='pool' AND round_id IS NOT NULL) OR (kind='subscription' AND round_id IS NULL))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS payment_user ON payments(user_id,created_at);
    CREATE TABLE IF NOT EXISTS ebook_orders (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), method_id TEXT NOT NULL REFERENCES payment_methods(id),
      reference TEXT NOT NULL UNIQUE, amount_cents INTEGER NOT NULL CHECK(amount_cents=5000),
      kind TEXT NOT NULL DEFAULT 'ebook' CHECK(kind='ebook'), round_id TEXT CHECK(round_id IS NULL),
      product_id TEXT NOT NULL CHECK(product_id='elitebot-strategy-rulebook'), method_snapshot TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewer_id TEXT REFERENCES users(id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS ebook_order_user ON ebook_orders(user_id,created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS ebook_order_once ON ebook_orders(user_id,product_id) WHERE status IN ('pending','approved');
    CREATE TABLE IF NOT EXISTS commissions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), referred_id TEXT NOT NULL REFERENCES users(id),
      payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id), amount_cents INTEGER NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS payouts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','rejected')),
      reference TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, reviewed_at INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), broker TEXT NOT NULL, login TEXT NOT NULL,
      server TEXT NOT NULL, password_encrypted TEXT NOT NULL, gateway_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','connected','disconnected','rejected','unknown')),
      note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, UNIQUE(user_id,login,server)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS bots (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), account_id TEXT REFERENCES accounts(id),
      name TEXT NOT NULL, strategy TEXT NOT NULL CHECK(strategy IN ('trend','scalping','breakout')),
      symbol TEXT NOT NULL, risk_percent REAL NOT NULL, stop_loss REAL NOT NULL, take_profit REAL NOT NULL,
      max_drawdown REAL NOT NULL, daily_loss REAL NOT NULL, lot_size REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'stopped' CHECK(status IN ('stopped','running','unknown')),
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), guest_hash TEXT,
      name TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender TEXT NOT NULL CHECK(sender IN ('customer','admin')), body TEXT NOT NULL, created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS message_conversation ON messages(conversation_id,created_at);
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, target TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    PRAGMA user_version=1;
  `);
  return db;
}

export function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try { const value = operation(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
