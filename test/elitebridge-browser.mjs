// Isolated UI fixtures, not a broker connection or production enrollment.
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
let chromium;
try{({chromium}=require('playwright'));}
catch{({chromium}=require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`));}
const fixture=`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/elitebridge.css"><style>
body{margin:0;padding:18px;background:#000;color:#f4f5f7;font:14px system-ui;--text:#f4f5f7;--panel:#111317;--surface:#14161b;--muted:#adb0bb;--border:#343638}body.light{background:#f6f7fa;--text:#17191e;--panel:#fff;--surface:#f9fafc;--muted:#555e6c;--border:#d4d7de}.fixture{max-width:1350px;margin:0 auto 20px;font-size:12px;color:#c7a36b}</style></head><body><p class="fixture">SYNTHETIC UI TEST · No MT5 terminal or broker connected</p><main></main><script type="module">
import {createEliteBridgeWorkspace} from '/elitebridge.js';
history.replaceState({},'', '/elitebridge');
const terminal={id:'d26d5735-1058-4e91-9ce1-f727191758ee',label:'Test Windows terminal',account_mode:'demo',status:'pending',proof_verified_at:null,fingerprint:'a'.repeat(64)};
const f=window.bridgeFixture={calls:0,unavailable:false,delay:false,pending:[],state:{user:{id:'fixture-owner',role:'admin'}}};
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const api=async(url,method)=>{
f.calls++;
if(f.delay)await new Promise(resolve=>f.pending.push(resolve));
if(f.unavailable&&url==='/elitebridge/diagnostics')throw Error('Fixture outage');
if(url==='/elitebridge/status')return {activeProvider:'metaapi'};
if(url==='/elitebridge/protocol')return {pairingEnabled:true};
if(url==='/elitebridge/readiness')return {checks:[{id:'cloud',title:'Secure cloud ingestion',state:'ready',note:'Configured in synthetic fixture only.'},{id:'host',title:'Dedicated Windows MT5 terminal',state:'pending',note:'A running Windows terminal still requires verification.'}]};
if(url==='/elitebridge/terminals'&&method==='POST')return {terminalId:terminal.id};
if(url==='/elitebridge/terminals')return {terminals:[terminal]};
if(url==='/accounts')return {accounts:[{id:'fixture-account',broker:'Fixture broker',status:'connected'}]};
if(url==='/elitebridge/diagnostics')return {checkedAt:new Date().toISOString(),terminals:[{terminalId:terminal.id,label:terminal.label,state:'awaiting-approval',heartbeatAgeSeconds:null,quoteAgeSeconds:null,recovery:'Complete signed pairing and explicit administrator approval.'}]};
throw Error('Unexpected fixture API');
};
const ui=createEliteBridgeWorkspace({api,esc,state:f.state});
document.querySelector('main').innerHTML=await ui.page();ui.mount();f.ui=ui;f.ready=true;
</script></body></html>`;
const server=createServer((req,res)=>{
  if(req.url==='/elitebridge.js'||req.url==='/elitebridge.css'){
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
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>window.bridgeFixture?.ready===true);
  await page.clock.install();
  const form=page.locator('[data-bridge-form="enroll"]');
  await page.locator('.bridge-details summary').click();
  await form.getByLabel('Terminal name').fill('My unsent Windows terminal');
  await form.getByLabel('Ed25519 PUBLIC key in PEM format').fill('PUBLIC TEST DRAFT');
  await page.getByRole('heading',{name:'Receipt diagnostics'}).click();
  const previousRoot=await page.locator('.bridge-root').elementHandle();
  await page.clock.runFor(15001);
  await page.waitForFunction(el=>!el.isConnected,previousRoot);
  assert.equal(await form.getByLabel('Terminal name').inputValue(),'My unsent Windows terminal');
  assert.equal(await form.getByLabel('Ed25519 PUBLIC key in PEM format').inputValue(),'PUBLIC TEST DRAFT');
  assert.equal(await page.locator('.bridge-details').getAttribute('open'),'');

  // Edits made while HTTP work is in flight must be captured at commit time.
  await page.evaluate(()=>{window.bridgeFixture.delay=true;});
  const inFlightRoot=await page.locator('.bridge-root').elementHandle();
  await page.clock.runFor(15001);
  await page.waitForFunction(()=>window.bridgeFixture.pending.length>=3);
  await form.getByLabel('Terminal name').fill('Edited during refresh');
  await page.evaluate(()=>{const f=window.bridgeFixture;f.delay=false;f.pending.splice(0).forEach(r=>r());});
  await page.waitForFunction(el=>!el.isConnected,inFlightRoot);
  await page.waitForFunction(()=>window.bridgeFixture.pending.length===0);
  await page.waitForFunction(()=>document.activeElement?.value==='Edited during refresh');
  assert.equal(await form.getByLabel('Terminal name').inputValue(),'Edited during refresh');

  await page.evaluate(()=>{window.bridgeFixture.unavailable=true;window.dispatchEvent(new Event('online'));});
  await page.getByText('Diagnostics unavailable; telemetry freshness is unknown.',{exact:false}).waitFor();
  assert.match(await page.locator('#bridge-overview').innerText(),/Receiving telemetry\s+Unknown/);
  await page.evaluate(()=>{window.bridgeFixture.unavailable=false;window.dispatchEvent(new Event('online'));});
  await page.locator('#bridge-diagnostics').getByText('Checked',{exact:true}).waitFor();

  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:900});
    for(const theme of ['dark','light']){
      await page.evaluate(t=>document.body.classList.toggle('light',t==='light'),theme);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,
        'Horizontal overflow at '+width+' '+theme);
      if(width===390||width===1440)await page.screenshot({path:'test-results/elitebridge-'+width+'-'+theme+'.png',fullPage:true});
    }
  }
  // Cleanup prevents an old refresh from replacing a later route's content.
  await page.evaluate(()=>{window.bridgeFixture.delay=true;window.dispatchEvent(new Event('online'));});
  await page.waitForFunction(()=>window.bridgeFixture.pending.length>=3);
  await page.evaluate(()=>{
    const f=window.bridgeFixture;f.ui.dispose();
    document.querySelector('main').innerHTML='<h1 id="next-page">Next page</h1>';
    f.delay=false;f.pending.splice(0).forEach(r=>r());
  });
  await page.clock.runFor(60001);
  assert.equal(await page.locator('#next-page').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS: EliteBridge browser fixtures — drafts, in-flight edits, outages, reconnect, cleanup, 320–1440px and both themes. No broker connected.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
