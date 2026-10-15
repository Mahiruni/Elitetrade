import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {eliteBridgeProtocolStatus} from '../src/elitebridge-protocol.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Phase 4 capability: enrolled transport available, broker orders remain disabled',()=>{
 const current=eliteBridgeProtocolStatus({terminalEnrollmentAvailable:true});
 assert.equal(current.version,3);
 assert.equal(current.state,'terminal-pairing-available');
 assert.equal(current.pairingEnabled,true);
 assert.equal(current.independentMT5Connected,false);
 assert.equal(current.brokerVerified,false);
 assert.equal(current.ordersEnabled,false);
 assert.deepEqual(eliteBridgeProtocolStatus().supportedPackets,current.supportedPackets);
});
test('web and Android pairing UI expose server-controlled terminal lifecycle with no broker trade path',()=>{
 const ui=read('public/hosted-mt5.js'),native=read('android-native/app/src/main/java/com/elitetrade/android/EliteBridgePage.kt');
 const app=read('android-native/app/src/main/java/com/elitetrade/android/NativeApi.kt');
 assert.match(ui,/Register public identity/);
 assert.match(ui,/Approved|Approve identity/);
 assert.match(ui,/data-bridge-revoke/);
 assert.match(ui,/Bridge|brokerVerification|Broker verification/);
 assert.match(native,/Phase 4 · Windows terminal pairing/);
 assert.match(native,/Register Windows identity/);
 assert.match(native,/Approve verified identity/);
 assert.match(native,/Broker NOT verified/);
 for(const method of ['bridgeTerminals','bridgeEnroll','bridgeApprove','bridgeRevoke'])
   assert.ok(app.includes('fun '+method+'('));
 assert.doesNotMatch(ui,/demoOrder\(|market\(.*ORDER_TYPE/);
});
test('server routes are scoped to device verified owners and signed data cannot arm trading',()=>{
 const server=read('src/supabase-app.mjs');
 for(const path of ["'/api/elitebridge/terminals'","'/api/elitebridge/telemetry'"])
   assert.ok(server.includes(path));
 assert.match(server,/verifyEnrollmentProof\(/);
 assert.match(server,/ingestSignedTerminalPacket\(/);
 assert.match(server,/rateLimit\('bridge-telemetry/);
 assert.match(server,/owner_id=eq\.\$\{q\(ctx\.user\.id\)\}/);
 assert.match(server,/brokerVerified:false,ordersEnabled:false/);
});
