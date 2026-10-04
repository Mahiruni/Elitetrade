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
const go=async path=>{await page.goto(base+path);await page.locator('h1').waitFor();};
const screenshot=async name=>{await page.locator('#app-opening').waitFor({state:'hidden'});await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:`test-results/${name}.png`,fullPage:true});};
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
 await screenshot('overview-connected-desktop');
 await go('/bots');await page.getByRole('button',{name:'Configure',exact:true}).click();await d.getByLabel('MT5 account',{exact:true}).selectOption({label:'Fixture Broker · 222222'});await d.getByRole('button',{name:'Save configuration',exact:true}).click();assert.equal(await d.isVisible(),true);await d.getByRole('button',{name:'Confirm live risk settings',exact:true}).click();await d.waitFor({state:'hidden'});
 for(const width of [320,390,768,1440])for(const theme of ['light','dark'])for(const lang of ['en','am']) {
  await page.setViewportSize({width,height:900});await page.evaluate(({theme,lang})=>{localStorage.setItem('elite-theme',theme);localStorage.setItem('elite-language',lang);},{theme,lang});
  for(const path of ['/dashboard','/bots','/positions','/account','/settings','/markets']) {
   await go(path);await page.locator('.workspace-loading').waitFor({state:'hidden'});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Overflow ${width}/${theme}/${lang}/${path}`);
   const overlap=await page.evaluate(()=>{const nav=document.querySelector('.bottom-nav');return getComputedStyle(nav).display!=='none'&&document.querySelector('.workspace').getBoundingClientRect().bottom>document.documentElement.scrollHeight+1;});assert.equal(overlap,false);
  }
 }
 await page.setViewportSize({width:390,height:844});await go('/dashboard');await screenshot('overview-connected-mobile-amharic');
 await page.evaluate(()=>localStorage.setItem('elite-language','en'));await go('/account');await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('heading',{name:'Welcome back.',exact:true}).waitFor();
 await page.getByLabel('Email address',{exact:true}).fill('workspace@example.test');await page.getByLabel('Password',{exact:true}).fill('Workspace password 42!');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();
 assert.deepEqual(errors,[]);console.log('PASS: sign-in to Overview, confirmed MT5 connections, real fixture balances and positions, account/filter persistence, confirmed start/pause, duplicate prevention, live risk review, offline lock, English/Amharic, both themes, mobile/tablet/desktop, and sign-out.');
} catch(e) {console.log('Failed at',page.url());console.log((await page.locator('body').innerText()).slice(-4000));await screenshot('workspace-browser-failure');throw e;}
finally {await browser.close();await app.close();db.close();}
