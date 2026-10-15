import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createSandboxKeys,verifyBridgePacket,createSandboxReplayStore} from '../src/elitebridge-protocol.mjs';
import {signLocalMt5DemoPackets,validateMt5ReadOnlyObservation} from '../src/elitebridge-mt5-terminal-companion.mjs';
import {ELITEBRIDGE_TOKEN_SCOPE} from '../src/elitebridge-tokens.mjs';
const src=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const NOW=Date.parse('2026-10-15T12:00:00Z');
const obs=()=>({
 source:'mt5-python-terminal',accountType:'demo',
 terminalConnectedClaim:true,terminalTradeAllowedClaim:false,
 symbol:'XAUUSDm',bid:4200.125,ask:4200.375,
 observedAt:NOW-800,collectedAt:NOW,
 brokerVerified:false,ordersEnabled:false
});
test('portable companion remains local read-only and separated from status API tokens',()=>{
 const launch=src('../scripts/elitebridge-windows-demo-probe.ps1');
 const mt5=src('../companion/mt5_readonly_probe.py');
 const script=src('../scripts/elitebridge-mt5-probe.mjs');
 const pkg=JSON.parse(src('../package.json'));
 assert.equal(ELITEBRIDGE_TOKEN_SCOPE,'bridge:status');
 assert.equal(pkg.scripts['bridge:mt5:local'],'node scripts/elitebridge-mt5-probe.mjs');
 assert.equal(pkg.scripts['bridge:sandbox'],'node scripts/elitebridge-sandbox.mjs');
 assert.match(launch,/Read-Host 'Expected MT5 DEMO account login/);
 assert.match(launch,/Read-Host 'Expected broker server name/);
 assert.match(launch,/\[guid\]::NewGuid\(\)/);
 assert.match(launch,/SetEnvironmentVariable\(\$name,\$null,'Process'\)/);
 assert.match(script,/NETWORK REQUESTS: 0 \| ORDERS: 0/);
 assert.match(script,/createSandboxKeys\(\)/);
 assert.doesNotMatch(launch,/MetaApi\.cloud|https?:\/\/|Invoke-RestMethod|Invoke-WebRequest|order_send\(/i);
 assert.doesNotMatch(mt5,/^\s*mt5\.(?:order_send|login|order_check)\(/m);
 assert.doesNotMatch(script,/fetch\(|https\.request|http\.request|order_send\(/);
});
test('REAL claim, fake broker verification and compromised packet identity fail closed',async()=>{
 const k=createSandboxKeys(),o=obs();
 for(const bad of [{accountType:'real'}, {ordersEnabled:true},
   {brokerVerified:true},{terminalTradeAllowedClaim:true},
   {terminalConnectedClaim:false},{ask:o.bid-.01},{bid:NaN},
   {observedAt:NOW-300000},{collectedAt:NOW+50000}]) {
   assert.throws(()=>validateMt5ReadOnlyObservation({...o,...bad},{nowMs:NOW}));
 }
 const id=randomUUID(),device=randomUUID();
 const signed=await signLocalMt5DemoPackets({
   observation:o,accountId:id,deviceId:device,privateKey:k.privateKey,
   publicKey:k.publicKey,nowMs:NOW
 });
 assert.equal(signed.transmitted,false);
 assert.equal(signed.brokerVerified,false);
 assert.equal(signed.deviceEnrolled,false);
 assert.equal(signed.ordersEnabled,false);
 const s=createSandboxReplayStore();
 const first=await verifyBridgePacket({
   packet:signed.packets[0],publicKey:k.publicKey,
   accountId:id,deviceId:device,role:'terminal',replayStore:s,nowMs:NOW
 });
 assert.equal(first.verified,true);
 assert.equal(first.actionsAllowed,false);
 await assert.rejects(verifyBridgePacket({
   packet:signed.packets[0],publicKey:k.publicKey,
   accountId:id,deviceId:device,role:'terminal',replayStore:s,nowMs:NOW
 }),/replay/);
 await assert.rejects(verifyBridgePacket({
   packet:signed.packets[1],publicKey:k.publicKey,
   accountId:id,deviceId:randomUUID(),role:'terminal',
   replayStore:createSandboxReplayStore(),nowMs:NOW
 }),/identity scope mismatch/);
});
