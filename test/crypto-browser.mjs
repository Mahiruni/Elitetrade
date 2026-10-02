// Isolated UI verification. No chain request, real user, payment or provider key.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {createApplication} from '../src/app.mjs';
import {openDatabase} from '../src/database.mjs';
import {USDT_DESTINATION} from '../src/tron-payments.mjs';
const require=createRequire(import.meta.url);
let chromium;try {({chromium}=require('playwright'));}catch {({chromium}=require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`));}
const app=createApplication({db:openDatabase(':memory:'),gateway:null,telegram:null,env:{APP_ORIGIN:'http://127.0.0.1:4390'}});
await new Promise(r=>app.server.listen(4390,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
let active=false,admin=false,ready=true,invoice=null,savedKey='';
const user=()=>({id:'isolated-member',email:'member@example.test',name:'Payment fixture',role:admin?'admin':'user',active});
const method={id:'00000000-0000-4000-8000-000000000001',name:'USDT · TRC20',kind:'crypto',network:'TRC20',details:USDT_DESTINATION,automatic:true,enabled:true};
const health=()=>({ready,message:ready?'USDT TRC20 verification is available.':'TronGrid key saved. Waiting for verification check.'});
await context.addInitScript(()=>localStorage.setItem('elite-supabase-session',JSON.stringify({access_token:'isolated-session',expires_at:Date.now()/1000+3600})));
await context.route('**/api/**',async route=>{
 const req=route.request(),path=new URL(req.url()).pathname;
 let json;
 if(path==='/api/config')json={cryptoInvoicesSupported:true,priceCents:14000,emailConfigured:true,supabaseUrl:'http://127.0.0.1:4390',supabasePublishableKey:'isolated'};
 else if(path==='/api/me')json={user:user(),requiresMfa:false};
 else if(path==='/api/events')return route.fulfill({status:204});
 else if(path==='/api/payment-methods')json={methods:[method],priceCents:14000,crypto:health()};
 else if(path==='/api/payments')json={payments:active?[{id:'isolated-payment',kind:'subscription',reference:'trc20:'+'a'.repeat(64),amount_cents:14000,status:'approved',created_at:Date.now()}]:[]};
 else if(path==='/api/crypto-invoices'){
  if(req.method()==='POST'){
   assert.deepEqual(req.postDataJSON(),{methodId:method.id});
   invoice={id:'isolated-invoice',method_id:method.id,destination:USDT_DESTINATION,price_cents:14000,amount_units:140001234,amount:'140.001234',status:'pending',created_at:Date.now(),expires_at:Date.now()+86400000};
   json={invoice};
  }else json={invoices:invoice?[invoice]:[],crypto:health()};
 }else if(path==='/api/admin/overview')json={users:[user()],payments:[],methods:[method],accounts:[],payouts:[],rounds:[],audit:[],priceCents:14000,telegramChat:'',crypto:health()};
 else if(path==='/api/admin/settings'){savedKey=req.postDataJSON().tronGridApiKey;ready=false;json={ok:true};}
 else {errors.push('Unexpected API: '+path);return route.fulfill({status:500,json:{error:'Unexpected isolated request.'}});}
 return route.fulfill({json});
});
page.on('pageerror',e=>errors.push(e.message));mkdirSync('test-results',{recursive:true});
try {
 await page.goto('http://127.0.0.1:4390/subscription');
 await page.getByRole('button',{name:'Create USDT invoice',exact:true}).click();
 await page.getByText('140.001234 USDT',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Copy wallet address'}).getAttribute('data-id'),USDT_DESTINATION);
 assert.equal(await page.getByRole('button',{name:'Copy exact amount'}).getAttribute('data-id'),'140.001234');
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});
  for(const light of [false,true]){
   await page.evaluate(v=>document.body.classList.toggle('light',v),light);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`Invoice overflow ${width}, light:${light}`);
  }
 }
 await page.setViewportSize({width:390,height:844});
 await page.getByText('Already sent a payment? Request manual review',{exact:true}).click();
 await page.getByLabel('Transaction reference',{exact:true}).waitFor();
 await page.getByText('Already sent a payment? Request manual review',{exact:true}).click();
 await page.evaluate(async()=>Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{}))));
 await page.screenshot({path:'test-results/usdt-invoice-mobile.png',fullPage:true});
 active=true;invoice.status='paid';
 await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
 await page.getByText('Your lifetime subscription is active.',{exact:true}).waitFor();
 await page.getByText('approved',{exact:true}).waitFor();
 admin=true;
 await page.goto('http://127.0.0.1:4390/admin');
 await page.getByLabel('Administration section',{exact:true}).selectOption('settings');
 const key=page.getByLabel('TronGrid API key',{exact:true});assert.equal(await key.inputValue(),'');
 await key.fill('isolated-private-key-123456');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByText('TronGrid key saved. Waiting for verification check.',{exact:true}).waitFor();
 assert.equal(savedKey,'isolated-private-key-123456');assert.equal(await page.getByLabel('TronGrid API key',{exact:true}).inputValue(),'');
 active=false;admin=false;invoice=null;
 await page.goto('http://127.0.0.1:4390/subscription');
 await page.getByText('Automatic confirmation is currently unavailable. Contact support or request manual review below.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Create USDT invoice',exact:true}).count(),0);
 ready=true;invoice={id:'expired',status:'pending',expires_at:Date.now()-1};
 await page.reload();
 await page.getByText('The previous invoice has ended.',{exact:false}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Copy exact amount'}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('USDT browser verification passed: exact quote, address copy, both themes at four widths, manual fallback, automatic activation display, private admin key, unavailable and expired invoices.');
}finally {await browser.close();await app.close();}
