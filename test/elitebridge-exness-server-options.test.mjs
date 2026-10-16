import test from 'node:test';
import assert from 'node:assert/strict';
import {EXNESS_MT5_SERVER_OPTIONS,listMt5ServerOptions,resolveMt5ServerProfile} from '../src/elitebridge-broker-server-profiles.mjs';
test('lists exactly 20 Exness demo and 20 real options',()=>{
 assert.equal(EXNESS_MT5_SERVER_OPTIONS.length,40);
 assert.equal(listMt5ServerOptions('Exness','demo').length,20);
 assert.equal(listMt5ServerOptions('Exness','real').length,20);
 assert.equal(EXNESS_MT5_SERVER_OPTIONS[0].server,'Exness-MT5Trial1');
 assert.equal(EXNESS_MT5_SERVER_OPTIONS[19].server,'Exness-MT5Trial20');
 assert.equal(EXNESS_MT5_SERVER_OPTIONS[20].server,'Exness-MT5Real1');
 assert.equal(EXNESS_MT5_SERVER_OPTIONS[39].server,'Exness-MT5Real20');
});
test('labels and demo flags match mode',()=>{
 for(const option of EXNESS_MT5_SERVER_OPTIONS){
  assert.equal(option.isDemo,option.mode==='demo');
  assert.match(option.label,option.isDemo?/Demo$/:/Real$/);
  assert.equal(resolveMt5ServerProfile({broker:'Exness',mode:option.mode,server:option.server}).server,option.server);
 }
});
test('rejects Exness demo and real mode confusion',()=>{
 assert.throws(()=>resolveMt5ServerProfile({broker:'Exness',mode:'real',server:'Exness-MT5Trial10'}),/does not match/);
});
