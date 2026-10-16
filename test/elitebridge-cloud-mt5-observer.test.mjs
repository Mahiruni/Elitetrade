import test from 'node:test';
import assert from 'node:assert/strict';
import {createCloudMt5Observer} from '../src/elitebridge-cloud-mt5-observer.mjs';
const at=Date.parse('2026-10-16T12:00:00.000Z');
const data={authenticated:true,brokerConnected:true,platform:'mt5',mode:'demo',
 server:'Exness-MT5Trial9',accountId:'local-account',observedAt:new Date(at).toISOString(),
 balance:1000,equity:990};
const make=(value)=>createCloudMt5Observer({
 endpoint:'https://gateway.example.test/api',token:'private-test-token',clock:()=>at,
 fetchImpl:async()=>({ok:true,json:async()=>value})
});
const args={broker:'Exness',server:'Exness-MT5Trial9',mode:'demo',accountId:'local-account'};
test('accepts fresh authenticated Exness demo snapshot without enabling trades',async()=>{
 const result=await make(data).snapshot(args);
 assert.equal(result.brokerAuthenticated,true);
 assert.equal(result.tradingEnabled,false);
});
test('rejects mismatched real server in demo mode',async()=>{
 await assert.rejects(make(data).snapshot({...args,server:'Exness-MT5Real9'}),/does not match/);
});
test('rejects stale snapshot',async()=>{
 await assert.rejects(make({...data,observedAt:new Date(at-31000).toISOString()}).snapshot(args),/stale/);
});
test('rejects unverified gateway identity',async()=>{
 await assert.rejects(make({...data,authenticated:false}).snapshot(args),/not verified/);
});
test('rejects wrong account binding',async()=>{
 await assert.rejects(make({...data,accountId:'other-account'}).snapshot(args),/not verified/);
});
