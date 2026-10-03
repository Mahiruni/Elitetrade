import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createSupabaseApplication} from '../src/supabase-app.mjs';

// A real HTTP provider boundary: no email is sent and no production user is created.
async function fixture(t) {
  const calls=[], sessions=new Map(), trust=new Map();
  const user={id:'a2bf09e5-1015-4ef2-ae18-e83976df7b2d',email:'member@example.invalid',factors:[]};
  const other={id:'d9d408fa-318a-4797-b305-00df51ab7f3e',email:'other@example.invalid',factors:[]};
  const issue=(person=user,proof=false,aal='aal1')=>{
    const payload={sub:person.id,session_id:crypto.randomUUID(),aal};
    const token=`fixture.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
    const session={access_token:token,refresh_token:'fixture-refresh',user:person};
    sessions.set(token,{person,proof,aal,session});return session;
  };
  const control={status:null,emailError:false,verifyUser:null};
  const provider=createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    const url=new URL(req.url,'http://provider.invalid'),body=raw?JSON.parse(raw):null;
    const token=(req.headers.authorization||'').replace(/^Bearer /,''),signed=sessions.get(token);
    calls.push({path:url.pathname,query:url.searchParams,body,token,device:req.headers['x-elite-device']});
    const reply=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    if(url.pathname==='/auth/v1/user')return signed?reply(signed.person):reply({message:'Invalid bearer token'},401);
    if(url.pathname==='/auth/v1/otp')return control.emailError?reply({message:'Delivery unavailable'},503):reply({});
    if(url.pathname==='/auth/v1/verify'){
      if(body.token!=='12345678')return reply({message:'Expired code'},400);
      return reply(issue(control.verifyUser||user,true));
    }
    if(!signed)return reply({message:'Authentication required'},401);
    if(url.pathname==='/rest/v1/elitetrade_profiles')return reply([{id:signed.person.id,email:signed.person.email,full_name:'Member',role:'user',active:true,disabled:false}]);
    if(url.pathname==='/rest/v1/rpc/elitetrade_browser_status'){
      if(control.status)return reply(control.status);
      const device=req.headers['x-elite-device'];
      await new Promise(resolve=>setTimeout(resolve,signed.person.id===user.id?8:1));
      const remembered=trust.get(signed.person.id)?.has(device);
      if(!remembered&&!signed.proof)return reply({verified:false,needsEmail:true});
      if(signed.person.factors.length&&signed.aal!=='aal2')return reply({verified:false,needsEmail:false});
      if(!trust.has(signed.person.id))trust.set(signed.person.id,new Set());
      trust.get(signed.person.id).add(device);return reply({verified:true,needsEmail:false,expiresIn:7776000});
    }
    return reply([]);
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const app=createSupabaseApplication({gateway:null,telegram:null,env:{APP_ORIGIN:'https://elitetradee.vercel.app',SUPABASE_URL:`http://127.0.0.1:${provider.address().port}`,SUPABASE_PUBLISHABLE_KEY:'fixture-key'}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const call=async(path,{session,body,cookie='',headers={}}={})=>{
    const r=await fetch(`http://127.0.0.1:${app.server.address().port}/api${path}`,{method:body?'POST':'GET',headers:{...(session?{Authorization:`Bearer ${session.access_token}`} : {}),...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
    return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')||''};
  };
  return {calls,call,user,other,issue,trust,control};
}
const cookieValue=result=>result.cookie.split(';')[0];

test('unfamiliar password sessions cannot open member, admin, or paid ebook endpoints',async t=>{
  const f=await fixture(t),session=f.issue();
  assert.deepEqual((await f.call('/me')).data,{user:null,requiresMfa:false});assert.equal(f.calls.length,0);
  const me=await f.call('/me',{session});assert.equal(me.data.user,null);assert.equal(me.data.requiresDeviceVerification,true);assert.equal(me.cookie,'');
  for(const path of ['/accounts','/admin/users','/ebook/download']){
    const r=await f.call(path,{session});assert.equal(r.status,403,path);assert.equal(r.data.code,'browser_verification_required');
  }
  assert.ok(!f.calls.some(c=>c.path.includes('elitetrade_accounts')||c.path.includes('ebook_download')));
});

test('email requests use the authenticated address, safe destinations, and request limits',async t=>{
  const f=await fixture(t),session=f.issue();
  const result=await f.call('/auth/device/email',{session,body:{email:f.other.email,next:'https://evil.invalid/'}});assert.equal(result.status,200);
  const delivery=f.calls.find(c=>c.path==='/auth/v1/otp');assert.deepEqual(delivery.body,{email:f.user.email,create_user:false});
  assert.equal(delivery.query.get('redirect_to'),'https://elitetradee.vercel.app/login?intent=device&next=%2Fmt5');
  assert.equal(delivery.device,undefined);
  assert.equal((await f.call('/auth/device/email',{session,body:{}})).status,429);
  assert.equal((await f.call('/auth/device/email',{session,body:{},headers:{Origin:'https://evil.invalid'}})).status,403);
  const other=f.issue(f.other);assert.equal((await f.call('/auth/device/email',{session:other,body:{next:'/ebook'}})).status,200);
  assert.match(f.calls.filter(c=>c.path==='/auth/v1/otp')[1].query.get('redirect_to'),/next=%2Febook$/);
});

test('codes must be valid and matched to the signed-in account',async t=>{
  const f=await fixture(t),session=f.issue();
  assert.equal((await f.call('/config')).data.deviceCodeLength,8);
  assert.equal((await f.call('/auth/device/verify',{session,body:{code:'12'}})).status,400);
  assert.equal((await f.call('/auth/device/verify',{session,body:{code:'123456'}})).status,400);
  assert.equal((await f.call('/auth/device/verify',{session,body:{code:'123456789'}})).status,400);
  assert.equal(f.calls.filter(c=>c.path==='/auth/v1/verify').length,0);
  assert.equal((await f.call('/auth/device/verify',{session,body:{code:'00000000'}})).status,400);
  f.control.verifyUser=f.other;assert.equal((await f.call('/auth/device/verify',{session,body:{code:'12345678'}})).status,400);
  f.control.verifyUser=null;const result=await f.call('/auth/device/verify',{session,body:{code:'12345678',email:f.other.email}});
  assert.equal(result.status,200);assert.equal(result.data.session.user.id,f.user.id);
  assert.deepEqual(f.calls.filter(c=>c.path==='/auth/v1/verify').at(-1).body,{email:f.user.email,token:'12345678',type:'email'});
  const verified=await f.call('/me',{session:result.data.session});assert.equal(verified.data.user.id,f.user.id);
  assert.match(verified.cookie,/^__Host-elite_device=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=7776000; Secure$/);
});

test('remembered browsers open directly, but client device headers and other users cannot reuse approval',async t=>{
  const f=await fixture(t),proof=await f.call('/me',{session:f.issue(f.user,true)}),cookie=cookieValue(proof);
  const session=f.issue();assert.equal((await f.call('/me',{session,cookie})).data.user.id,f.user.id);
  assert.equal((await f.call('/accounts',{session,cookie})).status,200);
  assert.equal((await f.call('/me',{session})).data.requiresDeviceVerification,true);
  const forged=await f.call('/me',{session,headers:{'X-Elite-Device':cookie.split('=')[1]}});assert.equal(forged.data.requiresDeviceVerification,true);
  assert.notEqual(f.calls.filter(c=>c.path.endsWith('browser_status')).at(-1).device,cookie.split('=')[1]);
  assert.equal((await f.call('/me',{session:f.issue(f.other),cookie})).data.requiresDeviceVerification,true);
  f.trust.clear();assert.equal((await f.call('/accounts',{session,cookie})).status,403);
  assert.ok(f.calls.filter(c=>c.path.startsWith('/auth/v1/')).every(c=>c.device===undefined));
});

test('email verification preserves MFA and installs no remembered browser before MFA succeeds',async t=>{
  const f=await fixture(t);f.user.factors=[{status:'verified',factor_type:'totp'}];
  const first=await f.call('/me',{session:f.issue()});assert.equal(first.data.requiresMfa,true);assert.equal(first.data.requiresDeviceVerification,true);
  const email=await f.call('/me',{session:f.issue(f.user,true)});assert.equal(email.data.user,null);assert.equal(email.data.requiresDeviceVerification,false);assert.equal(email.data.requiresMfa,true);assert.equal(email.cookie,'');
  assert.equal((await f.call('/accounts',{session:f.issue(f.user,true)})).status,401);
  const complete=await f.call('/me',{session:f.issue(f.user,true,'aal2')});assert.equal(complete.data.user.id,f.user.id);assert.ok(complete.cookie);
});

test('rollout configuration bypasses only the pending browser check and writes no trust cookie',async t=>{
  const f=await fixture(t);f.control.status={verified:true,needsEmail:false,enforced:false};
  const me=await f.call('/me',{session:f.issue()});assert.equal(me.data.user.id,f.user.id);assert.equal(me.cookie,'');
  f.user.factors=[{status:'verified'}];assert.equal((await f.call('/me',{session:f.issue()})).data.user,null);
});

test('malformed verification state fails closed and delivery failure stays actionable',async t=>{
  const f=await fixture(t),session=f.issue();f.control.status={verified:'yes',needsEmail:false};
  assert.equal((await f.call('/accounts',{session})).status,503);
  f.control.status=null;f.control.emailError=true;
  assert.equal((await f.call('/auth/device/email',{session,body:{}})).status,503);
  assert.equal((await f.call('/accounts',{session:{access_token:'unissued-token'}})).status,401);
});

test('concurrent users keep separate browser secrets through asynchronous provider requests',async t=>{
  const f=await fixture(t),a='A'.repeat(43),b='B'.repeat(43);
  f.trust.set(f.user.id,new Set([a]));f.trust.set(f.other.id,new Set([b]));
  const [one,two]=await Promise.all([f.call('/accounts',{session:f.issue(),cookie:`__Host-elite_device=${a}`}),f.call('/accounts',{session:f.issue(f.other),cookie:`__Host-elite_device=${b}`})]);
  assert.equal(one.status,200);assert.equal(two.status,200);
  const tokens=new Map(f.calls.filter(c=>c.path==='/auth/v1/user').map(c=>[c.token,c.token.split('.')[1]]));
  for(const c of f.calls.filter(c=>c.path.startsWith('/rest/v1/'))){
    const id=JSON.parse(Buffer.from(tokens.get(c.token),'base64url').toString()).sub;
    assert.equal(c.device,id===f.user.id?a:b);
  }
});
