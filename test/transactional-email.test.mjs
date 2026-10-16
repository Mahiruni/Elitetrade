import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderTransactionalEmail} from '../src/transactional-email.mjs';
const base={subject:'Reset your password',preheader:'Account recovery',title:'Choose a password',link:'https://elitetradee.vercel.app/reset-password?token=test&kind=recovery',paragraphs:['A reset was requested.'],notice:'Ignore if not requested.'};
test('email HTML escapes untrusted text while plain text remains readable',()=>{
 const mail=renderTransactionalEmail({...base,title:'<img src=x onerror=alert(1)>',paragraphs:['<script>bad</script>']});
 assert.ok(!mail.html.includes('<script>'));assert.ok(mail.html.includes('&lt;script&gt;'));
 assert.ok(mail.html.includes('token=test&amp;kind=recovery'));assert.ok(mail.text.includes('token=test&kind=recovery'));
});
test('email action URLs reject script schemes and embedded credentials',()=>{
 for(const link of ['javascript:alert(1)','https://user:pass@example.com/']) assert.throws(()=>renderTransactionalEmail({...base,link}));
});
test('generated Supabase templates retain provider tokens without fixed code lengths or invented expiry',()=>{
 const patch=JSON.parse(readFileSync(new URL('../supabase/email-templates/auth-template-patch.json',import.meta.url)));
 assert.equal(Object.keys(patch).length,16);
 for(const key of ['confirmation','magic_link','recovery','email_change','invite']) {
  const html=patch[`mailer_templates_${key}_content`];
  assert.ok(html.includes('href="{{ .ConfirmationURL }}"'));
  assert.ok(html.includes('https://elitetradee.vercel.app/support'));
  assert.ok(!html.includes('support@elitetradebot.com'));
 }
 assert.ok(patch.mailer_templates_magic_link_content.includes('{{ .Token }}'));
 assert.ok(patch.mailer_templates_reauthentication_content.includes('{{ .Token }}'));
 assert.ok(patch.mailer_templates_email_changed_notification_content.includes('{{ .OldEmail }}'));
 assert.ok(!patch.mailer_templates_recovery_content.includes('30 minutes'));
});
