import test from 'node:test';
import assert from 'node:assert/strict';
import {runJsonSubprocess} from '../src/json-subprocess.mjs';
const options={executable:process.execPath,env:{PATH:process.env.PATH},timeoutMs:1500};
test('SDK success does not wait for an inherited stdout pipe retained by a descendant',async()=>{
  const code=`const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},4000)'],{stdio:['ignore',1,'ignore']}).unref();console.log(JSON.stringify({ok:true}));`;
  const at=Date.now();
  const result=await runJsonSubprocess({...options,args:['-e',code]});
  assert.deepEqual(result,{ok:true});assert.ok(Date.now()-at<3000,'Waited for descendant pipe closure');
});
test('SDK timeout settles promptly even when a descendant retains its stdout pipe',async()=>{
  const code=`const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},4000)'],{stdio:['ignore',1,'ignore']}).unref();setTimeout(()=>{},10000);`;
  const at=Date.now();
  await assert.rejects(runJsonSubprocess({...options,timeoutMs:150,args:['-e',code]}),e=>e.code==='SDK_TIMEOUT');
  assert.ok(Date.now()-at<3000,'Deadline waited for descendant pipe closure');
});
test('JSON subprocess still rejects successful-looking output from a failed process',async()=>{
  await assert.rejects(runJsonSubprocess({...options,args:['-e','console.log("{}");process.exitCode=7']}),e=>e.code==='SDK_COLLECTION_FAILED');
});
