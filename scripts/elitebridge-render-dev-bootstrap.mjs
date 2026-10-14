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
    // No process arguments or exception messages contain the password.
    throw new Error('PostgreSQL connection or command failed. Check phone IP allowlist, TLS URL, database availability and credentials.');
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
