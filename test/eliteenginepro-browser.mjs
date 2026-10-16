// Synthetic UI verification only; no live broker or execution evidence.
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require('playwright'));}
catch{({chromium}=require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`));}
const fixture=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/elitebridge.css"><style>
body{margin:0;padding:18px;background:#000;color:#f4f5f7;font:14px system-ui;--text:#f4f5f7;--panel:#111317;--muted:#adb0bb;--border:#343638}body.light{background:#f6f7fa;--text:#17191e;--panel:#fff;--muted:#555e6c;--border:#d4d7de}button{font:inherit}</style></head><body><main></main><script type="module">
import {createEliteEngineProWorkspace} from '/eliteenginepro.js';
const f=window.engineFixture={fail:false,stopFail:false,killed:false,delay:false,pending:[],calls:[]};
const api=async(...args)=>{
f.calls.push(args);if(f.delay)await new Promise(resolve=>f.pending.push(resolve));
if(f.fail)throw Error('Synthetic outage');
if(args[0].startsWith('/engine/pro/accounts/')){
 if(args[1]==='POST'){if(f.stopFail)throw Error('Synthetic stop outage');f.killed=true;}
 return {killSwitch:f.killed,unresolvedCount:1,intents:[{id:'fixture-unknown',state:'unknown'}]};
}
return {checkedAt:new Date().toISOString(),accounts:{registered:4,pending:3,items:[{id:'11111111-2222-4333-8444-555555555555',broker:'Exness',server:'Exness-MT5Trial9'}]},
independent:{gatewayConfigured:false,blocker:'An authenticated MT5 runtime and durable execution adapter still require commissioning.'},
legacy:{provider:'metaapi',heartbeat:'fresh',mobileEnabled:true},controls:{canManageNativeDemo:true}};
};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const ui=createEliteEngineProWorkspace({api,esc,state:{user:{id:'fixture-owner'}}});
f.ui=ui;document.querySelector('main').innerHTML=await ui.page();ui.mount();f.ready=true;
</script></body></html>`;
const server=createServer((req,res)=>{
  if(['/eliteenginepro.js','/elitebridge.css'].includes(req.url)){
    res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');
    res.end(readFileSync(new URL('../public'+req.url,import.meta.url)));return;
  }
  res.setHeader('Content-Type','text/html');res.end(fixture);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],
  ...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
mkdirSync('test-results',{recursive:true});
try{
  await page.goto('http://127.0.0.1:'+server.address().port+'/eliteenginepro');
  await page.waitForFunction(()=>window.engineFixture?.ready===true);
  await page.clock.install();
  await page.getByRole('heading',{name:'EliteEnginePro'}).waitFor();
  assert.match(await page.locator('main').innerText(),/Independent execution blocked/);
  assert.ok((await page.evaluate(()=>window.engineFixture.calls)).every(args=>args.length===1),'Passive checks never write');
  await page.evaluate(()=>{window.engineFixture.stopFail=true;});
  await page.getByRole('button',{name:'Stop independent engine',exact:true}).click();
  await page.getByText('Stop was not confirmed. Retry and verify the saved state.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.engineFixture.killed),false);
  await page.evaluate(()=>{window.engineFixture.stopFail=false;});
  await page.getByRole('button',{name:'Stop independent engine',exact:true}).click();
  await page.getByText('Stop confirmed and saved. Existing positions remain open.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.engineFixture.killed),true);
  assert.equal((await page.evaluate(()=>window.engineFixture.calls)).filter(args=>args[1]==='POST').length,2);
  await page.evaluate(()=>{window.engineFixture.fail=true;});
  await page.getByRole('button',{name:'Refresh status'}).click();
  await page.getByText('Status unavailable',{exact:false}).waitFor();
  await page.evaluate(()=>{window.engineFixture.fail=false;window.dispatchEvent(new Event('online'));});
  await page.getByText('Status checked',{exact:false}).waitFor();
  const count=await page.evaluate(()=>window.engineFixture.calls.length);
  await page.clock.runFor(15001);
  await page.waitForFunction(n=>window.engineFixture.calls.length===n+2,count);
  assert.ok((await page.evaluate(()=>window.engineFixture.calls)).every(args=>args.length===1||args[0].endsWith('/stop')&&args[1]==='POST'));
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const theme of ['dark','light']){
      await page.evaluate(t=>document.body.classList.toggle('light',t==='light'),theme);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Overflow '+width+' '+theme);
      if(theme==='dark'&&[390,1440].includes(width))await page.screenshot({path:'test-results/eliteenginepro-'+width+'.png',fullPage:true});
    }
  }
  // A response received after navigation must never replace another workspace.
  await page.evaluate(()=>{window.engineFixture.delay=true;});
  await page.getByRole('button',{name:'Refresh status'}).click();
  await page.waitForFunction(()=>window.engineFixture.pending.length===1);
  await page.evaluate(()=>{
    const f=window.engineFixture;f.ui.dispose();f.delay=false;history.pushState({},'','/bots');
    document.querySelector('main').textContent='Other workspace';f.pending.splice(0).forEach(r=>r());
  });
  await page.clock.runFor(30001);
  assert.equal(await page.locator('main').innerText(),'Other workspace');
  assert.deepEqual(errors,[]);
  console.log('EliteEnginePro synthetic browser checks passed: explicit stop, unconfirmed stop, refresh, outage, recovery, navigation, 4 widths and 2 themes.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
