// Isolated end-to-end verification. The gateway below never talks to a broker.
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createApplication} from '../src/app.mjs';
import {openDatabase} from '../src/database.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`);
const db=openDatabase(':memory:'),commands=[],running=new Map();
const gateway={mode:'execution',tradingEnabled:true,
 connect:async a=>({accountId:`fixture:${a.login}`,connected:true}),
 snapshot:async id=>({connected:true,accountType:id.endsWith('222222')?'real':'demo',currency:'USD',balance:1250,equity:1247,profit:-3,positions:[{id:'fixture-position',symbol:'XAUUSD',type:'POSITION_TYPE_BUY',volume:.01,openPrice:2000,profit:-3}],history:[{time:Date.now()-86400000,value:1250},{time:Date.now(),value:1247}]}),
 control:async (account,b,enabled)=>{commands.push({id:b.id,enabled});await new Promise(r=>setTimeout(r,150));running.set(b.id,enabled);return {running:enabled};},
 botState:async (account,id)=>({running:!!running.get(id)}),disconnect:async()=>({disconnected:true})};
const base='http://127.0.0.1:4391';
const app=createApplication({db,key:randomBytes(32),gateway,env:{APP_ORIGIN:base,SUPABASE_URL:base,SUPABASE_PUBLISHABLE_KEY:'isolated-browser-test'}});
await new Promise(r=>app.server.listen(4391,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
let csrf='';
await context.route('**/auth/v1/**',async route=>{
 const request=route.request(),path=new URL(request.url()).pathname,body=request.postDataJSON()||{};
 if(path.endsWith('/user')&&request.method()==='GET')return route.fulfill({json:{factors:[]}});
 const signup=path.endsWith('/signup');
 const response=await route.fetch({url:base+(signup?'/api/auth/signup':path.endsWith('/logout')?'/api/auth/logout':'/api/auth/login'),method:'POST',headers:{...request.headers(),'x-csrf-token':csrf},postData:JSON.stringify(signup?{name:body.data.full_name,email:body.email,password:body.password}:body)});
 const result=await response.json();if(!response.ok())return route.fulfill({response,json:result});csrf=result.csrf||csrf;
 await route.fulfill({response,json:{access_token:'isolated-session',refresh_token:'isolated-refresh',expires_in:3600}});
});
await context.route('**/api/**',async route=>{if(route.request().method()==='GET')return route.continue();const response=await route.fetch({headers:{...route.request().headers(),'x-csrf-token':csrf}});return route.fulfill({response});});
const go=async path=>{await page.goto(base+path);await page.locator('h1').waitFor();await page.locator('.workspace-loading').waitFor({state:'hidden'});};
const screenshot=async (name,fullPage=true)=>{await page.locator('#app-opening').waitFor({state:'hidden'});await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:`test-results/${name}.png`,fullPage});};
mkdirSync('test-results',{recursive:true});
try {
 await go('/signup');await page.getByLabel('Full name',{exact:true}).fill('Workspace QA');await page.getByLabel('Email address',{exact:true}).fill('workspace@example.test');await page.getByLabel('Password',{exact:true}).fill('Workspace password 42!');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Your subscription',exact:true}).waitFor();
 db.prepare("UPDATE users SET active=1,role='admin' WHERE email='workspace@example.test'").run();
 for(const login of ['111111','222222']) {
  await go('/mt5');await page.getByRole('button',{name:'Add account',exact:true}).click();const d=page.getByRole('dialog');
  await d.getByLabel('Broker',{exact:true}).fill('Fixture Broker');await d.getByLabel('MT5 account number',{exact:true}).fill(login);await d.getByLabel('Server',{exact:true}).fill('Fixture-MT5');await d.getByLabel('MT5 password',{exact:true}).fill('Fixture password 42!');await d.getByRole('button',{name:'Save account',exact:true}).click();await d.waitFor({state:'hidden'});
  const a=db.prepare('SELECT * FROM accounts WHERE login=?').get(login);
  const review=await context.request.post(base+`/api/admin/accounts/${a.id}/review`,{headers:{'x-csrf-token':csrf},data:{decision:'approve',note:'Isolated fixture approval'}});assert.equal(review.status(),200);
 }
 await go('/bots');await page.getByRole('button',{name:'Configure',exact:true}).click();let d=page.getByRole('dialog');
 await d.getByLabel('MT5 account',{exact:true}).selectOption({label:'Fixture Broker · 111111'});await d.getByRole('button',{name:'Save configuration',exact:true}).click();await d.waitFor({state:'hidden'});
 await page.getByRole('button',{name:'Start bot',exact:true}).click();assert.equal(commands.length,0,'Opening confirmation must not send a trading command');
 await d.getByRole('button',{name:'Start bot',exact:true}).click();await page.getByRole('button',{name:'Pause bot',exact:true}).waitFor();assert.equal(commands.length,1);
 await page.getByRole('button',{name:'Pause bot',exact:true}).click();assert.ok((await d.innerText()).includes('Existing positions may remain open'));
 await d.evaluate(el=>{const f=el.querySelector('form');f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});await d.waitFor({state:'hidden'});assert.equal(commands.length,2,'Duplicate submit must not duplicate a gateway command');
 await context.setOffline(true);assert.equal(await page.getByRole('button',{name:'Start bot',exact:true}).isDisabled(),true);await context.setOffline(false);
 await go('/dashboard');const first=db.prepare("SELECT id FROM accounts WHERE login='111111'").get().id;await page.locator('#workspace-account').selectOption(first);await page.getByText('Broker equity history',{exact:true}).waitFor();assert.ok(await page.locator('.financial-stats').innerText().then(t=>t.includes('$1,250.00')&&t.includes('-$3.00')));assert.equal(await page.getByRole('cell',{name:/XAUUSD/}).count(),1);
 await page.getByRole('button',{name:'7D',exact:true}).click();await go('/activity');assert.equal(await page.locator('#workspace-account').inputValue(),first);await go('/dashboard');assert.equal(await page.getByRole('button',{name:'7D',exact:true}).getAttribute('aria-pressed'),'true');

 // Hold account reads indefinitely: navigation must display useful content without them.
 const endpoints=/\/api\/(accounts|bots)$/;
 for(const width of [390,1440]) {
  await page.setViewportSize({width,height:900});await go('/dashboard');
  let release;const gate=new Promise(r=>release=r),reads={accounts:0,bots:0};
  await page.route(endpoints,async route=>{reads[new URL(route.request().url()).pathname.split('/').at(-1)]++;await gate;await route.continue();});
  const nav=width<760?'.bottom-nav':'.sidebar nav';
  const switchTo=async(path,title)=>{
   await page.locator(`${nav} a[href="${path}"]`).click();
   await page.getByRole('heading',{name:title,exact:true}).waitFor({timeout:600});
   await page.locator('.account-strip').waitFor({timeout:600});
   assert.equal(await page.locator('#snapshot-banner').isVisible(),true);
   assert.ok((await page.locator('.account-strip-state').innerText()).toLowerCase().includes('last known: connected'));
   assert.equal(await page.locator('.workspace-loading').count(),0);
  };
  await switchTo('/markets','Markets');await switchTo('/trade','Trade');await switchTo('/bots','Trading bots');
  assert.equal(await page.getByRole('button',{name:'Start bot',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Configure',exact:true}).isDisabled(),true);
  const chrome=await page.locator('.topbar').elementHandle();
  await page.waitForFunction(()=>document.querySelector('#snapshot-banner').textContent.includes('Refreshing'));
  release();await page.locator('#snapshot-banner').waitFor({state:'hidden'});
  assert.equal(await page.getByRole('heading',{name:'Trading bots',exact:true}).count(),1,'Old requests cannot replace the current page');
  assert.equal(await page.getByRole('button',{name:'Start bot',exact:true}).isEnabled(),true,'Fresh account confirmation restores valid controls');
  assert.equal(await page.getByRole('button',{name:'Configure',exact:true}).isEnabled(),true);
  assert.equal(await chrome.evaluate(el=>el===document.querySelector('.topbar')),true,'Background updates preserve the shell');
  assert.deepEqual(reads,{accounts:1,bots:1},'Rapid route changes share in-flight reads');
  await page.unroute(endpoints);
  await page.locator(`${nav} a[href="/account"]`).click();await page.getByRole('heading',{name:'Account',exact:true}).waitFor({timeout:600});
  await page.locator('#main a[href="/settings"]').click();await page.getByRole('heading',{name:'Account settings',exact:true}).waitFor({timeout:600});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'main','Static page navigation restores keyboard focus');
 }
 // A failed update keeps the last view visibly stale with a retry, never enabled controls.
 await page.route(endpoints,route=>route.fulfill({status:503,json:{error:'Fixture service unavailable'}}));
 await page.locator('.sidebar nav a[href="/dashboard"]').click();
 await page.getByText('Previously loaded data · Update unavailable',{exact:true}).waitFor();
 assert.equal(await page.locator('.account-strip').isVisible(),true);
 await page.unroute(endpoints);await page.locator('#snapshot-banner [data-action="refresh"]').click();
 await page.locator('#snapshot-banner').waitFor({state:'hidden'});
 console.log('PASS: immediate mobile/desktop navigation with blocked backend reads, request coalescing, stale control locks, safe refresh, preserved shell, and retry.');
 await screenshot('overview-connected-desktop');
 // Read-only market fixtures verify rendering; no production prices or orders are used.
 let previewCalls=0;
 await page.route('**/api/bots/*/preview',route=>{previewCalls++;return route.fulfill({json:{accountType:'demo',timeframe:'15m',updatedAt:new Date().toISOString(),retrievedAt:Date.now(),quote:{bid:2001.5,ask:2001.8},orders:[{id:'fixture-order',symbol:'XAUUSD',type:'ORDER_TYPE_BUY_LIMIT',volume:.01,openPrice:1998,stopLoss:1990,takeProfit:2014}],candles:Array.from({length:60},(_,i)=>({time:new Date(Date.now()-(60-i)*900000).toISOString(),open:2000+i*.2,high:2001+i*.2,low:1999+i*.2,close:2000.5+i*.2})),signal:{side:null,description:'Controlled test fixture'},riskMessage:'No current entry signal.',order:null,message:'Preview only. No order sent.'}});});
 await go('/trade');await page.getByRole('heading',{name:'Chart data unavailable',exact:true}).count();
 const before=commands.length;await page.getByRole('button',{name:'Load broker chart',exact:true}).click();
 await page.locator('.candlestick-chart').waitFor();assert.equal(previewCalls,1);assert.equal(commands.length,before,'Chart refresh must never send a trading command');
 assert.equal(await page.locator('.candlestick-chart rect').count(),60);
 await page.getByRole('button',{name:'SMA 20',exact:true}).click();await page.locator('.candlestick-chart polyline').waitFor();
 await page.getByRole('button',{name:'Expand chart',exact:true}).click();assert.equal(await page.locator('.chart-expanded').count(),1);await page.keyboard.press('Escape');assert.equal(await page.locator('.chart-expanded').count(),0);
 await page.getByRole('tab',{name:'Positions',exact:true}).click();assert.ok((await page.locator('#trade-panel').innerText()).includes('XAUUSD'));
 await page.getByRole('tab',{name:'Orders',exact:true}).click();assert.ok((await page.locator('#trade-panel').innerText()).includes('1,998'));
 await page.getByRole('tab',{name:'History',exact:true}).click();assert.ok((await page.locator('#trade-panel').innerText()).includes('Trade history unavailable'));
 await page.getByRole('tab',{name:'History',exact:true}).focus();await page.keyboard.press('Home');await page.getByRole('tab',{name:'Chart',exact:true}).waitFor();await page.locator('.candlestick-chart').waitFor();
 await screenshot('trade-connected-desktop');
 for(const width of [360,390,768,1440])for(const theme of ['dark','light']) {
  await page.setViewportSize({width,height:900});await page.evaluate(t=>document.body.classList.toggle('light',t==='light'),theme);
  await page.locator('.candlestick-chart').waitFor();
  await page.waitForFunction(()=>document.querySelector('.candlestick-chart')?.viewBox.baseVal.width===Math.max(240,Math.round(document.querySelector('[data-market-chart]').clientWidth)));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Trade chart overflow ${width}/${theme}`);
  if(width===390 || width===1440)await screenshot(`trade-chart-${width}-${theme}`,false);
 }
 await page.setViewportSize({width:1440,height:1000});await page.evaluate(()=>document.body.classList.add('light'));
 await page.locator('.sidebar nav a[href="/markets"]').click();await page.getByRole('heading',{name:'Markets',exact:true}).waitFor();await page.getByLabel('Search instruments',{exact:true}).fill('no-match');assert.equal(await page.locator('.watch-row:visible').count(),0);await page.getByLabel('Search instruments',{exact:true}).fill('XAU');assert.equal(await page.locator('.watch-row:visible').count(),1);
 await page.locator('.watch-symbol').click();await page.locator('.candlestick-chart').waitFor();
 await page.route('**/api/bots/*/preview',route=>route.fulfill({status:503,json:{error:'Fixture broker outage'}}));
 await page.getByRole('button',{name:'Refresh broker data',exact:true}).click();await page.getByText(/Fixture broker outage.*Retry/).waitFor();assert.equal((await page.locator('.market-strip>.badge').innerText()).toLowerCase(),'stale');
 await page.unroute('**/api/bots/*/preview');
 console.log('PASS: lazy broker candlesticks, SMA overlay, expansion, keyboard Trade tabs, pending orders, instrument search, provider outage, and no commands on chart refresh.');
 await go('/bots');await page.getByRole('button',{name:'Configure',exact:true}).click();await d.getByLabel('MT5 account',{exact:true}).selectOption({label:'Fixture Broker · 222222'});await d.getByRole('button',{name:'Save configuration',exact:true}).click();assert.equal(await d.isVisible(),true);await d.getByRole('button',{name:'Confirm live risk settings',exact:true}).click();await d.waitFor({state:'hidden'});
 for(const width of [320,360,390,768,1440])for(const theme of ['light','dark']) {
  await page.setViewportSize({width,height:900});await page.evaluate(theme=>localStorage.setItem('elite-theme',theme),theme);
  for(const path of ['/dashboard','/bots','/positions','/account','/settings','/markets','/trade']) {
   await go(path);await page.locator('.workspace-loading').waitFor({state:'hidden'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow ${width}/${theme}/${path}`);
   const overlap=await page.evaluate(()=>{const nav=document.querySelector('.bottom-nav');return getComputedStyle(nav).display!=='none'&&document.querySelector('.workspace').getBoundingClientRect().bottom>document.documentElement.scrollHeight+1;});assert.equal(overlap,false);
  }
 }

 await page.setViewportSize({width:390,height:844});
 for(const theme of ['light','dark']) {
  await page.evaluate(theme=>localStorage.setItem('elite-theme',theme),theme);await go('/dashboard');
  const nav=page.getByRole('navigation',{name:'Mobile navigation'});
  assert.equal(await nav.getByRole('link',{name:'Home',exact:true}).getAttribute('aria-current'),'page');
  assert.equal(await nav.locator('a').count(),5);
  assert.ok(await nav.locator('a').evaluateAll(links=>links.every(a=>a.getBoundingClientRect().height>=44&&a.getBoundingClientRect().width>=44)));
  assert.equal(await nav.getByRole('link',{name:'Home',exact:true}).locator('svg').getAttribute('fill'),'currentColor');
  await screenshot(`navigation-mobile-${theme}`,false);
  assert.equal(await page.locator('.topbar').getByRole('link',{name:'View account alerts',exact:true}).isVisible(),true);
  const opener=page.getByRole('button',{name:'Open navigation',exact:true});await opener.click();
  const drawer=page.getByRole('dialog',{name:'Workspace navigation'});await drawer.waitFor();
  assert.equal(await opener.getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('.workspace').evaluate(el=>el.inert),true);
  await screenshot(`navigation-drawer-${theme}`,false);
  await drawer.getByRole('button',{name:'Sign out',exact:true}).focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.closest('.sidebar')!==null),true,'Focus stays inside the drawer');
  await page.keyboard.press('Escape');assert.equal(await opener.getAttribute('aria-expanded'),'false');
  assert.equal(await opener.evaluate(el=>el===document.activeElement),true,'Closing restores the menu trigger');
  await opener.click();await page.locator('.menu-scrim').click({position:{x:380,y:100}});
  assert.equal(await opener.getAttribute('aria-expanded'),'false','Backdrop dismisses the menu');
  await opener.click();await drawer.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Markets',exact:true}).click();
  await page.getByRole('heading',{name:'Markets',exact:true}).waitFor();
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('menu-open')),false);
  await page.locator('#snapshot-banner').waitFor({state:'hidden'});
 }
 await page.emulateMedia({reducedMotion:'reduce'});await go('/dashboard');
 assert.equal(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).transitionDuration),'0s');
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.setViewportSize({width:390,height:844});await go('/dashboard');await screenshot('overview-connected-mobile');
 await go('/account');await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'Welcome back.',exact:true}).waitFor();
 await page.getByLabel('Email address',{exact:true}).fill('workspace@example.test');await page.getByLabel('Password',{exact:true}).fill('Workspace password 42!');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: sign-in to Overview, confirmed MT5 connections, real fixture balances and positions, account/filter persistence, confirmed start/pause, duplicate prevention, live risk review, offline lock, English-only, both themes, mobile/tablet/desktop, and sign-out.');
} catch(e) {console.log('Failed at',page.url());console.log((await page.locator('body').innerText()).slice(-4000));await screenshot('workspace-browser-failure');throw e;}
finally {await browser.close();await app.close();db.close();}
