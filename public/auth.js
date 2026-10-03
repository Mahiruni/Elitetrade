/* Authentication UI. Requests are supplied by the application's existing session adapter. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths = {
 mail:'<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m4 7 8 6 8-6"/>',
 key:'<circle cx="8" cy="9" r="5"/><path d="m12 13 8 8m-5-5 3-3m0 6 3-3"/>',
 eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 eyeOff:'<path d="m3 3 18 18M10.6 5.1c.5-.1 1-.1 1.4-.1 7 0 10 7 10 7a18 18 0 0 1-3 4M6.5 6.5A18 18 0 0 0 2 12s3 7 10 7c2 0 3.8-.6 5.2-1.5M10 10a3 3 0 0 0 4 4"/>',
 shield:'<path d="m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7Zm-4 9 3 3 5-6"/>',
 moon:'<path d="M20.5 13A8.5 8.5 0 0 1 11 3.5a8.5 8.5 0 1 0 9.5 9.5Z"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 work:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-6h4v6"/>',
 check:'<path d="m5 12 4 4L19 6"/>', close:'<path d="m6 6 12 12M6 18 18 6"/>',
 alert:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>',
 fingerprint:'<path d="M7 5a8 8 0 0 1 13 6m-16 1a8 8 0 0 1 1-4m3 12c3-3 3-6 3-9a2 2 0 0 1 4 0c0 4-1 8-3 11M5 17c2-2 2-4 2-6a6 6 0 0 1 12 0c0 4-1 7-2 10"/>',
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
const apple = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16.7 2c.1 1.4-.4 2.7-1.2 3.6-.9 1-2.2 1.5-3.5 1.4-.1-1.3.5-2.6 1.3-3.5C14.2 2.6 15.5 2.1 16.7 2Zm3.7 15.6c-.6 1.4-.9 2-1.7 3.2-1 1.3-2.3 2.8-3.9 2.7-1.5 0-1.9-1-4-1s-2.6 1-4.1 1.1c-1.6.1-2.8-1.3-3.8-2.7-2.8-4-3.1-9-.9-11.6 1.6-1.9 3.9-2.3 5.8-1.6 1.4.5 2.4.5 3.8 0 1.7-.7 4.3-.4 5.9 1.3-5.1 2.8-4.2 8 .9 8.6Z" transform="translate(2 0) scale(.86)"/></svg>';
const google = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M21.6 12.2c0-.7-.1-1.4-.2-2.2H12v4.2h5.4a4.6 4.6 0 0 1-2 3c-1 .6-2.1 1-3.4 1A6.2 6.2 0 1 1 16.4 7l3-3A10.4 10.4 0 1 0 12 22.4c6 0 9.6-4.1 9.6-10.2Z"/></svg>';
const themeToggle = () => `<button type="button" class="auth-theme-toggle" data-auth-action="theme" aria-label="Switch to ${document.body.classList.contains('light') ? 'dark' : 'light'} theme">${svg(document.body.classList.contains('light') ? 'moon' : 'sun')}</button>`;
const field = (name,label,type,attributes='') => `<div class="auth-field" data-auth-field="${name}"><label for="a-${name}">${label}</label>${type === 'password' ? '<div class="auth-password-control">' : ''}<input id="a-${name}" name="${name}" type="${type}" aria-describedby="a-${name}-error${name==='password' ? ' a-password-hint' : ''}" ${attributes}>${type === 'password' ? `<button type="button" class="auth-show-password" data-auth-action="show" data-field="${name}" aria-label="Show ${label.toLowerCase()}" aria-pressed="false">${svg('eye')}</button></div>` : ''}<p class="auth-field-error" id="a-${name}-error" aria-live="polite" aria-atomic="true"></p></div>`;
const geometry = () => `<svg class="auth-geometry" viewBox="0 0 560 260" aria-hidden="true"><g class="drift">${Array.from({length:13},(_,i) => `<path d="M${-55+i*10} ${155+i*6} C ${92+i*6} ${-68+i*18},${385-i*4} ${332-i*11},${610-i*3} ${22+i*10}"/>`).join('')}${Array.from({length:9},(_,i) => `<path d="M${45+i*50} -10 C ${110+i*35} 85,${280+i*15} 160,${165+i*48} 290"/>`).join('')}<path class="axis" d="M-20 200C120-15 310 296 580 86"/></g></svg>`;
const titles = {login:'Welcome back.',signup:'Make your next move.',forgot:'A fresh start.',reset:'A new password.',resend:'Verify your email.',mfa:'One last check.',enroll:'Your device. Your key.'};
const descriptions = {login:'Pick up where you left off.',signup:'A clearer trading day starts here.',forgot:'We’ll send you a secure recovery link.',reset:'Choose a password you haven’t used before.',resend:'Request a fresh confirmation link.',mfa:'Enter the code from your authenticator.',enroll:'Save a passkey for faster, safer sign-ins.'};

function decode64(value) {
 const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
function encode64(value) {
 return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function credentialOptions(options,registration=false) {
 const out={...options,challenge:decode64(options.challenge)};
 if(registration) out.user={...options.user,id:decode64(options.user.id)};
 for(const list of ['allowCredentials','excludeCredentials']) if(options[list]) out[list]=options[list].map(item=>({...item,id:decode64(item.id)}));
 return out;
}
function serializeCredential(credential) {
 if(typeof credential.toJSON==='function') return credential.toJSON();
 const response=credential.response;
 const result={id:credential.id,rawId:encode64(credential.rawId),type:credential.type,authenticatorAttachment:credential.authenticatorAttachment,clientExtensionResults:credential.getClientExtensionResults(),response:{clientDataJSON:encode64(response.clientDataJSON)}};
 for(const key of ['authenticatorData','signature','attestationObject']) if(response[key]) result.response[key]=encode64(response[key]);
 if('userHandle' in response) result.response.userHandle=response.userHandle ? encode64(response.userHandle) : null;
 if(response.getTransports) result.response.transports=response.getTransports();
 return result;
}

export function createAuthExperience({root,request,onSession,onMfa,onReset,getSession,legal,onTheme,onDemo,onCancelMfa,returnTo}) {
 let screen=null,mode='login',method='email',busy=false,confirmed=false,previousPath='',cooldownUntil=0,cooldownTimer=null,abort=null;
 let providers=null,config={},lastEmail='',returnFocus=null,controller=null;
 const mobile=window.matchMedia('(max-width:760px)');
 const $=selector=>screen?.querySelector(selector);
 const modePath=path=>({'/signup':'signup','/forgot-password':'forgot','/reset-password':'reset','/resend-confirmation':'resend','/passkey-setup':'enroll'})[path] || 'login';
 const setError=(input,message)=>{
  input.setAttribute('aria-invalid',String(Boolean(message)));
  const box=$(`#a-${input.name}-error`);
  if(box) box.innerHTML=message ? `${svg('alert')}<span>${escape(message)}</span>` : '';
 };
 const message=copy=>{const box=$('.auth-error-summary');if(box)box.innerHTML=copy ? `${svg('alert')}<span>${escape(copy)}</span>` : '';};
 const announce=copy=>{const live=$('.auth-live');if(live) live.textContent=copy;};
 function validate(input) {
  if(input.disabled || input.closest('[hidden]')) return true;
  const value=input.value;
  let error='';
  if(input.name==='email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) error='Enter a valid email address.';
  if(input.name==='name' && (value.trim().length<2 || value.trim().length>64)) error='Use 2–64 characters for your name.';
  if(input.name==='password' && (value.length>128 || value.length<(mode==='login' ? 1 : 12))) error=mode==='login' ? 'Enter your password.' : 'Use 12–128 characters.';
  if(input.name==='confirm' && value!==$('#a-password').value) error='Your passwords don’t match.';
  if(input.name==='code' && !/^\d{6}$/.test(value)) error='Enter the six-digit code.';
  setError(input,error);return !error;
 }
 function validateAll() {
  const invalid=[...$('form[data-auth-form]').querySelectorAll('input:not(:disabled)')].filter(input=>!validate(input));
  if(invalid.length){message('Check the highlighted fields to continue.');invalid[0].focus();return false;}
  message('');return true;
 }
 function showField(name,visible) {
  const wrapper=$(`[data-auth-field="${name}"]`);wrapper.hidden=!visible;
  wrapper.querySelector('input').disabled=!visible;
  wrapper.querySelector('input').required=visible;
 }
 let strengthLibrary=null,strengthPending=false;
 function updateStrength() {
  const value=$('#a-password').value;
  if(mode==='signup' && method==='password' && !strengthLibrary && !strengthPending){
   strengthPending=true;
   import('./vendor/zxcvbn.js').then(()=>{strengthLibrary=window.zxcvbn;strengthPending=false;if(screen?.isConnected)updateStrength();}).catch(()=>{strengthPending=false;});
  }
  const estimate=strengthLibrary && value ? strengthLibrary(value,[$('#a-name').value,$('#a-email').value,'EliteBot']) : null;
  const level=estimate ? estimate.score : 0;
  $('.auth-strength-text').textContent=!value ? 'Use at least 12 characters' : estimate ? ['Very weak','Weak','Fair','Strong','Very strong'][level] : 'Checking strength…';
  $('.auth-strength-bars').querySelectorAll('span').forEach((bar,i)=>bar.classList.toggle('filled',i<level));
 }

 function orderControls() {
  if(!screen)return;
  const form=$('form[data-auth-form]'),secondary=$('.auth-secondary-zone'),zone=$('.auth-submit-zone');
  if(mobile.matches && zone.previousElementSibling!==secondary) form.insertBefore(secondary,zone);
  if(!mobile.matches && form.lastElementChild!==secondary) form.append(secondary);
 }
 mobile.addEventListener('change',orderControls);
 function updateUI({focusField=false,animate=true}={}) {
  if(!screen?.isConnected)return;
  screen.dataset.mode=mode;screen.dataset.method=method;screen.classList.remove('exiting');
  document.title=`${titles[mode]} · EliteBot`;
  $('#auth-title').textContent=titles[mode];$('#auth-description').textContent=descriptions[mode];
  const normal=['login','signup'].includes(mode);
  $('form[data-auth-form]').setAttribute('role',normal ? 'tabpanel' : 'form');
  $('.auth-mode-tabs').hidden=!normal;
  $('.auth-methods').hidden=!normal;
  $('.auth-password-path').hidden=!normal;
  $('.auth-secondary-zone').hidden=!normal;
  $('.auth-fields').hidden=mode==='enroll';
  $('.auth-mode-tab[data-mode="login"]').setAttribute('aria-selected',String(mode==='login'));
  $('.auth-mode-tab[data-mode="login"]').tabIndex=mode==='login' ? 0 : -1;
  $('.auth-mode-tab[data-mode="signup"]').setAttribute('aria-selected',String(mode==='signup'));
  $('.auth-mode-tab[data-mode="signup"]').tabIndex=mode==='signup' ? 0 : -1;
  $('.auth-method[data-method="email"]').setAttribute('aria-pressed',String(method==='email'));
  $('.auth-method[data-method="passkey"]').setAttribute('aria-pressed',String(method==='passkey'));
  $('.auth-password-fallback').textContent=method==='password' || method==='sso' ? 'Use an email link instead' : 'Use a password instead';
  showField('name',mode==='signup');
  showField('email',!['reset','mfa','enroll'].includes(mode) && !(mode==='login' && method==='passkey'));
  showField('password',mode==='reset' || normal && method==='password');
  showField('confirm',mode==='reset');showField('code',mode==='mfa');
  $('#a-password').autocomplete=mode==='login' ? 'current-password' : 'new-password';
  $('.auth-password-hint').hidden=!(mode==='signup' && method==='password');
  $('.auth-forgot-row').hidden=!(mode==='login' && method==='password');
  $('.auth-passkey-copy').hidden=!(mode==='enroll' || mode==='login' && method==='passkey');
  $('.auth-method-note').hidden=!(mode==='signup' && method==='passkey' || mode==='login' && method==='sso');
  $('.auth-method-note').textContent=method==='sso' ? 'Use the email connected to your organization.' : 'First verify your email. Then save your passkey.';
  $('.auth-privacy-note').hidden=mode!=='login';
  $('.auth-back').hidden=normal || mode==='enroll';
  $('.auth-skip-enroll').hidden=mode!=='enroll';
  $('.auth-legal').innerHTML=mode==='signup' ? 'By continuing, you agree to our <a href="/terms" data-legal="/terms">Terms</a>, <a href="/privacy" data-legal="/privacy">Privacy</a> & <a href="/risk-disclosure" data-legal="/risk-disclosure">Risk Disclosure</a>.' : 'Protected account access. <a href="/privacy" data-legal="/privacy">Privacy policy</a>';
  const button=$('.auth-primary');
  button.dataset.label=({forgot:'Send recovery link',reset:'Save password',resend:'Send confirmation link',mfa:'Verify and continue',enroll:'Create passkey'})[mode] || 'Continue';
  if(!busy)button.textContent=button.dataset.label;
  $('.auth-success-panel').hidden=!confirmed;$('form[data-auth-form]').hidden=confirmed;
  if(animate){$('.auth-fields').classList.remove('auth-reveal');void $('.auth-fields').offsetWidth;$('.auth-fields').classList.add('auth-reveal');}
  orderControls();updateStrength();
  if(focusField){const input=[...$('form[data-auth-form]').querySelectorAll('input:not(:disabled)')].find(el=>!el.closest('[hidden]'));input?.focus({preventScroll:true});}
 }
 function setMode(next,{url=true,focusField=false,force=false}={}) {
  if(busy && !force)return;
  if(force)setBusy(false);
  mode=next;confirmed=false;message('');
  if(!['login','signup'].includes(mode))method='email';
  if(url){const path=({signup:'/signup',forgot:'/forgot-password',reset:'/reset-password',resend:'/resend-confirmation',enroll:'/passkey-setup'})[mode] || '/login';history.pushState(null,'',path);previousPath=path;}
  for(const input of $('form[data-auth-form]').querySelectorAll('input'))setError(input,'');
  updateUI({focusField});announce(`${titles[mode]} ${descriptions[mode]}`);
 }
 function setMethod(next) {
  if(busy)return;method=next;confirmed=false;message('');
  updateUI();announce(next==='password' ? 'Password sign-in selected.' : next==='passkey' ? 'Passkey selected.' : 'Email link selected.');
 }
 function setBusy(value,label='Continuing') {
  busy=value;
  const form=$('form[data-auth-form]');form.setAttribute('aria-busy',String(value));
  form.querySelectorAll('button').forEach(button=>button.disabled=value);
  $('.auth-mode-tabs').querySelectorAll('button').forEach(button=>button.disabled=value);
  if(value){$('.auth-primary').innerHTML=`<span class="auth-spinner" aria-hidden="true"></span><span class="auth-sr-only">${escape(label)}…</span>`;announce(`${label}…`);}
  else{$('.auth-primary').textContent=$('.auth-primary').dataset.label;setCooldown();}
 }
 function setCooldown() {
  clearTimeout(cooldownTimer);
  if(!screen?.isConnected || busy)return;
  const remaining=Math.ceil((cooldownUntil-Date.now())/1000);
  if(remaining>0){$('.auth-primary').disabled=true;$('.auth-primary').textContent=`Try again in ${remaining}s`;cooldownTimer=setTimeout(setCooldown,1000);}
  else{$('.auth-primary').disabled=false;$('.auth-primary').textContent=$('.auth-primary').dataset.label;}
 }
 function showConfirmation(title,copy,email='') {
  confirmed=true;lastEmail=email;
  $('.auth-success-title').textContent=title;$('.auth-success-status').textContent='';
  $('.auth-success-copy').innerHTML=copy.replace('{email}',`<strong>${escape(email)}</strong>`);
  $('.auth-resend-link').hidden=!['login','signup','resend'].includes(mode);
  $('.auth-success-panel').hidden=false;$('form[data-auth-form]').hidden=true;
  $('.auth-success-title').focus({preventScroll:true});announce(`${title} ${copy.replace('{email}',email)}`);
 }
 function errorCopy(error) {
  if(error.name==='NotAllowedError' || error.name==='AbortError')return 'Passkey cancelled. Try again or use email.';
  if(error.name==='SecurityError')return 'Passkeys aren’t available on this address. Use email.';
  if(error.status===429 || /rate.limit|too many|over_.*rate|after \d+ seconds/i.test(error.message+' '+error.code)){
   const seconds=Number(error.retryAfter) || Number(error.message?.match(/after (\d+) seconds/i)?.[1]) || 30;
   cooldownUntil=Date.now()+Math.min(Math.max(seconds,1),900)*1000;
   return `Too many attempts — try again in ${Math.ceil((cooldownUntil-Date.now())/1000)}s.`;
  }
  if(/mfa_verification_failed|invalid.*code/i.test(error.code+' '+error.message))return 'That code wasn’t accepted. Try a fresh code.';
  if(/passkey_disabled/.test(error.code+' '+error.message))return 'Passkey sign-in is unavailable. Use email or password.';
  if(/webauthn_credential_not_found|webauthn_verification_failed/.test(error.code+' '+error.message))return 'We couldn’t verify that passkey. Try email instead.';
  if(/webauthn_challenge/.test(error.code+' '+error.message))return 'That passkey request expired. Please try again.';
  if(/invalid.login|invalid.credentials|not found|user.*exist|already.*registered|email.not.confirmed/i.test(error.message+' '+error.code))return mode==='signup' ? 'We couldn’t continue. Check your details or try signing in.' : 'We couldn’t sign you in. Check your details or reset your password.';
  if(/sso_provider|sso.*domain/i.test(error.message+' '+error.code))return 'Work sign-in isn’t available for this domain. Use email.';
  if(/failed to fetch|network|load failed/i.test(error.message))return 'Connection lost. Check your internet and try again.';
  if(/password|recovery link|request expired|two-factor/i.test(error.message))return error.message;
  if(error.name==='TimeoutError')return 'That request took too long. Please try again.';
  return 'We couldn’t complete that request. Please try again.';
 }
 const redirect = intent => `${location.origin}/login?intent=${encodeURIComponent(intent)}${returnTo?.() === '/ebook' ? '&next=/ebook' : ''}`;
 async function passkey(registration=false) {
  if(!window.isSecureContext || !window.PublicKeyCredential)throw Object.assign(new Error('Passkey unavailable'),{name:'SecurityError'});
  const kind=registration ? 'registration' : 'authentication';
  const token=registration ? await getSession() : '';
  const options=await request(`passkeys/${kind}/options`,'POST',{},token);
  abort=new AbortController();
  const credential=await navigator.credentials[registration ? 'create' : 'get']({publicKey:credentialOptions(options.options,registration),signal:abort.signal});
  if(!credential)throw Object.assign(new Error('Passkey cancelled'),{name:'NotAllowedError'});
  const result=await request(`passkeys/${kind}/verify`,'POST',{challenge_id:options.challenge_id,credential:serializeCredential(credential)},token);
  abort=null;return result;
 }
 async function sendEmail(email,{again=false}={}) {
  const signup=mode==='signup';
  const intent=signup && method==='passkey' ? 'passkey' : signup ? 'signup' : 'signin';
  try {
   await request(`otp?redirect_to=${encodeURIComponent(redirect(intent))}`,'POST',{email,create_user:signup,data:signup ? {full_name:$('#a-name').value.trim(),referral_code:new URLSearchParams(location.search).get('ref') || ''} : {}});
  } catch(error) {
   // Never distinguish a missing account from an eligible account in email-link UI.
   if(!(error.status===400 || error.status===422) || !/signup.*disabled|user.*not.*found|otp.*disabled|not.*exist/i.test(error.code+' '+error.message))throw error;
  }
  cooldownUntil=Date.now()+60000;
  showConfirmation(again ? 'A fresh link is on its way.' : 'Check your inbox.',signup ? 'Open the secure link sent to {email} to finish setting up your account.' : 'If this address has an account, a secure sign-in link is on its way to {email}.');
  lastEmail=email;
 }
 async function submit(event) {
  event.preventDefault();if(busy || Date.now()<cooldownUntil)return;
  if(!validateAll())return;
  const current=mode,currentMethod=method,mountedScreen=screen;
  const stillHere=()=>screen===mountedScreen && screen?.isConnected;
  const email=$('#a-email').value.trim(),password=$('#a-password').value;
  setBusy(true,currentMethod==='passkey' ? 'Waiting for your device' : 'Continuing');
  try {
   if(current==='forgot'){
    try{await request(`recover?redirect_to=${encodeURIComponent(location.origin+'/reset-password')}`,'POST',{email});}
    catch(error){if(error.status!==400 && error.status!==422)throw error;}
    showConfirmation('Recovery link requested.','If an account uses {email}, you’ll receive a recovery link. Check your inbox and spam folder.',email);return;
   }
   if(current==='resend'){
    await request(`resend?redirect_to=${encodeURIComponent(redirect('signin'))}`,'POST',{type:'signup',email});
    cooldownUntil=Date.now()+60000;showConfirmation('Confirmation requested.','If this address is awaiting confirmation, a fresh link is on its way to {email}.',email);return;
   }
   if(current==='reset'){if(stillHere())await onReset(password);return;}
   if(current==='mfa'){if(stillHere())await onMfa($('#a-code').value);return;}
   if(current==='enroll'){await passkey(true);if(stillHere())await onSession(null,'/subscription');return;}
   if(currentMethod==='sso'){
    const result=await request('sso','POST',{domain:email.split('@')[1],redirect_to:redirect(current==='signup' ? 'signup' : 'signin'),skip_http_redirect:true});
    const url=new URL(result.url);if(url.protocol!=='https:')throw new Error('Invalid sign-in address');
    location.assign(url.href);return;
   }
   if(current==='login' && currentMethod==='passkey'){const result=await passkey();if(stillHere())await onSession(result.session || result,'/mt5');return;}
   if(currentMethod!=='password'){await sendEmail(email);return;}
   const result=await request(current==='signup' ? `signup?redirect_to=${encodeURIComponent(redirect('signup'))}` : 'token?grant_type=password','POST',{
    email,password,...(current==='signup' ? {data:{full_name:$('#a-name').value.trim(),referral_code:new URLSearchParams(location.search).get('ref') || ''}} : {})
   });
   if(current==='signup' && !result.access_token){showConfirmation('Verify your email.','If this is a new account, open the confirmation link sent to {email}. Already registered? Sign in or reset your password.',email);return;}
   if(stillHere())await onSession(result,current==='signup' ? '/subscription' : '/mt5');
  }catch(error){if(stillHere())message(errorCopy(error));}
  finally{if(stillHere()){setBusy(false);}}
 }
 async function social(provider,button) {
  if(busy)return;
  if(provider==='work'){setMethod('sso');$('#a-email').focus();return;}
  message('');setBusy(true,`Opening ${provider==='apple' ? 'Apple' : 'Google'}`);
  try {
   if(!providers)providers=await request('settings','GET');
   if(!providers.external?.[provider]){message(`${provider==='apple' ? 'Apple' : 'Google'} sign-in is unavailable. Use email or password.`);return;}
   const url=new URL(`${config.supabaseUrl}/auth/v1/authorize`);
   url.searchParams.set('provider',provider);url.searchParams.set('redirect_to',redirect(mode==='signup' ? 'signup' : 'signin'));
   location.assign(url.href);
  }catch(error){message(errorCopy(error));}
  finally{if(screen?.isConnected)setBusy(false);button.focus({preventScroll:true});}
 }
 function openLegal(path,opener) {
  const doc=legal(path);if(!doc)return;
  returnFocus=opener;
  const dialog=$('.auth-sheet');
  dialog.innerHTML=`<div class="auth-sheet-heading"><h2 id="auth-sheet-title">${escape(doc.title)}</h2><button type="button" data-auth-action="close-sheet" aria-label="Close ${escape(doc.title)}">${svg('close')}</button></div><div class="auth-sheet-body"><p>${escape(doc.intro)}</p>${doc.sections.map(([title,body])=>`<section><h3>${escape(title)}</h3><p>${escape(body)}</p></section>`).join('')}</div>`;
  dialog.showModal();dialog.querySelector('button').focus();
 }
 function attach() {
  controller=new AbortController();const signal=controller.signal;
  screen.addEventListener('submit',event=>{if(event.target.matches('form[data-auth-form]'))submit(event);},{signal});
  screen.addEventListener('focusout',event=>{if(event.target.matches('input') && !busy)validate(event.target);},{signal});
  screen.addEventListener('input',event=>{if(event.target.id==='a-password')updateStrength();},{signal});
  screen.addEventListener('keydown',event=>{
   const tab=event.target.closest('.auth-mode-tab');
   if(tab && ['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
    event.preventDefault();const next=event.key==='Home' ? 'login' : event.key==='End' ? 'signup' : mode==='login' ? 'signup' : 'login';setMode(next);$(`[data-mode="${next}"]`).focus();
   }
  },{signal});
  screen.addEventListener('click',async event=>{
   const legalLink=event.target.closest('[data-legal]');
   if(legalLink && !event.ctrlKey && !event.metaKey && !event.shiftKey){event.preventDefault();event.stopPropagation();openLegal(legalLink.dataset.legal,legalLink);return;}
   const tab=event.target.closest('[data-mode]');if(tab?.classList.contains('auth-mode-tab')){setMode(tab.dataset.mode);return;}
   const option=event.target.closest('[data-method]');if(option?.classList.contains('auth-method')){setMethod(option.dataset.method);return;}
   const button=event.target.closest('[data-auth-action]');if(!button || button.disabled)return;
   const action=button.dataset.authAction;
   if(action==='theme'){onTheme();screen.querySelectorAll('.auth-theme-toggle').forEach(el=>{el.innerHTML=svg(document.body.classList.contains('light') ? 'moon' : 'sun');el.setAttribute('aria-label',`Switch to ${document.body.classList.contains('light') ? 'dark' : 'light'} theme`);});}
   if(action==='show'){const input=$(`#a-${button.dataset.field}`),visible=input.type==='password';input.type=visible ? 'text' : 'password';button.setAttribute('aria-label',`${visible ? 'Hide' : 'Show'} ${button.dataset.field==='confirm' ? 'confirm password' : 'password'}`);button.setAttribute('aria-pressed',String(visible));button.innerHTML=svg(visible ? 'eyeOff' : 'eye');}
   if(action==='fallback')setMethod(method==='password' || method==='sso' ? 'email' : 'password');
   if(action==='forgot')setMode('forgot',{focusField:true});
   if(action==='back'){if(mode==='mfa')onCancelMfa?.();setMode('login');$('#auth-title').focus({preventScroll:true});}
   if(action==='social')await social(button.dataset.provider,button);
   if(action==='close-sheet')$('.auth-sheet').close();
   if(action==='change-email'){confirmed=false;updateUI({focusField:true});}
   if(action==='resend-link'){
    if(Date.now()<cooldownUntil){$('.auth-success-status').textContent=`Request another link in ${Math.ceil((cooldownUntil-Date.now())/1000)}s.`;announce(`Request another link in ${Math.ceil((cooldownUntil-Date.now())/1000)} seconds.`);return;}
    button.disabled=true;
    try{if(mode==='resend' || mode==='signup' && method==='password'){await request(`resend?redirect_to=${encodeURIComponent(redirect('signup'))}`,'POST',{type:'signup',email:lastEmail});cooldownUntil=Date.now()+60000;announce('A fresh confirmation link has been requested.');button.textContent='Link requested';}else await sendEmail(lastEmail,{again:true});}
    catch(error){$('.auth-success-copy').textContent=errorCopy(error);}
    finally{button.disabled=false;}
   }
   if(action==='skip'){await onSession(null,'/subscription');}
   if(action==='demo'){button.disabled=true;try{await onDemo();}catch(error){message(errorCopy(error));}finally{button.disabled=false;}}
  },{signal});
  $('.auth-sheet').addEventListener('close',()=>returnFocus?.isConnected && returnFocus.focus({preventScroll:true}),{signal});
 }
 return {
  mount({path,wordmark,config:nextConfig,mfa=false}) {
   config=nextConfig;
   const next=mfa && path==='/login' ? 'mfa' : modePath(path);
   if(screen?.isConnected){
    if(path!==previousPath || next!==mode){previousPath=path;setMode(next,{url:false,force:true});}
    return;
   }
   controller?.abort();abort?.abort();clearTimeout(cooldownTimer);busy=false;confirmed=false;cooldownUntil=0;providers=null;mode=next;method='email';previousPath=path;
   root.innerHTML=`<main id="main" class="auth-experience" tabindex="-1">
    <aside class="auth-brand-panel" aria-label="About EliteBot">
     <a href="/" class="brand">${wordmark}</a>
     <div class="auth-brand-copy"><h2>Your strategy.<br>Your limits.<br><em>Your control.</em></h2><p>Your MT5 accounts, automation, and risk settings in one focused workspace.</p></div>
     ${geometry()}
     <div class="auth-proof"><span class="auth-proof-symbol">${svg('shield')}</span><div><strong>Your strategy. Your control.</strong><small>Built around your MT5 workflow.</small></div></div>
     <div class="auth-brand-foot"><span>Your Trading Bot</span><span>Trading involves risk.<br>Performance is not guaranteed.</span></div>
    </aside>
    <header class="auth-mobile-top"><a href="/" class="brand">${wordmark}</a>${themeToggle()}</header>
    <div class="auth-mobile-proof">Your strategy. Your control. Built for MT5.</div>
    <section class="auth-column" aria-labelledby="auth-title">
     <header class="auth-column-header"><span class="auth-security">${svg('shield')} Protected account access</span>${themeToggle()}</header>
     <div class="auth-form-wrap">
      <div class="auth-mode-tabs" role="tablist" aria-label="Account access"><button class="auth-mode-tab" id="auth-tab-login" role="tab" aria-controls="auth-form-panel" data-mode="login" type="button">Sign in</button><button class="auth-mode-tab" id="auth-tab-signup" role="tab" aria-controls="auth-form-panel" data-mode="signup" type="button">Create account</button><span class="auth-tab-line" aria-hidden="true"></span></div>
      <div class="auth-form-heading"><h1 id="auth-title" tabindex="-1"></h1><p id="auth-description"></p></div>
      <form data-auth-form id="auth-form-panel" aria-labelledby="auth-title" novalidate>
       <div class="auth-methods" role="group" aria-label="Passwordless options"><button type="button" class="auth-method" data-method="email">${svg('mail')} Email link</button><button type="button" class="auth-method" data-method="passkey">${svg('key')} Use a passkey</button></div>
       <div class="auth-password-path"><button type="button" class="auth-text-button auth-password-fallback" data-auth-action="fallback"></button></div>
       <div class="auth-fields">
        ${field('name','Full name','text','autocomplete="name" maxlength="64"')}
        ${field('email','Email address','email','autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254"')}
        ${field('password','Password','password','maxlength="128"')}
        <div id="a-password-hint" class="auth-password-hint"><span class="auth-strength-text">Use at least 12 characters</span><span class="auth-strength-bars" aria-hidden="true"><span></span><span></span><span></span><span></span></span></div>
        ${field('confirm','Confirm password','password','autocomplete="new-password" maxlength="128"')}
        ${field('code','Authenticator code','text','autocomplete="one-time-code" inputmode="numeric" maxlength="6"')}
       </div>
       <div class="auth-forgot-row"><button class="auth-text-button" type="button" data-auth-action="forgot">Forgot password?</button></div>
       <div class="auth-passkey-copy"><span>${svg('fingerprint')}</span><div><strong>Your device is your key.</strong><p>Use a fingerprint, face recognition, or your device PIN.</p></div></div>
       <p class="auth-method-note"></p>
       <p class="auth-error-summary" role="alert" aria-atomic="true"></p>
       <div class="auth-submit-zone"><button type="submit" class="auth-primary">Continue</button><p class="auth-legal"></p><button type="button" class="auth-text-button auth-back" data-auth-action="back">Back to sign in</button><button type="button" class="auth-text-button auth-skip-enroll" data-auth-action="skip">Continue without a passkey</button></div>
       <div class="auth-secondary-zone"><div class="auth-or">or continue with</div><div class="auth-sso"><button type="button" class="auth-sso-button" data-auth-action="social" data-provider="apple">${apple} Apple</button><button type="button" class="auth-sso-button" data-auth-action="social" data-provider="google">${google} Google</button><button type="button" class="auth-sso-button" data-auth-action="social" data-provider="work">${svg('work')} Work SSO</button></div><p class="auth-privacy-note">For your privacy, we don’t reveal whether an email has an account.</p>${config.demoMode ? '<button type="button" class="auth-text-button" data-auth-action="demo">Continue as Demo</button>' : ''}</div>
      </form>
      <section class="auth-success-panel" hidden><span class="auth-success-icon">${svg('mail')}</span><h2 class="auth-success-title" tabindex="-1"></h2><p class="auth-success-copy"></p><p class="auth-success-status" role="status"></p><div class="auth-success-actions"><button type="button" class="auth-text-button auth-resend-link" data-auth-action="resend-link">Send a fresh link</button><button type="button" class="auth-text-button" data-auth-action="change-email">Use a different email</button><button type="button" class="auth-text-button" data-auth-action="back">Back to sign in</button></div></section>
     </div>
     <footer class="auth-column-footer"><span>© ${new Date().getFullYear()} EliteBot</span><a href="/support">Need a hand?</a></footer>
    </section><div class="auth-live auth-sr-only" role="status" aria-live="polite" aria-atomic="true"></div><dialog class="auth-sheet" aria-labelledby="auth-sheet-title"></dialog>
   </main>`;
   screen=root.querySelector('.auth-experience');updateUI({animate:false});attach();
  },
  async fadeOut() {
   if(!screen?.isConnected)return;announce('You’re signed in. Opening your workspace.');screen.classList.add('exiting');
   if(!window.matchMedia('(prefers-reduced-motion:reduce)').matches)await new Promise(resolve=>setTimeout(resolve,200));
  },
  dispose(){controller?.abort();abort?.abort();clearTimeout(cooldownTimer);screen=null;}
 };
}

