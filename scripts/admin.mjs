import { openDatabase, transaction } from '../src/database.mjs';
import { randomUUID } from 'node:crypto';

const [email, option] = process.argv.slice(2);
if (!email || option && option !== '--reset-mfa') {
  console.error('Usage: npm run admin -- your-existing-email@example.com [--reset-mfa]');
  process.exit(1);
}
const db = openDatabase(process.env.SQLITE_PATH || './data/elitetrade.sqlite');
try {
  const user = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase().trim());
  if (!user) throw new Error('Create this account in the application first, then run this command.');
  transaction(db, () => {
    if (option === '--reset-mfa') db.prepare('UPDATE users SET mfa_secret=NULL,mfa_pending=NULL,mfa_counter=-1 WHERE id=?').run(user.id);
    else db.prepare("UPDATE users SET role='admin',active=1,disabled=0 WHERE id=?").run(user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO audit_log VALUES (?,?,?,?,?)').run(randomUUID(),user.id,option ? 'operator.mfa.reset' : 'operator.admin.grant',user.id,Date.now());
  });
  console.log(option ? 'Authenticator reset. The user must sign in again.' : 'Administrator access granted. Sign in again to open Administration.');
} finally { db.close(); }
