import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
const source = process.env.SQLITE_PATH || './data/elitetrade.sqlite';
const destination = resolve(process.argv[2] || `backups/elitetrade-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
if (resolve(source) === destination) throw new Error('Choose a separate backup destination.');
mkdirSync(dirname(destination),{recursive:true,mode:0o700});
const db = new DatabaseSync(source,{readOnly:true});
try { await backup(db,destination); chmodSync(destination,0o600); console.log(`Backup saved: ${destination}`); }
finally { db.close(); }
