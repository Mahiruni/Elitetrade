import {readFileSync,writeFileSync} from 'node:fs';
import {renderTransactionalEmail} from '../src/transactional-email.mjs';
const dir=new URL('../supabase/email-templates/',import.meta.url);
const subjects=JSON.parse(readFileSync(new URL('subjects.json',dir),'utf8'));
const content={
 confirmation:{title:'One step to your account.',eyebrow:'CONFIRM YOUR EMAIL',paragraphs:['You requested an EliteTrade account using {{ .Email }}. Confirm your email address to finish registration.','Open the link in your browser. Once confirmed, sign in to EliteTrade on the website or return to the Android app.'],action:'Confirm email address',notice:'If you did not request this account, ignore this email. Only confirm a registration you started.'},
 magic_link:{title:'Your sign-in link is ready.',eyebrow:'ACCOUNT ACCESS',paragraphs:['A sign-in link was requested for your EliteTrade account. Use the button below to continue.','If your screen asks for a verification code, enter the code below on that screen.'],action:'Continue to EliteTrade',code:'{{ .Token }}',notice:'If you did not request this message, ignore it. Never share this link or code.'},
 recovery:{title:'Choose a new password.',eyebrow:'ACCOUNT RECOVERY',paragraphs:['A password reset was requested for your EliteTrade account. Use the button below to choose a new password.','Open the link in your browser. After saving your password, sign in again on the website or in the Android app.'],action:'Reset password',notice:'If you did not request this reset, ignore this email. Your password remains unchanged unless you complete the reset.'},
 email_change:{title:'Confirm your email change.',eyebrow:'ACCOUNT DETAILS',paragraphs:['You requested to change the sign-in email for your EliteTrade account to {{ .NewEmail }}.','Confirm only if you requested this change. Depending on your security settings, approval from both addresses may be required.'],action:'Confirm email change',notice:'If you did not request this change, do not confirm it. Open EliteTrade directly and contact support.'},
 invite:{title:'You’re invited to EliteTrade.',eyebrow:'ACCOUNT INVITATION',paragraphs:['You have been invited to create an EliteTrade account. Accept the invitation to continue setting up your account.'],action:'Accept invitation',notice:'If you were not expecting this invitation, you can ignore this email.'},
 password_changed_notification:{title:'Your password was changed.',eyebrow:'SECURITY NOTICE',paragraphs:['The password for your EliteTrade account was changed.','If you made this change, no further action is needed.'],action:'Review your account',notice:'If you did not make this change, open EliteTrade directly, reset your password, and contact support.'},
 email_changed_notification:{title:'Your email address changed.',eyebrow:'SECURITY NOTICE',paragraphs:['Your EliteTrade sign-in email was changed from {{ .OldEmail }} to {{ .Email }}.','If you requested and confirmed this change, no further action is needed.'],action:'Review your account',notice:'If you did not make this change, open EliteTrade directly and contact support immediately.'},
 reauthentication:{title:'Confirm it’s you.',eyebrow:'VERIFY YOUR IDENTITY',paragraphs:['Use this one-time code on the screen where you requested verification.','The button below returns to EliteTrade. It does not approve the action or verify this code.'],code:'{{ .Token }}',action:'Return to EliteTrade',notice:'If you did not request this code, ignore this email. Never share verification codes with anyone.'}
};
const patch={};
for(const spec of subjects){
 const email=renderTransactionalEmail({...spec,...content[spec.template_key],link:spec.primary_link});
 writeFileSync(new URL(spec.filename,dir),email.html+'\n');
 writeFileSync(new URL(spec.filename.replace('.html','.txt'),dir),email.text+'\n');
 patch['mailer_subjects_'+spec.template_key]=spec.subject;
 patch['mailer_templates_'+spec.template_key+'_content']=email.html;
}
// This payload contains templates only; SMTP, verification and redirect settings are untouched.
writeFileSync(new URL('auth-template-patch.json',dir),JSON.stringify(patch,null,2)+'\n');
console.log(`Generated ${subjects.length} HTML/plain-text templates and a Management API patch.`);
