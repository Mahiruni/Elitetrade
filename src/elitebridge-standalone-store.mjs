import {bridgePublicKeyIdentity} from './elitebridge-registry.mjs';

// Phase 5: PostgreSQL SQL adapter for an independently operated database.
// No network credentials or pg dependency are embedded: caller injects a
// secured pg-compatible Pool and existing trusted identity authorization.
// This is intentionally NOT connected to production until staging validation.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hex=/^[0-9a-f]{32}$/;
const fingerprintPattern=/^[0-9a-f]{64}$/;
const allowed=new Set(['terminal.heartbeat','terminal.quote']);
const expect=(value,msg)=>{if(!value)throw new Error('EliteBridge standalone: '+msg)};
function id(value,msg){
  expect(typeof value==='string'&&uuid.test(value),'invalid '+msg);
  return value.toLowerCase();
}
function rowAffected(response){return response?.rowCount===1}
function requireRpcArgs(value){
  expect(value!==null&&typeof value==='object'&&!Array.isArray(value),'invalid RPC args');
  return value;
}

/** Uses an exclusive server-held DB account and an upstream authoritative owner
 * and administrator checker. A callback MUST explicitly return true.
 * This does not implement user authentication, which remains upstream.
 */
export function createStandaloneBridgeStore({pool,isActiveUser,ownsAccount,isAdmin}={}){
  expect(pool&&typeof pool.query==='function'&&typeof pool.connect==='function','PostgreSQL pool required');
  expect(typeof isActiveUser==='function'&&typeof ownsAccount==='function'&&
    typeof isAdmin==='function','authoritative authorization callbacks required');
  const active=async user=>await isActiveUser(user)===true;
  const owner=async(user,account)=>(await active(user))&&(await ownsAccount(user,account)===true);
  const admin=async user=>(await active(user))&&(await isAdmin(user)===true);
  return {
    // Compatible with the Phase 4 / Phase 4.1 server-only registry API.
    async rpc(name,raw){
      const p=requireRpcArgs(raw);
      switch(name){
        case 'elitetrade_bridge_stage':{
          const actor=id(p.p_owner_id,'owner'),account=id(p.p_account_id,'account'),
            device=id(p.p_device_id,'device');
          expect(await owner(actor,account),'account ownership denied');
          expect(typeof p.p_display_name==='string'&&p.p_display_name.length>=1&&
            p.p_display_name.length<=64,'invalid device name');
          const parsed=bridgePublicKeyIdentity(p.p_public_key_spki);
          expect(fingerprintPattern.test(String(p.p_fingerprint||''))&&
            parsed.fingerprint===p.p_fingerprint,'key fingerprint mismatch');
          const result=await pool.query(
            'insert into elitebridge.devices (id,owner_id,account_id,display_name,public_key_spki,fingerprint) values ($1,$2,$3,$4,$5,$6) returning id',
            [device,actor,account,p.p_display_name,parsed.spki,parsed.fingerprint]);
          return rowAffected(result);
        }
        case 'elitetrade_bridge_approve':{
          const actor=id(p.p_actor_id,'actor'),device=id(p.p_device_id,'device');
          expect(await admin(actor),'administrator required');
          const row=(await pool.query(
            'select owner_id,account_id from elitebridge.devices where id=$1 and state=$2',
            [device,'pending'])).rows?.[0];
          if(!row)return false;
          expect(await owner(row.owner_id,row.account_id),'account ownership no longer valid');
          return rowAffected(await pool.query(
            'update elitebridge.devices set state=$2,approved_by=$3,approved_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1 and state=$4 returning id',
            [device,'approved',actor,'pending']));
        }
        case 'elitetrade_bridge_revoke':{
          const actor=id(p.p_actor_id,'actor'),device=id(p.p_device_id,'device');
          expect(await active(actor),'account unavailable');
          const row=(await pool.query(
            'select owner_id from elitebridge.devices where id=$1 and state <> $2',
            [device,'revoked'])).rows?.[0];
          if(!row)return false;
          expect(row.owner_id===actor || await admin(actor),'device ownership denied');
          return rowAffected(await pool.query(
            'update elitebridge.devices set state=$2,revoked_at=clock_timestamp(),updated_at=clock_timestamp() where id=$1 and state <> $3 returning id',
            [device,'revoked','revoked']));
        }
        case 'elitetrade_bridge_key':{
          const actor=id(p.p_owner_id,'owner'),account=id(p.p_account_id,'account'),
            device=id(p.p_device_id,'device');
          expect(await owner(actor,account),'account ownership denied');
          const result=await pool.query(
            'select public_key_spki from elitebridge.devices where id=$1 and owner_id=$2 and account_id=$3 and state=$4 and role=$5',
            [device,actor,account,'approved','terminal']);
          return result.rows?.[0]?.public_key_spki ?? null;
        }
        case 'elitetrade_bridge_claim':{
          const actor=id(p.p_owner_id,'owner'),account=id(p.p_account_id,'account'),
            device=id(p.p_device_id,'device');
          expect(await owner(actor,account),'account ownership denied');
          const seq=p.p_sequence,message=p.p_message_id,kind=p.p_kind;
          if(!Number.isSafeInteger(seq)||seq<1||typeof message!=='string'||
            !hex.test(message)||!allowed.has(kind))return false;
          // SELECT FOR UPDATE serializes claims and revocation of the same
          // device. Never use a Vercel process-local Map for this operation.
          const client=await pool.connect();
          let begun=false;
          try {
            await client.query('begin');
            begun=true;
            const stored=await client.query(
              'select last_sequence from elitebridge.devices where id=$1 and owner_id=$2 and account_id=$3 and state=$4 and role=$5 for update',
              [device,actor,account,'approved','terminal']);
            const last=stored.rows?.[0]?.last_sequence;
            if(last===undefined || BigInt(seq)<=BigInt(last)){
              await client.query('rollback');
              begun=false;
              return false;
            }
            const inserted=await client.query(
              'insert into elitebridge.accepted_messages (message_id,device_id,owner_id,account_id,sequence,kind) values ($1,$2,$3,$4,$5,$6) on conflict do nothing returning message_id',
              [message,device,actor,account,seq,kind]);
            if(!rowAffected(inserted)){
              await client.query('rollback');
              begun=false;
              return false;
            }
            const updated=await client.query(
              'update elitebridge.devices set last_sequence=$2,updated_at=clock_timestamp() where id=$1 and state=$3 returning id',
              [device,seq,'approved']);
            expect(rowAffected(updated),'device revoked before claim');
            await client.query('commit');
            begun=false;
            return true;
          }catch(error){
            if(begun)try{await client.query('rollback')}catch{}
            throw error;
          }finally{client.release()}
        }
        case 'elitetrade_bridge_inventory':{
          const actor=id(p.p_actor_id,'actor');
          expect(await active(actor),'account unavailable');
          const elevated=await admin(actor);
          const sql='select id as device_id,owner_id,account_id,display_name,fingerprint,state,last_sequence,created_at,approved_at,revoked_at from elitebridge.devices ';
          const result=elevated
            ? await pool.query(sql+'order by created_at desc limit 100')
            : await pool.query(sql+'where owner_id=$1 order by created_at desc limit 100',[actor]);
          // Do NOT include private keys, public-key bytes or MT5 passwords.
          return result.rows??[];
        }
        default: throw new Error('EliteBridge standalone: unsupported RPC');
      }
    }
  };
}
