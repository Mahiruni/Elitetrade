import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseApplication} from '../src/supabase-app.mjs';
import {prepareEliteBridgeAccount} from '../src/elitebridge-account-review.mjs';

test('preparation refuses existing bindings, disabled and inactive owners',()=>{
  for(const account of [{status:'connected'},{status:'pending',gateway_id:'metaapi:existing'}])
    assert.throws(()=>prepareEliteBridgeAccount(account,{active:true}),/provider binding/);
  for(const owner of [null,{active:false},{active:true,disabled:true}])
    assert.throws(()=>prepareEliteBridgeAccount({status:'pending'},owner),/Activate/);
});

async function fixture(t,{role='admin',status='pending',gatewayId=null}={}){
  const calls=[];
  const db={
    authUser:async()=>({id:'operator',factors:[]}),
    one:async(table,filter)=>{
      if(table==='elitetrade_profiles')return {id:'operator',role,active:true,disabled:false};
      if(table==='elitetrade_accounts')return {id:'account',user_id:'owner',status,gateway_id:gatewayId};
      return null;
    },
    rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==='elitetrade_admin_get_account_secret')throw Error('Must not read credentials');
      return null;
    }
  };
  const app=createSupabaseApplication({db,deviceVerification:false,telegram:null,
    gateway:{connect:async()=>{throw Error('Must not provision MetaApi');}},
    env:{APP_ORIGIN:'http://localhost:3000'}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const request=(body,authenticated=true)=>fetch(`http://127.0.0.1:${app.server.address().port}/api/admin/accounts/account/review`,{
    method:'POST',headers:{'Content-Type':'application/json',Origin:'http://localhost:3000',...(authenticated?{Authorization:'Bearer fixture'}:{})},body:JSON.stringify(body)});
  return {request,calls};
}

test('Supabase review prepares EliteBridge without MetaApi, secrets or a connected claim',async t=>{
  const {request,calls}=await fixture(t);
  const res=await request({decision:'elitebridge',note:'Connected'});
  assert.equal(res.status,200);
  const result=await res.json();
  assert.equal(result.provider,'elitebridge');assert.equal(result.status,'pending');
  assert.equal(result.connected,false);assert.equal(result.brokerVerified,false);
  assert.equal(result.ordersEnabled,false);assert.equal(result.nextPath,'/elitebridge');
  assert.deepEqual(calls.map(x=>x.name),['elitetrade_admin_update_account','elitetrade_audit']);
  assert.equal(calls[0].args.p_gateway_id,null);
  assert.equal(calls[0].args.p_status,'pending');
  assert.match(calls[0].args.p_note,/not yet available/);
});

test('review cannot replace a pending MetaApi binding',async t=>{
  const {request,calls}=await fixture(t,{gatewayId:'metaapi:pending'});
  assert.equal((await request({decision:'elitebridge'})).status,409);
  assert.equal(calls.length,0);
});

test('review is admin-only and requires authentication',async t=>{
  const {request,calls}=await fixture(t,{role:'user'});
  assert.equal((await request({decision:'elitebridge'},false)).status,401);
  assert.equal((await request({decision:'elitebridge'})).status,403);
  assert.equal(calls.length,0);
});
