import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createSandboxKeys,signBridgePacket} from '../src/elitebridge-protocol.mjs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

const ownerId=randomUUID(),otherId=randomUUID(),accountId=randomUUID(),deviceId=randomUUID();
const keys=createSandboxKeys();
const publicKeySpki=keys.publicKey.export({format:'der',type:'spki'}).toString('base64url');
const now=Date.now();
const makeToken=(scope,aal='aal2')=>
  'eyJhbGciOiJub25lIn0.'+
  Buffer.from(JSON.stringify({aal})).toString('base64url')+'.'+scope;
const tokens={
  owner:makeToken('owner'),other:makeToken('other'),
  noMfa:makeToken('noMfa'),aal1:makeToken('aal1','aal1')
};
function packet(sequence=1,overrides={}){
  return signBridgePacket({
    privateKey:keys.privateKey,kind:'terminal.heartbeat',accountId,deviceId,
    sequence,issuedAt:now,expiresAt:now+60000,
    payload:{accountType:'demo',connected:true,tradeAllowed:false},
    ...overrides
  });
}
async function fixture(t,{enabled=true}={}){
  const state={approved:true,sequence:0,seen:new Set(),calls:[],brokerCalls:0};
  const identities={
    [tokens.owner]:{id:ownerId,mfa:true},
    [tokens.other]:{id:otherId,mfa:true},
    [tokens.noMfa]:{id:ownerId,mfa:false},
    [tokens.aal1]:{id:ownerId,mfa:true}
  };
  const db={
    async authUser(token){const identity=identities[token];
      if(!identity)throw Error('unauthorized');
      return {id:identity.id,email:'test@example.com',
        factors:identity.mfa?[{status:'verified'}]:[]};
    },
    async one(table,query,token){
      if(table==='elitetrade_profiles'){
        const identity=identities[token];
        return identity?{id:identity.id,email:'test@example.com',role:'user',
          active:true,disabled:false}:null;
      }
      if(table==='elitetrade_accounts'&&query.includes('id=eq.'+accountId)&&
        query.includes('user_id=eq.'+ownerId)&&identities[token]?.id===ownerId)
        return {id:accountId};
      return null;
    },
    async rpc(){throw Error('Unprivileged RPC must never be used');}
  };
  const bridgeDb={async rpc(name,args){
    state.calls.push(name);
    if(name==='elitetrade_bridge_key'){
      return state.approved&&args.p_owner_id===ownerId&&args.p_account_id===accountId&&
        args.p_device_id===deviceId?publicKeySpki:null;
    }
    if(name==='elitetrade_bridge_claim'){
      if(!state.approved||args.p_owner_id!==ownerId||args.p_account_id!==accountId||
        args.p_device_id!==deviceId||args.p_sequence<=state.sequence||
        state.seen.has(args.p_message_id))return false;
      state.sequence=args.p_sequence;state.seen.add(args.p_message_id);return true;
    }
    throw Error('Unexpected privileged RPC: '+name);
  }};
  const app=createSupabaseApplication({db,bridgeDb,
    gateway:{mode:'account-data',async market(){state.brokerCalls++;throw Error('Never call market')},
      async demoOrder(){state.brokerCalls++;throw Error('Never call demoOrder')}},
    telegram:null,deviceVerification:false,
    env:{APP_ORIGIN:'http://localhost:3000',
      ELITEBRIDGE_TELEMETRY_ENABLED:enabled?'true':'false'}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  async function request(who='owner',body={packet:packet()},method='POST'){
    const response=await fetch('http://127.0.0.1:'+app.server.address().port+
      '/api/elitebridge/telemetry',{
        method,
        headers:{...(who?{Authorization:'Bearer '+tokens[who]}:{}),
          ...(method==='POST'?{'Content-Type':'application/json'}:{})},
        ...(method==='POST'?{body:JSON.stringify(body)}:{})
      });
    return {status:response.status,body:await response.json(),headers:response.headers};
  }
  return {request,state};
}
test('telemetry cannot be submitted when opt-in flag is absent',async t=>{
 const f=await fixture(t,{enabled:false});
 assert.equal((await f.request()).status,503);
 assert.equal(f.state.calls.length,0);
});
test('only owner with completed MFA can reach the private Supabase verifier',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('')).status,401);
 assert.equal((await f.request('noMfa')).status,403);
 assert.equal((await f.request('aal1')).status,401);
 assert.equal((await f.request('other')).status,404);
 assert.equal(f.state.calls.length,0);
});
test('approved Ed25519 DEMO heartbeat is claimed atomically and returns no broker authorization',async t=>{
 const f=await fixture(t);
 const sent=packet(1);
 const out=await f.request('owner',{packet:sent});
 assert.equal(out.status,200);
 assert.deepEqual(out.body,{accepted:true,kind:'terminal.heartbeat',sequence:1,
   messageId:sent.messageId,demoOnly:true,brokerVerified:false,
   independentMT5Connected:false,ordersEnabled:false});
 assert.equal(out.headers.get('cache-control'),'no-store');
 assert.deepEqual(f.state.calls,['elitetrade_bridge_key','elitetrade_bridge_claim']);
 assert.equal(f.state.brokerCalls,0);
});
test('duplicate message replay rejected with HTTP 409 and never calls broker',async t=>{
 const f=await fixture(t),sent=packet(1);
 assert.equal((await f.request('owner',{packet:sent})).status,200);
 assert.equal((await f.request('owner',{packet:sent})).status,409);
 assert.equal(f.state.calls.filter(x=>x==='elitetrade_bridge_claim').length,2);
 assert.equal(f.state.brokerCalls,0);
});
test('wrong key, revoked key, and stale payload fail closed without accepting a claim',async t=>{
 const f=await fixture(t),sent=packet(1);
 assert.equal((await f.request('owner',{packet:{...sent,
   payload:{...sent.payload,connected:false}}})).status,403);
 assert.equal(f.state.calls.filter(x=>x==='elitetrade_bridge_claim').length,0);
 f.state.approved=false;
 assert.equal((await f.request('owner',{packet:sent})).status,403);
 f.state.approved=true;
 const stale=packet(2,{issuedAt:now-240000,expiresAt:now-180000});
 assert.equal((await f.request('owner',{packet:stale})).status,400);
 assert.equal(f.state.calls.filter(x=>x==='elitetrade_bridge_claim').length,0);
});
test('REAL account claims and arbitrary payloads never reach privileged DB',async t=>{
 const f=await fixture(t),sent=packet(1);
 assert.equal((await f.request('owner',{packet:{...sent,
   payload:{...sent.payload,accountType:'real'}}})).status,400);
 assert.equal((await f.request('owner',{packet:{...sent,kind:'terminal.order'}})).status,400);
 assert.equal((await f.request('owner',{packet:sent,extra:true})).status,400);
 assert.equal((await f.request('owner',{packet:{...sent,accountId:randomUUID()}})).status,404);
 assert.equal(f.state.calls.length,0);
});
test('GET and oversized signed packets are rejected before privileged SQL',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('owner',undefined,'GET')).status,405);
 assert.equal((await f.request('owner',{packet:{...packet(),surplus:'a'.repeat(5000)}})).status,400);
 assert.equal(f.state.calls.length,0);
});
test('no provider, execution or private-key operations are introduced in the ingestion route',()=>{
 const app=readFileSync(new URL('../src/supabase-app.mjs',import.meta.url),'utf8');
 const module=readFileSync(new URL('../src/elitebridge-supabase-telemetry.mjs',import.meta.url),'utf8');
 const api=app.slice(app.indexOf("if (path==='/api/elitebridge/telemetry')"),
   app.indexOf('    // Phase 4.1 enrollment'));
 assert.match(api,/needUser\(req\)/);
 assert.match(api,/ctx\.user\.mfaEnabled/);
 assert.match(api,/user_id=eq\./);
 assert.match(app,/ELITEBRIDGE_TELEMETRY_ENABLED/);
 assert.match(module,/createEliteBridgeRegistry/);
 assert.doesNotMatch(api,/demoOrder\(|\.market\(|market\(|OrderSend\(/);
 assert.doesNotMatch(module,/fetch\(|secret_key|SUPABASE_SERVICE_ROLE_KEY|OrderSend\(/);
});
