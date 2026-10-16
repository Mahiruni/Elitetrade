import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=source.indexOf('  if (location.hash) {',source.indexOf('state.config = await api'));
const end=source.indexOf('\n  await identity();',start);
const flow=source.slice(start,end);
function callback(path,hash){
 const navigation=[],sessions=[],messages=[];
 runInNewContext(flow,{location:{pathname:path,hash,search:''},URLSearchParams,
  history:{replaceState:(_a,_b,value)=>navigation.push(value)},saveAuth:value=>sessions.push(value),
  ebookAuthReturn:()=>'',toast:value=>messages.push(value),setTimeout:fn=>fn()});
 return {navigation,sessions,messages};
}
test('expired signup and recovery links route to fresh-link screens and clear errors',()=>{
 for(const [path,destination] of [['/login','/resend-confirmation'],['/reset-password','/forgot-password']]){
  const result=callback(path,'#error=access_denied&error_code=otp_expired&error_description=Expired');
  assert.deepEqual(result.navigation,[destination]);assert.deepEqual(result.sessions,[]);assert.equal(result.messages.length,1);
 }
});
test('recovery session remains on password-reset page instead of becoming a general sign-in',()=>{
 const result=callback('/login','#access_token=isolated&refresh_token=test&type=recovery');
 assert.equal(result.navigation[0],'/reset-password#access_token=isolated&refresh_token=test&type=recovery');
 assert.deepEqual(result.sessions,[]);
});
test('successful confirmation saves the session and clears token fragments from navigation',()=>{
 const result=callback('/login','#access_token=isolated&refresh_token=test&type=signup');
 assert.deepEqual(result.navigation,['/subscription']);assert.equal(result.sessions[0].access_token,'isolated');
});
