import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationData} from '../public/navigation-data.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

test('concurrent reads share a request while snapshots and consumers remain isolated',async()=>{
 const data=createNavigationData(),gate=deferred();let calls=0;
 const fetcher=()=>{calls++;return gate.promise;};
 const a=data.read('/accounts',fetcher),b=data.read('/accounts',fetcher);
 gate.resolve({accounts:[{id:'demo',balance:10}]});
 const [first,second]=await Promise.all([a,b]);assert.equal(calls,1);
 first.accounts[0].balance=99;assert.equal(second.accounts[0].balance,10);
 const cached=data.snapshot('/accounts');cached.accounts.length=0;
 assert.equal(data.snapshot('/accounts').accounts.length,1);
 await data.read('/accounts',()=>{calls++;return {accounts:[]};});
 assert.equal(calls,2,'A completed snapshot must never replace a fresh server read');
 assert.deepEqual(data.snapshot('/accounts'),{accounts:[]});
});
test('clearing on logout or mutation prevents pending responses from restoring old snapshots',async()=>{
 const data=createNavigationData(),old=deferred(),fresh=deferred();
 const first=data.read('/accounts',()=>old.promise);data.clear();
 assert.equal(data.has('/accounts'),false);assert.throws(()=>data.snapshot('/accounts'));
 const second=data.read('/accounts',()=>fresh.promise);old.resolve({owner:'old'});await first;
 assert.equal(data.has('/accounts'),false);
 fresh.resolve({owner:'new'});await second;assert.deepEqual(data.snapshot('/accounts'),{owner:'new'});
});
test('failed refresh keeps an explicit snapshot but allows a new request to retry',async()=>{
 const data=createNavigationData();await data.read('/bots',()=>({bots:[]}));
 await assert.rejects(data.read('/bots',()=>Promise.reject(new Error('unavailable'))),/unavailable/);
 assert.deepEqual(data.snapshot('/bots'),{bots:[]});
 await data.read('/bots',()=>({bots:[{status:'paused'}]}));
 assert.equal(data.snapshot('/bots').bots[0].status,'paused');data.clear();assert.equal(data.has('/bots'),false);
});
