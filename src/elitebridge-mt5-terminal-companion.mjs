// Phase 7: turn Windows official MT5 Python observations into EliteBridge v3
// Ed25519 DEMO packets. LOCAL bridge lab only; no enrolled key or HTTP sender.
// The local ephemeral key deliberately cannot authorize server enrollment.
import {signBridgePacket,verifyBridgePacket,createSandboxReplayStore} from './elitebridge-protocol.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYMBOL=/^[A-Za-z0-9._-]{3,30}$/;
const allowed=['source','accountType','terminalConnectedClaim','terminalTradeAllowedClaim',
  'symbol','bid','ask','observedAt','collectedAt','brokerVerified','ordersEnabled'];
const invalid=x=>{throw new Error('EliteBridge MT5 companion: '+x)};
const exact=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
  Object.keys(o).length===allowed.length&&allowed.every(x=>Object.hasOwn(o,x));

export function validateMt5ReadOnlyObservation(o,{nowMs=Date.now()}={}){
  if(!exact(o)||o.source!=='mt5-python-terminal'||o.accountType!=='demo'||
     o.terminalConnectedClaim!==true||o.terminalTradeAllowedClaim!==false||
     o.brokerVerified!==false||o.ordersEnabled!==false)
    invalid('MT5 DEMO-only read-only observation required');
  if(typeof o.symbol!=='string'||!SYMBOL.test(o.symbol))invalid('invalid MT5 symbol');
  if(typeof o.bid!=='number'||typeof o.ask!=='number'||
     !Number.isFinite(o.bid)||!Number.isFinite(o.ask)||
     o.bid<0.00000001||o.ask<o.bid||o.ask>100000000)
    invalid('invalid quote');
  if(!Number.isSafeInteger(nowMs)||!Number.isSafeInteger(o.observedAt)||
     !Number.isSafeInteger(o.collectedAt)||
     o.collectedAt>nowMs+30000||o.collectedAt<nowMs-120000||
     o.observedAt>nowMs+30000||o.observedAt<nowMs-180000)
    invalid('stale or future quote');
  return Object.freeze({
    accountType:'demo',symbol:o.symbol,bid:o.bid,ask:o.ask,
    observedAt:o.observedAt,collectedAt:o.collectedAt
  });
}

export async function signLocalMt5DemoPackets({
  observation,accountId,deviceId,privateKey,publicKey,nowMs=Date.now()
}={}){
  if(!UUID.test(accountId||'')||!UUID.test(deviceId||''))
    invalid('valid local account and device scope required');
  if(!privateKey||!publicKey)invalid('ephemeral signer keys required');
  const o=validateMt5ReadOnlyObservation(observation,{nowMs});
  const common={privateKey,accountId,deviceId,issuedAt:nowMs,
    expiresAt:nowMs+60000};
  // Packet sequence numbers are for this ONE local demonstration only.
  // Production will require a persistent, server-enrolled device identity
  // and durable monotonic sequence reservation before any transmission.
  const packets=[
    signBridgePacket({...common,kind:'terminal.heartbeat',sequence:1,
      payload:{accountType:'demo',connected:true,tradeAllowed:false}}),
    signBridgePacket({...common,kind:'terminal.quote',sequence:2,
      payload:{accountType:'demo',symbol:o.symbol,bid:o.bid,ask:o.ask,
        observedAt:o.observedAt}})
  ];
  const replayStore=createSandboxReplayStore();
  for(const packet of packets){
    const proof=await verifyBridgePacket({packet,publicKey,accountId,deviceId,
      role:'terminal',nowMs,replayStore});
    if(proof.brokerVerified||proof.actionsAllowed||!proof.demoOnly)
      invalid('unexpected broker authority');
  }
  return {packets,readOnly:true,demoOnly:true,brokerVerified:false,
    ordersEnabled:false,transmitted:false,deviceEnrolled:false};
}
