import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileEnginePulse} from '../src/mobile-demo-engine.mjs';

const USER='e262c7f1-a3ce-4c8f-a219-866574e6ca1d';
const OTHER='11111111-2222-4333-8444-555555555555';
const gateway={mode:'account-data'};
function setup(runs=[]){
 const queries=[],heartbeats=[];
 const db={
   query:async(name,where)=>{queries.push({name,where});return runs;},
   upsert:async(name,where,value)=>{heartbeats.push({name,value});return [value];}
 };
 return {db,queries,heartbeats};
}
test('mobile heartbeat is server-only and does not arm an inactive demo bot',async()=>{
 const {db,queries,heartbeats}=setup();
 const r=await mobileEnginePulse({db,gateway,userId:USER,processor:()=>{throw Error('not expected')}});
 assert.equal(r.evaluated,0);assert.equal(r.armed,false);
 assert.equal(heartbeats.length,1);
 assert.ok(queries[0].where.includes('user_id=eq.'+USER));
 assert.ok(queries[0].where.includes('enabled=eq.true'));
});
test('a demo run is processed only when it belongs to the current authenticated user',async()=>{
 const own={bot_id:'abc',user_id:USER,enabled:true};
 const {db,heartbeats}=setup([own]);
 const processed=[];
 const r=await mobileEnginePulse({db,gateway,userId:USER,processor:async v=>processed.push(v.run)});
 assert.equal(r.evaluated,1);assert.deepEqual(processed,[own]);assert.equal(heartbeats.length,2);
});
test('cross-account run returned unexpectedly fails closed before any processing',async()=>{
 const {db}=setup([{user_id:OTHER,enabled:true}]);let executed=false;
 await assert.rejects(mobileEnginePulse({db,gateway,userId:USER,processor:async()=>executed=true}),/scope/);
 assert.equal(executed,false);
});
test('only broker account-data mode can publish an execution heartbeat',async()=>{
 const {db,heartbeats}=setup();
 await assert.rejects(mobileEnginePulse({db,gateway:{mode:'demo'},userId:USER}),/gateway/);
 assert.equal(heartbeats.length,0);
});
test('invalid or absent authenticated identity cannot execute worker',async()=>{
 const {db,queries}=setup();
 await assert.rejects(mobileEnginePulse({db,gateway,userId:'not-authorized'}),/authenticated/);
 assert.equal(queries.length,0);
});
