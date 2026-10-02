// Isolated UI journeys: no live users, emails, SSO redirects, or trading actions.
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {createApplication} from '../src/app.mjs';
import {openDatabase} from '../src/database.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(`${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright`);
const output=resolve(process.env.AUTH_FRAME_DIR || 'test-results/auth');mkdirSync(output,{recursive:true});
const base='http://localhost:4393';
const app=createApplication({db:openDatabase(':memory:'),key:randomBytes(32),env:{APP_ORIGIN:base,SUPABASE_URL:base,SUPABASE_PUBLISHABLE_KEY:'isolated-auth-test'}});
await new Promise(resolve=>app.server.listen(4393,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
let csrf='',scenario='',release=null,requests=[];
await context.route('**/auth/v1/**',async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 const body=req.postData() ? req.postDataJSON() : {};
 requests.push({path,body});
 if(path.endsWith('/factors'))return route.fulfill({json:scenario==='mfa' ? [{id:'isolated-factor',factor_type:'totp',status:'verified'}] : []});
 if(scenario==='mfa' && path.endsWith('/challenge'))return route.fulfill({json:{id:'isolated-mfa-challenge'}});
 if(scenario==='mfa' && path.endsWith('/verify'))return route.fulfill({json:{access_token:'isolated-mfa-session',refresh_token:'isolated-refresh',expires_in:3600}});
 if(path.endsWith('/settings'))return route.fulfill({json:{external:{apple:false,google:false}}});
 if(scenario==='passkey-enroll' && path.endsWith('/registration/options'))return route.fulfill({json:{challenge_id:'isolated-registration-challenge',options:{challenge:randomBytes(32).toString('base64url'),rp:{id:'localhost',name:'EliteBot'},user:{id:randomBytes(16).toString('base64url'),name:'auth-browser@example.test',displayName:'Auth Browser'},pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{residentKey:'required',userVerification:'required'},attestation:'none'}}});
 if(scenario==='passkey-enroll' && path.endsWith('/registration/verify')){
  assert.ok(body.credential.response.attestationObject);assert.equal(body.challenge_id,'isolated-registration-challenge');
  return route.fulfill({json:{id:'isolated-passkey',friendly_name:'Test authenticator'}});
 }
 if(scenario==='passkey-auth' && path.endsWith('/authentication/options'))return route.fulfill({json:{challenge_id:'isolated-authentication-challenge',options:{challenge:randomBytes(32).toString('base64url'),rpId:'localhost',userVerification:'required'}}});
 if(scenario==='passkey-auth' && path.endsWith('/authentication/verify')){
  assert.ok(body.credential.response.signature);assert.ok(body.credential.response.authenticatorData);assert.equal(body.challenge_id,'isolated-authentication-challenge');
  const response=await route.fetch({url:base+'/api/auth/login',method:'POST',headers:{...req.headers(),'x-csrf-token':csrf},postData:JSON.stringify({email:'auth-browser@example.test',password:'Correct horse orbital river 42!'})});
  const data=await response.json();assert.ok(response.ok());csrf=data.csrf || csrf;
  return route.fulfill({response,json:{access_token:'isolated-session',refresh_token:'isolated-refresh',expires_in:3600}});
 }
 if(path.endsWith('/authentication/options'))return route.fulfill({status:400,json:{error_code:'passkey_disabled',msg:'Passkey sign-in is not enabled'}});
 if(scenario==='rate' && path.endsWith('/token'))return route.fulfill({status:429,headers:{'retry-after':'30'},json:{msg:'Too many attempts',error_code:'over_request_rate_limit'}});
 if(scenario==='wrong' && path.endsWith('/token'))return route.fulfill({status:400,json:{msg:'Invalid login credentials',error_code:'invalid_credentials'}});
 if(path.endsWith('/otp')){
  if(scenario==='hold')await new Promise(resolve=>{release=resolve;});
  if(scenario==='unknown')return route.fulfill({status:400,json:{msg:'User not found',error_code:'user_not_found'}});
  return route.fulfill({json:{}});
 }
 if(path.endsWith('/recover'))return route.fulfill({status:scenario==='unknown' ? 400 : 200,json:{}});
 if(path.endsWith('/resend'))return route.fulfill({json:{}});
 const signup=path.endsWith('/signup');
 const response=await route.fetch({url:base+(signup ? '/api/auth/signup' : path.endsWith('/logout') ? '/api/auth/logout' : '/api/auth/login'),method:'POST',headers:{...req.headers(),'x-csrf-token':csrf},postData:JSON.stringify(signup ? {name:body.data.full_name,email:body.email,password:body.password,referral:body.data.referral_code} : body)});
 const data=await response.json();
 if(!response.ok())return route.fulfill({response,json:data});
 csrf=data.csrf || csrf;
 return route.fulfill({response,json:{access_token:'isolated-session',refresh_token:'isolated-refresh',expires_in:3600}});
});
await context.route('**/api/**',async route=>{
 const req=route.request();if(req.method()==='GET')return route.continue();
 const response=await route.fetch({headers:{...req.headers(),'x-csrf-token':csrf}});await route.fulfill({response});
});
const page=await context.newPage(),errors=[],audits=[];
page.on('pageerror',error=>errors.push(error.message));
const go=async path=>{await page.goto(base+path);await page.locator('#auth-title').waitFor();await page.evaluate(()=>document.fonts.ready);};
const capture=async filename=>{
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
 await page.screenshot({path:join(output,filename),fullPage:false});
};
const component=async(selector,filename)=>{
 const box=await page.locator(selector).boundingBox();
 await page.screenshot({path:join(output,filename),clip:{x:Math.max(0,box.x-6),y:Math.max(0,box.y-6),width:box.width+12,height:box.height+12}});
};
const theme=async value=>{await page.evaluate(theme=>{localStorage.setItem('elite-theme',theme);document.body.classList.toggle('light',theme==='light');},value);};
const password=async()=>page.getByRole('button',{name:'Use a password instead',exact:true}).click();
const axePath=process.env.AXE_SCRIPT;
try{
 // Four mode/theme combinations at both viewport sizes, plus narrow/reflow checks.
 for(const size of ['desktop','mobile']){
  await page.setViewportSize(size==='desktop' ? {width:1440,height:1000} : {width:390,height:844});
  for(const value of ['light','dark'])for(const mode of ['login','signup']){
   await go('/'+mode);await theme(value);await capture(`${size}-${mode}-${value}.png`);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   if(size==='mobile'){
    const box=await page.locator('.auth-primary').boundingBox();assert.ok(box.y+box.height<=844 && box.y>600,'Primary action stays in thumb reach');
   }
   if(axePath){await page.evaluate(readFileSync(axePath,'utf8'));const result=await page.evaluate(()=>axe.run(document.querySelector('.auth-experience'),{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}}));audits.push({size,theme:value,mode,violations:result.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))});}
  }
 }
 for(const width of [320,360,430,768,1024,1728]){
  await page.setViewportSize({width,height:900});for(const mode of ['login','signup']){await go('/'+mode);await password();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${mode} overflow at ${width}`);}
 }
 await page.setViewportSize({width:390,height:844});await go('/signup');await password();
 await page.evaluate(()=>document.documentElement.style.fontSize='200%');
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'200% text reflow');
 await page.evaluate(()=>document.documentElement.style.fontSize='');
 await page.setViewportSize({width:1440,height:1000});
 // Mode switching retains the exact email/password DOM nodes and user-entered values.
 await go('/login');await password();await page.getByLabel('Email address',{exact:true}).fill('member@example.test');await page.getByLabel('Password',{exact:true}).fill('Correct horse orbital river 42!');
 await page.evaluate(()=>{window.emailNode=document.querySelector('#a-email');window.passwordNode=document.querySelector('#a-password');});
 await page.getByRole('tab',{name:'Create account',exact:true}).click();
 assert.ok(await page.evaluate(()=>emailNode===document.querySelector('#a-email') && passwordNode===document.querySelector('#a-password')));
 assert.equal(await page.getByLabel('Email address',{exact:true}).inputValue(),'member@example.test');
 assert.equal(await page.getByLabel('Password',{exact:true}).inputValue(),'Correct horse orbital river 42!');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'auth-tab-signup');
 await page.keyboard.press('ArrowLeft');assert.equal(await page.evaluate(()=>document.activeElement.id),'auth-tab-login');
 await page.getByLabel('Show password',{exact:true}).click();assert.equal(await page.locator('#a-password').getAttribute('type'),'text');
 await page.getByLabel('Hide password',{exact:true}).click();assert.equal(await page.locator('#a-password').getAttribute('type'),'password');
 // Field validation occurs on blur; reserved error space prevents the next field moving.
 await page.getByLabel('Email address',{exact:true}).fill('invalid');
 assert.equal(await page.locator('#a-email-error').textContent(),'');
 await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
 const before=await page.locator('[data-auth-field=password]').evaluate(el=>el.getBoundingClientRect().top+scrollY);
 await page.getByLabel('Password',{exact:true}).focus();
 assert.match(await page.locator('#a-email-error').textContent(),/valid email/);
 const after=await page.locator('[data-auth-field=password]').evaluate(el=>el.getBoundingClientRect().top+scrollY);assert.equal(after,before);
 // Legal sheets trap focus natively, escape closes, focus returns to opener.
 await page.getByRole('tab',{name:'Create account',exact:true}).click();
 await page.getByRole('link',{name:'Terms',exact:true}).click();await page.getByRole('dialog').waitFor();
 await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Terms');
 // Password errors stay neutral, rate limits honor Retry-After and disable duplicate attempts.
 await page.getByRole('tab',{name:'Sign in',exact:true}).click();await page.getByLabel('Email address',{exact:true}).fill('member@example.test');
 scenario='wrong';await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('alert').filter({hasText:'Check your details'}).waitFor();
 scenario='rate';await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Try again in 30s',exact:true}).waitFor();
 assert.ok(await page.getByRole('button',{name:/Try again in/}).isDisabled());
 await capture('desktop-error-dark.png');
 // Component states in both themes: default, focus, inline error, disabled, loading.
 for(const value of ['light','dark']){
  scenario='';await go('/login');await theme(value);await page.getByLabel('Email address',{exact:true}).fill('name@example.com');await page.locator('#auth-title').focus();
  await component('[data-auth-field=email]',`component-input-default-${value}.png`);
  await page.getByLabel('Email address',{exact:true}).focus();await component('[data-auth-field=email]',`component-input-focus-${value}.png`);
  await page.getByLabel('Email address',{exact:true}).fill('name@');await page.locator('#auth-title').focus();await component('[data-auth-field=email]',`component-input-error-${value}.png`);
  await page.getByLabel('Email address',{exact:true}).fill('name@example.com');await page.getByLabel('Email address',{exact:true}).focus();await page.locator('#auth-title').focus();
  await page.locator('#a-email').evaluate(el=>el.disabled=true);await component('[data-auth-field=email]',`component-input-disabled-${value}.png`);await page.locator('#a-email').evaluate(el=>el.disabled=false);
  await component('.auth-primary',`component-button-default-${value}.png`);
  await page.locator('.auth-primary').focus();await component('.auth-primary',`component-button-focus-${value}.png`);
  await page.locator('.auth-primary').evaluate(el=>el.disabled=true);await component('.auth-primary',`component-button-disabled-${value}.png`);await page.locator('.auth-primary').evaluate(el=>el.disabled=false);
  scenario='hold';const count=requests.filter(r=>r.path.endsWith('/otp')).length;
  await page.getByRole('button',{name:'Continue',exact:true}).click();await page.locator('form[aria-busy=true]').waitFor();
  await component('.auth-primary',`component-button-loading-${value}.png`);
  await page.locator('form').evaluate(el=>el.requestSubmit());
  assert.equal(requests.filter(r=>r.path.endsWith('/otp')).length,count+1);
  while(!release)await new Promise(resolve=>setTimeout(resolve,20));release();release=null;
  await page.getByRole('heading',{name:'Check your inbox.',exact:true}).waitFor();await capture(`desktop-success-${value}.png`);
 }
 // Missing accounts receive the same magic-link and recovery success treatment.
 scenario='unknown';await go('/login');await page.getByLabel('Email address',{exact:true}).fill('unknown@example.test');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Check your inbox.',exact:true}).waitFor();
 assert.equal(requests.at(-1).body.create_user,false);
 await go('/forgot-password');await page.getByLabel('Email address',{exact:true}).fill('unknown@example.test');await page.getByRole('button',{name:'Send recovery link',exact:true}).click();await page.getByRole('heading',{name:'Recovery link requested.',exact:true}).waitFor();
 scenario='';await go('/signup');await page.getByLabel('Full name',{exact:true}).fill('Magic Member');await page.getByLabel('Email address',{exact:true}).fill('magic@example.test');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Check your inbox.',exact:true}).waitFor();assert.equal(requests.at(-1).body.create_user,true);
 // Passkey and provider setup gaps remain recoverable; they never imply authentication succeeded.
 await go('/login');await page.getByRole('button',{name:'Use a passkey',exact:true}).click();assert.ok(await page.getByLabel('Email address',{exact:true}).isHidden());
 await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('alert').filter({hasText:'Passkey sign-in is unavailable'}).waitFor();await capture('desktop-passkey-dark.png');
 await page.getByRole('button',{name:'Google',exact:true}).click();await page.getByRole('alert').filter({hasText:'Google sign-in is unavailable'}).waitFor();
 // Reduced motion stops panel drift and transition animations.
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.locator('.drift').evaluate(el=>getComputedStyle(el).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
 // Real local password registration -> subscription -> sign out -> direct sign-in -> MT5.
 await go('/signup');await password();await page.getByLabel('Full name',{exact:true}).fill('Auth Browser');await page.getByLabel('Email address',{exact:true}).fill('auth-browser@example.test');await page.getByLabel('Password',{exact:true}).fill('Correct horse orbital river 42!');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Your subscription',exact:true}).waitFor();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#auth-title').waitFor();await password();await page.getByLabel('Email address',{exact:true}).fill('auth-browser@example.test');await page.getByLabel('Password',{exact:true}).fill('Correct horse orbital river 42!');await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'MT5 terminal',exact:true}).waitFor();
 // MFA sign-in preserves its pending session, challenges, verifies, and opens the workspace.
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#auth-title').waitFor();await password();
 await page.getByLabel('Email address',{exact:true}).fill('auth-browser@example.test');await page.getByLabel('Password',{exact:true}).fill('Correct horse orbital river 42!');
 scenario='mfa';await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'One last check.',exact:true}).waitFor();
 await page.getByLabel('Authenticator code',{exact:true}).fill('123456');await page.getByRole('button',{name:'Verify and continue',exact:true}).click();await page.getByRole('heading',{name:'MT5 terminal',exact:true}).waitFor();
 // Virtual device ceremonies verify the actual WebAuthn bridge and wire serialization.
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
 await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 scenario='passkey-enroll';await go('/passkey-setup');await page.getByRole('button',{name:'Create passkey',exact:true}).click();await page.getByRole('heading',{name:'Your subscription',exact:true}).waitFor();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.locator('#auth-title').waitFor();
 scenario='passkey-auth';await page.getByRole('button',{name:'Use a passkey',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'MT5 terminal',exact:true}).waitFor();
 assert.deepEqual(errors,[],'No browser script errors');
 writeFileSync(join(output,'verification.json'),JSON.stringify({browser:'Chromium',frames:'1440 × 1000 / 390 × 844',narrowWidths:[320,360,430,768,1024,1728],textReflow:'200%',javascriptErrors:errors,accessibility:audits},null,2));
 assert.equal(audits.flatMap(a=>a.violations).length,0,JSON.stringify(audits.filter(a=>a.violations.length)));
 console.log('Auth journeys, layouts, loading guards, recovery, provider fallback, keyboard, reduced motion, and automated accessibility checks passed.');
}finally{await browser.close();await app.close();}
