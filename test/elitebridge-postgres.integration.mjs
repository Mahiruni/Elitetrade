// Executes against a real, disposable PostgreSQL database in GitHub Actions.
// Intentionally excluded from "npm test" (which matches test/*.test.mjs).
// This is NOT a production migration, independent MT5 gateway or hosted service.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createStandaloneBridgeStore} from '../src/elitebridge-standalone-store.mjs';
import {createEliteBridgeRegistry} from '../src/elitebridge-registry.mjs';
import {createSandboxKeys,signBridgePacket} from '../src/elitebridge-protocol.mjs';

const url=process.env.ELITEBRIDGE_TEST_DATABASE_URL;
if(!url || !/^(postgres|postgresql):\/\//.test(url)) {
  throw new Error('ELITEBRIDGE_TEST_DATABASE_URL must reference a disposable PostgreSQL test database.');
}
const ownerId=randomUUID();
const adminId=randomUUID();
const outsiderId=randomUUID();
const accountId=randomUUID();
const deviceId=randomUUID();
const anotherId=randomUUID();
const keys=createSandboxKeys();
const secondKeys=createSandboxKeys();
const pub=key=>key.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const now=Date.now();

test('Phase 5 standalone PostgreSQL: real schema, authorization, replay, revocation',async t=>{
  const pool=new pg.Pool({connectionString:url,max:8,connectionTimeoutMillis:8000});
  t.after(async()=>pool.end());
  // The CI PostgreSQL instance is disposable; this script must not be used
  // on production databases. Schema is isolated to the EliteBridge namespace.
  await pool.query(readFileSync(new URL('../db/elitebridge-standalone.sql',import.meta.url),'utf8'));
  const policy={
    isActiveUser:async user=>user===ownerId||user===adminId,
    ownsAccount:async(user,account)=>user===ownerId&&account===accountId,
    isAdmin:async user=>user===adminId
  };
  const make=()=>createEliteBridgeRegistry({
    db:createStandaloneBridgeStore({pool,...policy})
  });
  const registry=make();
  const signed=(sequence,messageId)=>signBridgePacket({
    privateKey:keys.privateKey,accountId,deviceId,sequence,
    kind:'terminal.heartbeat',
    payload:{accountType:'demo',connected:true,tradeAllowed:false},
    issuedAt:now,expiresAt:now+60000,
    ...(messageId?{messageId}:{})
  });
  const check=async(packet,bridge=registry)=>bridge.verifySignedDemo({
    ownerId,accountId,deviceId,packet,nowMs:now
  });

  await t.test('schema rejects anonymous database roles without grants',async()=>{
    const role='elitebridge_ci_guest';
    await pool.query('create role '+role);
    const client=await pool.connect();
    try{
      await client.query('begin');
      await client.query('set local role '+role);
      await assert.rejects(
        client.query('select count(*) from elitebridge.devices'),
        /permission denied/
      );
      await client.query('rollback');
    }finally{client.release()}
    await pool.query('drop role '+role);
  });

  await t.test('owner can stage only pending identity; role does not auto-approve',async()=>{
    await assert.rejects(registry.stage({
      ownerId:outsiderId,accountId,deviceId,
      displayName:'Not mine',publicKeySpki:pub(keys)
    }),/account unavailable|account ownership denied/);
    const x=await registry.stage({
      ownerId,accountId,deviceId,displayName:'My signed Android',publicKeySpki:pub(keys)
    });
    assert.equal(x.state,'pending');
    assert.equal(x.ordersEnabled,false);
    const row=await pool.query('select state,last_sequence from elitebridge.devices where id=$1',[deviceId]);
    assert.equal(row.rows[0].state,'pending');
    assert.equal(String(row.rows[0].last_sequence),'0');
    await assert.rejects(check(signed(1)),/not approved/);
    await assert.rejects(registry.approve({actorId:ownerId,deviceId}),/administrator required/);
  });

  await t.test('administrator approval pins public key and rejects forged signatures',async()=>{
    const approved=await registry.approve({actorId:adminId,deviceId});
    assert.equal(approved.state,'approved');
    const legitimate=signed(1);
    const tampered={...legitimate,payload:{...legitimate.payload,connected:false}};
    await assert.rejects(check(tampered),/signature verification failed/);
    assert.equal((await pool.query('select count(*)::int as count from elitebridge.accepted_messages')).rows[0].count,0);
    const accepted=await check(legitimate);
    assert.equal(accepted.verified,true);
    assert.equal(accepted.brokerVerified,false);
    assert.equal(accepted.actionsAllowed,false);
    assert.equal((await pool.query('select count(*)::int as count from elitebridge.accepted_messages')).rows[0].count,1);
  });

  await t.test('replay survives registry reconstruction and concurrent requests',async()=>{
    await assert.rejects(check(signed(1),make()),/replay or out-of-order/);
    const p=signed(2);
    const results=await Promise.allSettled([check(p,make()),check(p,make())]);
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.filter(x=>x.status==='rejected').length,1);
    assert.match(results.find(x=>x.status==='rejected').reason.message,/replay or out-of-order/);
    const state=await pool.query('select last_sequence from elitebridge.devices where id=$1',[deviceId]);
    assert.equal(String(state.rows[0].last_sequence),'2');
    const count=await pool.query('select count(*)::int as count from elitebridge.accepted_messages where device_id=$1',[deviceId]);
    assert.equal(count.rows[0].count,2);
    await assert.rejects(check(signed(1),make()),/replay or out-of-order/);
    assert.throws(()=>signBridgePacket({
      privateKey:keys.privateKey,accountId,deviceId,sequence:3,
      kind:'terminal.heartbeat',
      payload:{accountType:'real',connected:true,tradeAllowed:true},
      issuedAt:now,expiresAt:now+60000
    }),/REAL accounts are prohibited/);
  });

  await t.test('one approved terminal per account; revocation blocks further claims',async()=>{
    await registry.stage({ownerId,accountId,deviceId:anotherId,
      displayName:'Backup phone',publicKeySpki:pub(secondKeys)});
    await assert.rejects(
      registry.approve({actorId:adminId,deviceId:anotherId}),
      /duplicate key value violates unique constraint/
    );
    await registry.revoke({actorId:ownerId,deviceId});
    await assert.rejects(check(signed(3),make()),/not approved/);
    const next=await registry.approve({actorId:adminId,deviceId:anotherId});
    assert.equal(next.state,'approved');
    const audit=await pool.query(
      'select sequence,kind from elitebridge.accepted_messages where device_id=$1 order by sequence',[deviceId]
    );
    assert.deepEqual(audit.rows.map(x=>Number(x.sequence)),[1,2]);
    assert.deepEqual(audit.rows.map(x=>x.kind),['terminal.heartbeat','terminal.heartbeat']);
  });

  await t.test('owner-scoped inventory never returns pinned key material',async()=>{
    const store=createStandaloneBridgeStore({pool,...policy});
    const rows=await store.rpc('elitetrade_bridge_inventory',{p_actor_id:ownerId});
    assert.equal(rows.length,2);
    assert.ok(rows.every(x=>x.owner_id===ownerId));
    assert.ok(!JSON.stringify(rows).includes(pub(keys)));
    await assert.rejects(store.rpc('elitetrade_bridge_inventory',{p_actor_id:outsiderId}),
      /account unavailable/);
    assert.ok((await pool.query(
      "select count(*)::int as count from information_schema.tables where table_schema='elitebridge'"
    )).rows[0].count>=2);
  });
});
