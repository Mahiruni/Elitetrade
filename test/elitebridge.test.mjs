import test from 'node:test';
import assert from 'node:assert/strict';
import {eliteBridgeStatus,bridgeProviderForBinding,assertDemoGatewayContract} from '../src/elitebridge.mjs';

test('registered hosted MetaApi account names are recognized but never treated as an independent bridge',()=>{
 const a=bridgeProviderForBinding('metaapi:local1:remote1');
 const b=bridgeProviderForBinding('metaapi-existing:local2:remote2');
 assert.equal(a,'metaapi');assert.equal(b,'metaapi');
 assert.equal(bridgeProviderForBinding('elitebridge:unknown'),null);
 assert.equal(bridgeProviderForBinding('metaapi-existing:bad value:remote'),null);
});
test('no terminal credentials, gateway identifiers, passwords or account numbers leak in read-only status',()=>{
 const status=eliteBridgeStatus({gateway:{mode:'account-data'},workerReady:true,
 accounts:[{gateway_id:'metaapi-existing:local:remote',status:'connected',login:'477054974',broker:'Exness',password:'DO-NOT-RETURN'}]});
 assert.equal(status.activeProvider,'metaapi');
 assert.equal(status.providers[1].status,'not-connected');
 assert.equal(status.accounts[0].account,'••••974');
 assert.equal(status.accounts[0].verification,'saved-binding-only');
 assert.equal(status.executionEnabledByBridge,false);
 const serialized=JSON.stringify(status);
 for(const secret of ['477054974','DO-NOT-RETURN','metaapi-existing:local:remote'])assert.ok(!serialized.includes(secret));
});
test('without gateway the future bridge is not advertised as live',()=>{
 const status=eliteBridgeStatus({accounts:[],gateway:null,workerReady:false});
 assert.equal(status.activeProvider,null);
 assert.equal(status.providers[0].status,'not-configured');
 assert.equal(status.providers[1].implemented,false);
 assert.equal(status.workerHeartbeatFresh,false);
});
test('the future execution adapter interface fails closed if any operation is missing',()=>{
 assert.throws(()=>assertDemoGatewayContract(null),/missing/);
 assert.throws(()=>assertDemoGatewayContract({mode:'account-data',market(){}}),/required capability/);
 const good={mode:'account-data'};
 for(const k of ['connectionHealth','snapshot','previewMarket','market','margin','demoOrder'])good[k]=()=>{};
 assert.equal(assertDemoGatewayContract(good),true);
});
test('read-only provider inventory cannot trigger any broker methods',()=>{
 let called=false;
 const gateway={mode:'account-data',demoOrder(){called=true},market(){called=true}};
 eliteBridgeStatus({gateway,accounts:[]});
 assert.equal(called,false);
});
