import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
import {mintEliteBridgeToken,eliteBridgeTokenDigest,extractEliteBridgeToken,ELITEBRIDGE_TOKEN_SCOPE} from '../src/elitebridge-tokens.mjs';

const owner='11111111-2222-4333-8444-555555555555';
const other='99999999-2222-4333-8444-555555555555';
const id='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const jwt=(user,aal='aal2')=>'header.'+Buffer.from(JSON.stringify({sub:user,aal})).toString('base64url')+'.sig';
async function fixture(t,{enabled=true,role='admin',mfa=true,device=true}={}){
 const tokens=new Map(); let trade=0; let calls=0;
 const db={
  authUser:async token=>{
   const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
   if(![owner,other].includes(claims.sub))throw Error('invalid user');
   return {id:claims.sub,email:'owner@example.com',factors:mfa?[{status:'verified'}]:[]};
  },
  one:async(name,query)=>{
   if(name==='elitetrade_profiles')return {id:query.includes(owner)?owner:other,role,disabled:false,active:true};
   return null;
  },
  rpc:async(name,args,token)=>{
   calls++;
   const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
   assert.equal(claims.aal,'aal2');
   if(name==='elitetrade_bridge_token_issue'){
    assert.match(args.p_hash,/^[a-f0-9]{64}$/);
    tokens.set(args.p_hash,{id,user:claims.sub,label:args.p_label,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+args.p_expires_hours*3600000).toISOString(),revoked_at:null});
    return id;
   }
   if(name==='elitetrade_bridge_token_list')
     return [...tokens.values()].filter(x=>x.user===claims.sub).map(x=>({id:x.id,label:x.label,scope:ELITEBRIDGE_TOKEN_SCOPE,created_at:x.created_at,expires_at:x.expires_at,revoked_at:x.revoked_at}));
   if(name==='elitetrade_bridge_token_revoke'){
     for(const row of tokens.values()){
      if(row.id===args.p_id && row.user===claims.sub && !row.revoked_at){row.revoked_at=new Date().toISOString();return true;}
     }return false;
   }
   throw Error('Unexpected RPC '+name);
  }
 };
 const bridgeTokenDb={rpc:async(name,args)=>{
   assert.equal(name,'elitetrade_bridge_token_verify');
   const row=tokens.get(args.p_hash);
   return row&&!row.revoked_at && Date.parse(row.expires_at)>Date.now()?[{owner_id:row.user,scope:ELITEBRIDGE_TOKEN_SCOPE}]:[];
 }};
 const gateway={mode:'account-data',demoOrder:async()=>{trade++;throw Error('never call MT5 order');},market:async()=>{throw Error('no market calls')}};
 const app=createSupabaseApplication({db,bridgeTokenDb,gateway,telegram:null,deviceVerification:device,
   env:{APP_ORIGIN:'http://localhost:3000',ELITEBRIDGE_TOKENS_ENABLED:enabled?'true':'false'}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
 t.after(()=>app.close());
 const base='http://127.0.0.1:'+app.server.address().port;
 const request=async(method,path,{authorization='',body}={})=>{
  const res=await fetch(base+path,{method,headers:{
   ...(authorization?{Authorization:authorization}:{}),
   ...(body!==undefined?{'Content-Type':'application/json'}:{})
  },body:body===undefined?undefined:JSON.stringify(body)});
  return {status:res.status,headers:res.headers,data:await res.json()};
 };
 return {request,tokens,get trade(){return trade},get calls(){return calls}};
}
test('generates unpredictable 256-bit tokens, only stores SHA-256 hashes',()=>{
 const a=mintEliteBridgeToken(),b=mintEliteBridgeToken();
 assert.notEqual(a,b);assert.match(a,/^ebd_[a-zA-Z0-9_-]{43}$/);
 assert.equal(extractEliteBridgeToken('EliteBridge '+a),a);
 assert.equal(extractEliteBridgeToken('Bearer '+a),null);
 assert.equal(extractEliteBridgeToken('EliteBridge '+a+'x'),null);
 assert.match(eliteBridgeTokenDigest(a),/^[0-9a-f]{64}$/);
 assert.notEqual(eliteBridgeTokenDigest(a),eliteBridgeTokenDigest(b));
 assert.throws(()=>eliteBridgeTokenDigest('metaapi-external-key'),/Invalid/);
});
test('token API is OFF by default and never accepts anonymous creation',async t=>{
 const f=await fixture(t,{enabled:false});
 assert.equal((await f.request('POST','/api/elitebridge/tokens',{authorization:'Bearer '+jwt(owner),body:{label:'MY-KEY'}})).status,404);
 assert.equal((await f.request('GET','/api/elitebridge/token/status',{authorization:'EliteBridge '+mintEliteBridgeToken()})).status,503);
 assert.equal(f.trade,0);
});
test('issuance requires authenticated administrator and verified MFA',async t=>{
 const f=await fixture(t);
 assert.equal((await f.request('POST','/api/elitebridge/tokens',{body:{label:'Owner key'}})).status,401);
 assert.equal((await f.request('POST','/api/elitebridge/tokens',{authorization:'Bearer '+jwt(owner,'aal1'),body:{label:'Owner key'}})).status,401);
 assert.equal((await f.request('POST','/api/elitebridge/tokens',{authorization:'Bearer '+jwt(owner),body:{label:'!bad'}})).status,400);
 assert.equal(f.tokens.size,0);
 const user=await fixture(t,{role:'user'});
 assert.equal((await user.request('POST','/api/elitebridge/tokens',{authorization:'Bearer '+jwt(owner),body:{label:'Owner key'}})).status,403);
 const noMfa=await fixture(t,{mfa:false});
 assert.equal((await noMfa.request('POST','/api/elitebridge/tokens',{authorization:'Bearer '+jwt(owner),body:{label:'Owner key'}})).status,403);
});
test('issue once, verify read-only scope, inventory redaction and immediate revoke',async t=>{
 const f=await fixture(t);
 const issue=await f.request('POST','/api/elitebridge/tokens',{authorization:'Bearer '+jwt(owner),body:{label:'Terminal status key',expiresHours:24}});
 assert.equal(issue.status,201);assert.equal(issue.headers.get('cache-control'),'no-store');
 assert.match(issue.data.token,/^ebd_[A-Za-z0-9_-]{43}$/);
 assert.equal(issue.data.showOnce,true);assert.equal(issue.data.ordersEnabled,false);
 assert.equal(f.tokens.size,1);
 const stored=[...f.tokens.keys()][0];
 assert.equal(stored,eliteBridgeTokenDigest(issue.data.token));
 assert.ok(!JSON.stringify([...f.tokens.values()]).includes(issue.data.token));
 const list=await f.request('GET','/api/elitebridge/tokens',{authorization:'Bearer '+jwt(owner)});
 assert.equal(list.status,200);
 assert.equal(list.data.tokens.length,1);
 assert.equal(list.data.tokens[0].label,'Terminal status key');
 assert.ok(!JSON.stringify(list.data).includes(stored));
 assert.ok(!JSON.stringify(list.data).includes(issue.data.token));
 const verify=await f.request('GET','/api/elitebridge/token/status',{authorization:'EliteBridge '+issue.data.token});
 assert.equal(verify.status,200);assert.equal(verify.data.authenticated,true);
 assert.equal(verify.data.brokerVerified,false);assert.equal(verify.data.tradeExecutionEnabled,false);
 assert.equal(verify.data.metaapiFallbackPreserved,true);
 assert.equal(f.trade,0);
 const revoke=await f.request('POST','/api/elitebridge/tokens/revoke',{authorization:'Bearer '+jwt(owner),body:{id}});
 assert.equal(revoke.status,200);assert.equal(revoke.data.revoked,true);
 const denied=await f.request('GET','/api/elitebridge/token/status',{authorization:'EliteBridge '+issue.data.token});
 assert.equal(denied.status,401);
 assert.equal(f.trade,0);
});
test('privileged SQL keeps key hash private and verifies only with service role',()=>{
 const sql=readFileSync(new URL('../supabase/migrations/20261015000600_elitebridge_owned_tokens.sql',import.meta.url),'utf8');
 assert.match(sql,/create table if not exists elitetrade_private\.elitetrade_bridge_api_tokens/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/grant execute on function public\.elitetrade_bridge_token_verify\(text\) to service_role/);
 assert.match(sql,/revoke all on function public\.elitetrade_bridge_token_verify\(text\) from public,anon,authenticated/);
 assert.match(sql,/auth\.jwt\(\)->>'aal'.*'aal2'/);
 assert.match(sql,/t\.expires_at>now\(\)/);
 assert.doesNotMatch(sql,/order_send|demoOrder|METAAPI_TOKEN|delete from public\.elitetrade_bots/i);
});
