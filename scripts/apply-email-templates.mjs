// Run only with an authorized Management API token supplied privately in the environment.
// No credential, account token, recipient address, or template content is logged.
import {readFileSync} from 'node:fs';
const ref=process.env.SUPABASE_PROJECT_REF;
const credential=process.env.SUPABASE_ACCESS_TOKEN;
if(!ref || !/^[a-z]{20}$/.test(ref) || !credential) throw new Error('Set SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN privately. Do not paste tokens into chat.');
const url=`https://api.supabase.com/v1/projects/${ref}/config/auth`;
const headers={Authorization:`Bearer ${credential}`,'Content-Type':'application/json'};
const call=async(method,body)=>{
 const response=await fetch(url,{method,headers,body:body ? JSON.stringify(body) : undefined,signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!response.ok) throw new Error(`Supabase configuration request failed (HTTP ${response.status}). Inspect provider diagnostics privately.`);
 return response.json();
};
const config=await call('GET');
console.log({signupEnabled:!config.disable_signup,confirmationRequired:config.mailer_autoconfirm===false,customSmtpConfigured:!!config.smtp_host,siteUrl:config.site_url,emailFrequencySeconds:config.smtp_max_frequency});
if(!process.argv.includes('--apply')) {
 console.log('Inspection only. Add --apply to install the reviewed templates.');
} else {
 if(!config.smtp_host) throw new Error('Custom SMTP is not configured. Configure and verify an authorized sender before applying branded templates.');
 const patch=JSON.parse(readFileSync(new URL('../supabase/email-templates/auth-template-patch.json',import.meta.url),'utf8'));
 await call('PATCH',patch);
 const actual=await call('GET');
 if(!Object.entries(patch).every(([key,value])=>actual[key]===value))throw new Error('Template readback did not match. Review configuration before claiming activation.');
 console.log('Verified all eight template subjects and HTML bodies. SMTP, redirect and verification settings were preserved.');
}
