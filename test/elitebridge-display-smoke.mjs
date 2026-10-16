// Run only inside the private xvfb-run session. This is a REAL Linux display
// check, not MT5/Wine/broker evidence, and never inspects the Xauthority cookie.
import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createConnection} from 'node:net';

const display=process.env.DISPLAY,authority=process.env.XAUTHORITY;
assert.match(display||'',/^:\d+$/,'Private local X display is required');
assert.ok(authority,'Private Xauthority file is required');
const info=lstatSync(authority);
assert.equal(info.isFile(),true);assert.equal(info.isSymbolicLink(),false);
assert.equal(info.mode&0o077,0,'Xauthority file must not be accessible to group/others');
const success=spawnSync('/usr/bin/xdpyinfo',[],{env:process.env,stdio:'ignore',timeout:5000});
assert.equal(success.status,0,'Authenticated private display connection failed');
const denied=spawnSync('/usr/bin/xdpyinfo',[],{
  env:{...process.env,XAUTHORITY:'/nonexistent-elitebridge-xauthority',HOME:'/nonexistent-elitebridge-home'},
  stdio:'ignore',timeout:5000});
assert.notEqual(denied.status,0,'Display accepted an unauthenticated X client');
const port=6000+Number(display.slice(1));
assert.ok(port<65536,'Unexpected X display port');
const tcpOpen=await new Promise(resolve=>{
  const socket=createConnection({host:'127.0.0.1',port});
  const finish=value=>{socket.destroy();resolve(value);};
  socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));
  socket.setTimeout(2000,()=>finish(false));
});
assert.equal(tcpOpen,false,'X display is listening on a TCP port');
console.log('PASS: private X display accepts its authorized client, rejects missing authentication and exposes no TCP listener. No MT5 or broker session tested.');
