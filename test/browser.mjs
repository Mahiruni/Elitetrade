// Optional browser verification: install Playwright, or use the supplied runtime.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createApplication } from '../src/app.mjs';
import { openDatabase } from '../src/database.mjs';
const require = createRequire(import.meta.url);
let chromium;
try { ({chromium} = require('playwright')); }
catch { ({chromium} = require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`)); }
const db = openDatabase(':memory:');
const app = createApplication({ db,key:randomBytes(32),env:{APP_ORIGIN:'http://127.0.0.1:4389',SUPABASE_URL:'http://127.0.0.1:4389',SUPABASE_PUBLISHABLE_KEY:'browser-test-only'} });
await new Promise(resolve => app.server.listen(4389,'127.0.0.1',resolve));
const browser = await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {})});
const base = 'http://127.0.0.1:4389', errors = [];
// A test-only auth adapter exercises UI journeys against the isolated in-memory
// backend. It never registers users or sends messages against a live Supabase.
async function isolateAuth(context) {
  let csrf = '';
  await context.route('**/auth/v1/**',async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith('/factors')) return route.fulfill({json:[]});
    const body = request.postDataJSON() || {};
    const signup = path.endsWith('/signup');
    const localPath = signup ? '/api/auth/signup' : path.endsWith('/logout') ? '/api/auth/logout' : '/api/auth/login';
    const response = await route.fetch({url:base+localPath,method:'POST',headers:{...request.headers(),'x-csrf-token':csrf},postData:JSON.stringify(signup ? {name:body.data.full_name,email:body.email,password:body.password,referral:body.data.referral_code} : body)});
    const result = await response.json();
    if (!response.ok()) return route.fulfill({response,json:result});
    csrf = result.csrf || csrf;
    await route.fulfill({response,json:{access_token:'isolated-browser-session',refresh_token:'isolated-refresh',expires_in:3600}});
  });
  await context.route('**/api/**',async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.continue();
    const response = await route.fetch({headers:{...request.headers(),'x-csrf-token':csrf}});
    await route.fulfill({response});
  });
}
const context = await browser.newContext({viewport:{width:1440,height:1000}});
await isolateAuth(context);
const page = await context.newPage();
page.on('pageerror',e => errors.push(e.message));
page.on('console',e => { if (e.type() === 'error' && !e.text().includes('503')) errors.push(e.text()); });
mkdirSync('test-results',{recursive:true});
const ready = async title => { await page.getByRole('heading',{name:title,exact:true}).waitFor(); };
const navigate = async path => { await page.goto(base+path); await page.locator('h1').waitFor(); };
const capture = async (target,options) => {
  await target.evaluate(async () => {
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  await target.screenshot(options);
};
try {
  // Check public content and authentication at every target width in both themes.
  for (const width of [320,360,390,430,768,1024,1280,1440,1728]) {
    await page.setViewportSize({width,height:900});
    for (const theme of ['dark','light']) {
      await page.goto(base+'/');
      await page.locator('h1').waitFor();
      await page.evaluate(value => { localStorage.setItem('elite-theme',value); document.body.classList.toggle('light',value === 'light'); },theme);
      for (const path of ['/','/signup','/login','/terms','/support']) {
        await navigate(path);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),`Horizontal overflow: ${path}, ${width}px, ${theme}`);
      }
    }
  }
  await page.setViewportSize({width:390,height:844});
  await navigate('/');
  await page.getByLabel('Navigation menu',{exact:true}).click();
  await page.getByRole('navigation',{name:'Mobile site navigation'}).getByRole('link',{name:'Security',exact:true}).click();
  assert.equal(await page.locator('.public-menu').getAttribute('open'),null);
  await page.getByLabel('Navigation menu',{exact:true}).click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.public-menu').getAttribute('open'),null);
  await capture(page,{path:'test-results/home-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});
  await navigate('/');
  await page.getByRole('button',{name:'Toggle light and dark theme',exact:true}).click();
  await capture(page,{path:'test-results/home-desktop.png',fullPage:true});
  await navigate('/login'); await ready('Welcome back.');
  await capture(page,{path:'test-results/login-desktop.png',fullPage:true});
  await page.getByRole('tab',{name:'Create account',exact:true}).click();
  assert.ok(await page.getByLabel('Password',{exact:true}).isVisible());
  await page.getByLabel('Full name',{exact:true}).fill('Browser Member');
  await page.getByLabel('Email address',{exact:true}).fill('browser@example.test');
  await page.getByLabel('Password',{exact:true}).fill('Browser password 42!');
  await page.getByRole('button',{name:'Continue',exact:true}).click(); await ready('Your subscription');
  await page.getByRole('link',{name:'Settings',exact:true}).click(); await ready('Account settings');
  await page.getByLabel('Full name',{exact:true}).fill('Mahir Browser');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByText('Changes saved.',{exact:true}).waitFor();
  await page.reload(); await page.getByLabel('Full name',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Full name',{exact:true}).inputValue(),'Mahir Browser');
  db.prepare("UPDATE users SET role='admin',active=1 WHERE email='browser@example.test'").run();
  await navigate('/admin'); await ready('Administration');
  await page.getByRole('tab',{name:'Payment methods',exact:true}).click();
  await page.getByRole('button',{name:'Add payment method',exact:true}).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Method name',{exact:true}).fill('Verification Bank');
  await dialog.getByLabel('Account or wallet details',{exact:true}).fill('QA account 12345');
  await dialog.getByRole('button',{name:'Save payment method',exact:true}).click();
  await page.getByRole('cell',{name:'QA account 12345',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Pool rounds',exact:true}).click();
  await page.getByRole('button',{name:'Create pool round',exact:true}).click();
  await dialog.getByLabel('Round name',{exact:true}).fill('October verification');
  await dialog.getByRole('button',{name:'Save pool round',exact:true}).click();
  await page.getByRole('cell').filter({hasText:'October verification'}).waitFor();
  for (const tab of ['Payments','Members','MT5 accounts','Payouts','Configuration','Activity']) {
    await page.getByRole('tab',{name:tab,exact:true}).click();
    await page.getByRole('tab',{name:tab,exact:true}).filter({has:page.locator(':scope[aria-selected="true"]')}).count();
    await page.locator('[role="tabpanel"]').waitFor();
  }
  await capture(page,{path:'test-results/admin-desktop.png',fullPage:true});
  await page.getByRole('link',{name:'MT5 terminal',exact:true}).click(); await ready('MT5 terminal');
  await page.getByRole('button',{name:'Add account',exact:true}).click();
  await dialog.getByLabel('Broker',{exact:true}).fill('Test Broker');
  await dialog.getByLabel('MT5 account number',{exact:true}).fill('123456');
  await dialog.getByLabel('Server',{exact:true}).fill('Broker-Demo');
  await dialog.getByLabel('MT5 password',{exact:true}).fill('Broker password 42!');
  await dialog.getByRole('button',{name:'Save account',exact:true}).click();
  await page.getByRole('heading',{name:'Test Broker',exact:true}).waitFor();
  await page.getByRole('link',{name:'Trading bots',exact:true}).click(); await ready('Trading bots');
  await page.getByRole('button',{name:'Configure',exact:true}).click();
  await dialog.getByLabel('Bot name',{exact:true}).fill('My gold bot');
  await dialog.getByLabel('MT5 account',{exact:true}).selectOption({label:'Test Broker · 123456'});
  await dialog.getByRole('button',{name:'Save configuration',exact:true}).click();
  await page.getByRole('heading',{name:'My gold bot',exact:true}).waitFor();
  await capture(page,{path:'test-results/bots-desktop.png',fullPage:true});
  const customerContext = await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await isolateAuth(customerContext);
  const customer = await customerContext.newPage(); customer.on('pageerror',e => errors.push(e.message));
  await customer.goto(base+'/signup');
  assert.ok(await customer.getByLabel('Password',{exact:true}).isVisible());
  await customer.getByLabel('Full name',{exact:true}).fill('Mobile Customer');
  await customer.getByLabel('Email address',{exact:true}).fill('mobile@example.test');
  await customer.getByLabel('Password',{exact:true}).fill('Mobile password 42!');
  await customer.getByRole('button',{name:'Continue',exact:true}).click();
  await customer.getByRole('heading',{name:'Your subscription',exact:true}).waitFor();
  await customer.getByLabel('Transaction reference',{exact:true}).fill('browser-payment-123');
  await customer.getByRole('button',{name:'Submit for review',exact:true}).click();
  await customer.getByText('pending',{exact:true}).waitFor();
  await navigate('/admin');
  await page.getByRole('tab',{name:'Payments',exact:true}).click();
  await page.getByRole('button',{name:'Review',exact:true}).click();
  await dialog.getByLabel('Review note',{exact:true}).fill('Verified test payment');
  await dialog.getByRole('button',{name:'Confirm review',exact:true}).click();
  await page.getByText('approved',{exact:true}).waitFor();
  await customer.reload(); await customer.getByText('Your lifetime subscription is active.',{exact:true}).waitFor();
  await capture(customer,{path:'test-results/subscription-mobile.png',fullPage:true});
  await customer.getByRole('button',{name:'Open navigation',exact:true}).click();
  await customer.getByRole('link',{name:'Support',exact:true}).click();
  await customer.getByRole('button',{name:'New conversation',exact:true}).click();
  await customer.getByRole('button',{name:'Start conversation',exact:true}).click();
  await customer.getByRole('textbox',{name:'Your message',exact:true}).fill('Please confirm my account.');
  await customer.getByRole('button',{name:'Send',exact:true}).click();
  await customer.getByText('Please confirm my account.',{exact:true}).waitFor();
  await navigate('/admin/support');
  await page.getByRole('textbox',{name:'Your message',exact:true}).fill('Your account is active.');
  await page.getByRole('button',{name:'Send',exact:true}).click();
  await customer.getByText('Your account is active.',{exact:true}).waitFor({timeout:20000});
  await capture(customer,{path:'test-results/support-mobile.png',fullPage:true});
  for (const width of [320,360,390,430,768,1024,1280,1440,1728]) {
    await customer.setViewportSize({width,height:900});
    for (const theme of ['dark','light']) {
      await customer.evaluate(value => localStorage.setItem('elite-theme',value),theme);
      for (const path of ['/mt5','/bots','/subscription','/pool','/referrals','/settings','/support']) {
        await customer.goto(base+path); await customer.locator('h1').waitFor();
        assert.ok(await customer.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1),`Horizontal overflow: ${path}, ${width}px, ${theme}`);
      }
    }
  }
  await customer.setViewportSize({width:390,height:844});
  await customer.getByRole('button',{name:'Open navigation',exact:true}).click();
  assert.equal(await customer.locator('.workspace').evaluate(el => el.inert),true);
  await customer.keyboard.press('Escape');
  assert.equal(await customer.locator('.workspace').evaluate(el => el.inert),false);
  await customer.getByRole('button',{name:'Open navigation',exact:true}).click();
  await customer.getByRole('button',{name:'Close navigation',exact:true}).click();
  assert.equal(await customer.locator('.workspace').evaluate(el => el.inert),false);
  await customer.getByRole('button',{name:'Toggle light and dark theme',exact:true}).click();
  await customer.evaluate(() => localStorage.setItem('elite-theme','light'));
  await customer.goto(base+'/settings');
  await customer.getByRole('heading',{name:'Account settings',exact:true}).waitFor();
  await customer.locator('body.light').waitFor();
  assert.equal(await customer.locator('.sidebar').isVisible(),false);
  await capture(customer,{path:'test-results/settings-mobile-light.png',fullPage:true});
  await page.goto(base+'/mt5'); await ready('MT5 terminal');
  await capture(page,{path:'test-results/terminal-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: desktop and mobile registration, profile persistence, administration, payment activation, MT5 details, bot settings, live support replies, navigation, theme, layout, and console checks.');
} finally { await browser.close(); await app.close(); db.close(); }
