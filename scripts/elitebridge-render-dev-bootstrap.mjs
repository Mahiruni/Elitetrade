#!/usr/bin/env node
// Phase 5.1: Termux bootstrap for ONE disposable Render Free Postgres DB.
// No credentials in Git, CLI arguments, or stdout. Never migrate production.
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const TARGET={
  database:'elitebridge_postgres_dev',
  user:'elitebridge_dev_v2',
  hostPrefix:'dpg-db7vjjnavr4c73bke1pg-a.',
  region:'frankfurt'
};
function invalid(){throw new Error('Invalid Render development database URL. Copy the external URL for elitebridge-postgres-dev (Frankfurt) from Render.');}

export function parseRenderDevelopmentUrl(raw){
  if(typeof raw!=='string'||raw.length>2048||raw.length<30)invalid();
  let u;
  try{u=new URL(raw.trim())}catch{invalid()}
  if(!['postgres:','postgresql:'].includes(u.protocol)||
    !u.hostname.startsWith(TARGET.hostPrefix)||
    !u.hostname.includes('frankfurt')||
    !u.hostname.endsWith('.render.com')||
    decodeURIComponent(u.pathname)!=='/'+TARGET.database||
    decodeURIComponent(u.username)!==TARGET.user||
    !u.password||u.hash)invalid();
  const password=decodeURIComponent(u.password);
  if(!password||password.includes('\n')||password.includes('\r'))invalid();
  const port=Number(u.port||5432);
  if(!Number.isInteger(port)||port<1||port>65535)invalid();
  return {host:u.hostname,port:String(port),database:TARGET.database,user:TARGET.user,password};
}

// Report ONLY fixed categories: libpq diagnostics can contain connection
// details, so do not print stderr, command arguments, or the database URL.
export function classifyPsqlFailure(stderr='',code='',status=null){
  const s=String(stderr||'').toLowerCase(), c=String(code||'').toUpperCase();
  if(c==='ENOENT')return 'PSQL_CLIENT_MISSING: Install with pkg install postgresql.';
  if(c==='ETIMEDOUT'||/connection timed out|operation timed out|timeout expired/.test(s))
    return 'NETWORK_TIMEOUT: Verify your current public IPv4 /32 in Render Networking, mobile data routing, and port 5432.';
  if(/password authentication failed|scram authentication failed/.test(s))
    return 'PASSWORD_REJECTED: The new credential or copied External Database URL is incorrect; copy it again from Render.';
  if(/no pg_hba.conf entry|not authorized|not allowed to connect/.test(s))
    return 'NETWORK_RULE_OR_TLS_DENIED: Check the Render inbound IP allowlist and TLS settings.';
  if(/could not translate host name|name or service not known|temporary failure in name resolution|no address associated/.test(s))
    return 'DNS_FAILURE: The Render hostname cannot be resolved on your mobile network.';
  if(/network is unreachable|no route to host|network unreachable/.test(s))
    return 'NETWORK_UNREACHABLE: Try a different network or refresh your phone connection.';
  if(/connection refused/.test(s))
    return 'CONNECTION_REFUSED: Render is not accepting traffic on the database port.';
  if(/ssl|tls|certificate/.test(s))
    return 'TLS_FAILURE: SSL negotiation failed; check mobile network interception or the connection endpoint.';
  if(/role .* does not exist|database .* does not exist/.test(s))
    return 'DATABASE_OR_USER_MISSING: The copied credentials do not match the database.';
  if(/permission denied|must be owner|syntax error|already exists/.test(s))
    return 'SQL_PERMISSION_OR_SCHEMA_ERROR: Connected to PostgreSQL, but the SQL step failed. Do not retry installation blindly.';
  return 'OTHER_PSQL_FAILURE: Exit code '+(Number.isInteger(status)?status:'unknown')+'. No credentials or server error details shown.';
}

function runPsql(connection,args,opts={}){
  const env={
    ...process.env,
    PGHOST:connection.host,
    PGPORT:connection.port,
    PGDATABASE:connection.database,
    PGUSER:connection.user,
    PGPASSWORD:connection.password,
    PGSSLMODE:'require',
    PGCONNECT_TIMEOUT:'12',
    PGAPPNAME:'elitebridge-dev-bootstrap'
  };
  delete env.ELITEBRIDGE_DEV_DATABASE_URL;
  const result=spawnSync('psql',['-X','-v','ON_ERROR_STOP=1',...args],{
    encoding:'utf8',env,timeout:opts.timeout??30000,stdio:['ignore','pipe','pipe']
  });
  if(result.error||result.status!==0){
    throw new Error(classifyPsqlFailure(result.stderr,result.error?.code,result.status));
  }
  return (result.stdout||'').trim();
}

export function checkRenderDevDatabase(connection){
  const query="select current_database()||'|'||current_user||'|'||current_setting('server_version_num')||'|'||exists(select 1 from pg_namespace where nspname='elitebridge');";
  const parts=runPsql(connection,['-At','-c',query]).split('|');
  if(parts.length!==4||parts[0]!==TARGET.database||parts[1]!==TARGET.user||
    !/^16[0-9]{4}$/.test(parts[2])){
    throw new Error('Database identity or PostgreSQL major version mismatch; refusing schema changes.');
  }
  return {database:parts[0],role:parts[1],postgres:parts[2],schemaPresent:parts[3]==='t'};
}

async function main(){
  const mode=process.argv[2];
  if(!['--verify','--install'].includes(mode)){
    console.error('Usage: node scripts/elitebridge-render-dev-bootstrap.mjs --verify | --install');
    process.exitCode=2;return;
  }
  const conn=parseRenderDevelopmentUrl(process.env.ELITEBRIDGE_DEV_DATABASE_URL);
  const info=checkRenderDevDatabase(conn);
  console.log('Connection verified: Render Frankfurt · PostgreSQL 16 · '+info.database);
  console.log('EliteBridge schema present: '+(info.schemaPresent?'yes':'no'));
  if(mode==='--verify')return;
  if(info.schemaPresent){
    console.log('Schema already exists; no changes applied.');
    return;
  }
  // Hardcoded repository SQL path, not provided by untrusted request input.
  const schema=resolve(dirname(fileURLToPath(import.meta.url)),'../db/elitebridge-standalone.sql');
  const file=readFileSync(schema,'utf8');
  if(!file.includes('create schema if not exists elitebridge;')||
    !file.includes('create table if not exists elitebridge.devices')){
    throw new Error('Expected development schema was not found; refusing migration.');
  }
  console.log('Applying development-only EliteBridge schema…');
  runPsql(conn,['-f',schema],{timeout:60000});
  const after=checkRenderDevDatabase(conn);
  if(!after.schemaPresent)throw new Error('Migration completed without expected schema.');
  console.log('EliteBridge schema installed on the disposable Render development database.');
  console.log('Supabase, MT5 and production services unchanged. No private connection values printed.');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(e=>{console.error(e?.message?.startsWith('Invalid Render')?e.message:
    'EliteBridge setup stopped: '+(e?.message||'Unknown error'));process.exitCode=1});
}
