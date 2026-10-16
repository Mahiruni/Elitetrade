# EliteTrade transactional emails

Eight authentication/security templates share `src/transactional-email.mjs`. The legacy local-auth password-reset mailer also uses this layout and includes both HTML and plain text. Supabase SMTP generates its own MIME envelope; the `.txt` files here are companion copy, not separately configurable hosted-auth settings.

Run `node scripts/build-email-templates.mjs` after changing copy or layout. Generated HTML, plain text, subjects and `auth-template-patch.json` are committed for review.

| Supabase slot | File | Action |
| --- | --- | --- |
| Confirm signup | 01-confirm-signup.html | Confirm email |
| Magic link / device OTP | 02-magic-link.html | Sign-in link and provider code |
| Password recovery | 03-reset-password.html | Set a new password in the browser |
| Email change | 04-change-email.html | Confirm requested email change |
| Invitation | 05-invite-user.html | Accept invitation |
| Password changed | 06-password-changed.html | Review account |
| Email changed | 07-email-changed.html | Review account |
| Reauthentication | 08-reauthentication.html | Enter provider code on requesting screen |

Notification templates require the corresponding provider switches. The template installer intentionally does not enable new notification triggers, modify SMTP, change redirects, or bypass verification. There are no application SMTP triggers for subscription, payment, support or welcome emails in this repository; no delivery claims or new unsupported triggers were added.

## Install in hosted Supabase

Committing these files does **not** activate them in hosted Supabase. Configure and verify custom SMTP first. New Free projects using default SMTP cannot customize templates under the June 2026 provider policy.

With a privately supplied authorized Management API token and project reference:

```sh
node scripts/apply-email-templates.mjs
node scripts/apply-email-templates.mjs --apply
```

The script reads `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` from the environment. Never commit or paste credentials. Inspection logs only nonsecret readiness fields. Application updates the sixteen subject/body fields, then reads them back to verify exact installation. Failure does not imply installation success. Alternatively paste each HTML file and matching subject from `subjects.json` into the Supabase email editor.

## Layout and behavior

- 600px fluid presentation-table layout; 16px body, 28px heading, full-width gold action.
- Official existing logo with readable text branding if images are disabled.
- Light body, charcoal header, dark-mode CSS with inline light-mode fallbacks.
- Outlook width wrapper and padding fallback; system fonts; no scripts, tracking or external fonts.
- Production support link; no unverified support mailbox or custom domain.
- Provider `ConfirmationURL` is preserved in both button and copyable link. Code length/expiry remain provider-controlled. Email-change notifications preserve `OldEmail` and `Email`.
- Browser confirmation/reset is the fallback for the current native app, which has no verified authentication app-link handler. Users return to native sign-in after finishing in their browser.

Browser rendering is a layout check, not proof of Gmail/Outlook/Apple Mail delivery or identical rendering. Test inbox receipt, headers and client rendering with authorized recipients after live installation. Do not retry token-generating emails automatically: replacement links can invalidate earlier messages.

Primary documentation: https://supabase.com/docs/guides/auth/auth-email-templates and https://supabase.com/docs/guides/auth/auth-smtp
