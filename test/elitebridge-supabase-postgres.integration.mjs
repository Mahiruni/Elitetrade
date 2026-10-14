// REAL SQL verification in an EPHEMERAL GitHub PostgreSQL 16 service.
// Neither production Supabase nor any broker is contacted. No external DSN.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,generateKeyPairSync,createHash} from 'node:crypto';
import pg from 'pg';

const url=process.env.ELITEBRIDGE_CI_POSTGRES_URL;
if(!url||!/^postgres(?:ql)?:\/\/.*@(?:127\.0\.0\.1|localhost):5432\/elitebridge_ci$/.test(url))
  throw new Error('Must use the local disposable elitebridge_ci PostgreSQL service only.');
const source=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const hex=()=>randomUUID().replace(/-/g,'');
const owner=randomUUID(),foreign=randomUUID(),admin=randomUUID(),account=randomUUID(),
  phone=randomUUID(),backupPhone=randomUUID();
const key=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'});
const publicKeySpki=key.toString('base64url');
const fingerprint=createHash('sha256').update(key).digest('hex');
const backupKey=generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'});
const backupSpki=backupKey.toString('base64url');
const backupFingerprint=createHash('sha256').update(backupKey).digest('hex');

test('real PostgreSQL 16: Supabase EliteBridge migration authorization and durable replay',async t=>{
 const pool=new pg.Pool({connectionString:url,max:8,connectionTimeoutMillis:8000});
 t.after(async()=>pool.end());
 // Minimal account/profile fixture; no actual customer records.
 await pool.query(source('./fixtures/elitebridge-supabase-staging.sql'));
 await pool.query(source('../supabase/migrations/20261015000100_elitebridge_phase4_secure_state.sql'));
 await pool.query(source('../supabase/migrations/20261015000200_elitebridge_phase41_inventory.sql'));
 const execRole=async(role,sql,parameters=[])=>{
   const client=await pool.connect();
   try{
     await client.query('BEGIN');
     await client.query('SET LOCAL ROLE '+role);
     const response=await client.query(sql,parameters);
     await client.query('COMMIT');
     return response.rows[0] ? response.rows[0].result : response.rows;
   }catch(error){
     await client.query('ROLLBACK').catch(()=>{});
     throw error;
   }finally{client.release()}
 };
 const rpc=(functionName,args)=>execRole('service_role',
   'select public.'+functionName+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') as result',args);
 const stage=(ownerId,accountId,deviceId,spki=publicKeySpki,fp=fingerprint)=>
   rpc('elitetrade_bridge_stage',[ownerId,accountId,deviceId,'Termux DEMO phone',spki,fp]);
 const approve=(actor,device)=>rpc('elitetrade_bridge_approve',[actor,device]);
 const revoke=(actor,device)=>rpc('elitetrade_bridge_revoke',[actor,device]);
 const accepted=(o,a,d,sequence,messageId,kind='terminal.heartbeat')=>
   rpc('elitetrade_bridge_claim',[o,a,d,sequence,messageId,kind]);
 const inventory=actor=>rpc('elitetrade_bridge_inventory',[actor]);
 await pool.query('insert into public.elitetrade_profiles (id,role) values ($1,$2),($3,$4),($5,$6)',
   [owner,'user',foreign,'user',admin,'admin']);
 await pool.query('insert into public.elitetrade_accounts (id,user_id) values ($1,$2)',[account,owner]);

 await t.test('private schema and RPCs deny ordinary JWT/anonymous roles',async()=>{
   for(const role of ['anon','authenticated']){
     await assert.rejects(execRole(role,'select public.elitetrade_bridge_inventory($1) as result',[owner]),
       e=>e.code==='42501');
     await assert.rejects(execRole(role,
       'select count(*)::int as result from elitetrade_private.bridge_devices'),
       e=>e.code==='42501');
   }
   const props=await pool.query(
     "select relrowsecurity as rls from pg_class where oid='elitetrade_private.bridge_devices'::regclass");
   assert.equal(props.rows[0].rls,true);
 });
 await t.test('stage requires valid owner and creates only pending device',async()=>{
   await assert.rejects(stage(foreign,account,phone),e=>e.code==='42501');
   assert.equal(await stage(owner,account,phone),true);
   const status=await pool.query(
     'select state,last_sequence,approved_by from elitetrade_private.bridge_devices where id=$1',[phone]);
   assert.equal(status.rows[0].state,'pending');
   assert.equal(String(status.rows[0].last_sequence),'0');
   assert.equal(status.rows[0].approved_by,null);
   assert.equal(await rpc('elitetrade_bridge_key',[owner,account,phone]),null);
   assert.equal(await accepted(owner,account,phone,1,hex()),false);
 });
 await t.test('only admin can approve, verified ownership and public-key pinning',async()=>{
   await assert.rejects(approve(owner,phone),e=>e.code==='42501');
   assert.equal(await approve(admin,phone),true);
   assert.equal(await approve(admin,phone),false);
   assert.equal(await rpc('elitetrade_bridge_key',[owner,account,phone]),publicKeySpki);
   assert.equal(await rpc('elitetrade_bridge_key',[foreign,account,phone]),null);
   assert.equal(await rpc('elitetrade_bridge_key',[owner,randomUUID(),phone]),null);
 });
 await t.test('real row-lock concurrency: one accepted and one replay rejected',async()=>{
   const message=hex();
   const outcomes=await Promise.all([
     accepted(owner,account,phone,1,message),
     accepted(owner,account,phone,1,message)
   ]);
   assert.deepEqual(outcomes.sort(),[false,true]);
   assert.equal(await accepted(owner,account,phone,1,hex()),false);
   assert.equal(await accepted(owner,account,phone,0,hex()),false);
   assert.equal(await accepted(owner,account,phone,2,message),false);
   assert.equal(await accepted(owner,account,phone,2,hex(),'terminal.order'),false);
   assert.equal(await accepted(owner,account,phone,2,hex()),true);
   const audit=await pool.query(
     'select sequence,kind from elitetrade_private.bridge_accepted_messages where device_id=$1 order by sequence',[phone]);
   assert.deepEqual(audit.rows.map(r=>Number(r.sequence)),[1,2]);
   assert.deepEqual(audit.rows.map(r=>r.kind),['terminal.heartbeat','terminal.heartbeat']);
 });
 await t.test('one approved terminal at a time; revocation prevents further claims',async()=>{
   await assert.rejects(stage(owner,account,backupPhone),e=>e.code==='23505');
   assert.equal(await stage(owner,account,backupPhone,backupSpki,backupFingerprint),true);
   await assert.rejects(approve(admin,backupPhone),e=>e.code==='23505');
   assert.equal(await revoke(foreign,phone),false);
   assert.equal(await revoke(owner,phone),true);
   assert.equal(await revoke(owner,phone),false);
   assert.equal(await accepted(owner,account,phone,3,hex()),false);
   assert.equal(await rpc('elitetrade_bridge_key',[owner,account,phone]),null);
   assert.equal(await approve(admin,backupPhone),true);
 });
 await t.test('inventory hides key bytes and isolates owner visibility',async()=>{
   const records=await inventory(owner);
   assert.equal(Array.isArray(records),true);
   assert.equal(records.length,2);
   assert.equal(records.every(row=>row.owner_id===owner),true);
   assert.ok(records.every(row=>!Object.hasOwn(row,'public_key_spki')));
   assert.ok(!JSON.stringify(records).includes(publicKeySpki));
   assert.deepEqual(await inventory(foreign),[]);
   assert.equal((await inventory(admin)).length,2);
 });
 await t.test('public APIs do not confer trading privileges',async()=>{
   const audited=await pool.query(
     "select count(*)::int as result from elitetrade_private.bridge_accepted_messages");
   assert.equal(audited.rows[0].result,2);
   const grants=await pool.query(
     "select has_function_privilege('authenticated','public.elitetrade_bridge_claim(uuid,uuid,uuid,bigint,text,text)','EXECUTE') as normal_role_exec, has_function_privilege('service_role','public.elitetrade_bridge_claim(uuid,uuid,uuid,bigint,text,text)','EXECUTE') as service_exec");
   assert.equal(grants.rows[0].normal_role_exec,false);
   assert.equal(grants.rows[0].service_exec,true);
 });
});
