# EliteTrade transactional email templates

Eight standalone, inline-styled HTML templates. Open the corresponding file, copy its complete contents, and paste it into Supabase Dashboard → Authentication → Emails → the matching template. Set the subject separately. Each preheader is already embedded in its HTML file.

| Template | HTML file | Recommended subject | Preheader |
| --- | --- | --- | --- |
| Confirm sign up | 01-confirm-signup.html | Confirm your email for EliteTrade | One confirmation to finish creating your EliteTrade account. |
| Magic link or OTP | 02-magic-link.html | Your secure EliteTrade sign-in link | Use your secure link or verification code to continue. |
| Reset password | 03-reset-password.html | Reset your EliteTrade password | Choose a new password using your secure recovery link. |
| Change email address | 04-change-email.html | Confirm your new EliteTrade email address | Confirm the request to update your sign-in email address. |
| Invite user | 05-invite-user.html | You’re invited to EliteTrade | Accept your invitation and set up your EliteTrade account. |
| Password changed | 06-password-changed.html | Your EliteTrade password was changed | A password change was completed. Review it if this was not you. |
| Email address changed | 07-email-changed.html | Your EliteTrade email address was changed | Your sign-in email was updated. Review it if this was not you. |
| Reauthentication | 08-reauthentication.html | Your EliteTrade verification code | Enter this one-time code to confirm the action you requested. |

Alternative subjects and template keys are included in subjects.json.

## Supabase behavior

- Authentication action buttons and their fallback links use the exact `{{ .ConfirmationURL }}`. Application callbacks and token handling stay under Supabase's control.
- Magic link or OTP includes both the sign-in link and `{{ .Token }}`. New-browser sign-in emails are sent using this slot, not the separate Reauthentication slot.
- Reauthentication displays `{{ .Token }}`. Its return button uses `{{ .SiteURL }}` and does not verify the code or approve an action. Enter the code on the screen where the verification was requested.
- `{{ .NewEmail }}` appears only in Change email address. Email address changed uses `{{ .Email }}` for the updated address. No unlisted variables are used.
- Password changed and Email address changed notifications require their respective notification switches to be enabled. Their buttons open `{{ .SiteURL }}`; notification messages do not contain confirmation links.
- Code length and expiration are controlled by project settings. The copy intentionally avoids a fixed digit count or expiration duration. It accommodates the project's existing eight-digit email codes.
- With secure email change enabled, confirmations can be required from both addresses. The change-email copy works for either confirmation request.
- The footer uses the requested `https://elitetradebot.com` domain and `support@elitetradebot.com`. Account-return and wordmark links use the configured Supabase Site URL.

## Design and compatibility

- Fluid, centered 580px maximum card; single-column presentation tables; inline CSS only.
- System font stack. No external images, scripts, fonts, style blocks, media queries, or tracking pixels.
- Navy background `#0B1018`, card `#121B2A`, white `#F4F6FB`, body `#C2CCD9`, muted `#A4B0C2`, and amber `#E8BA67`.
- High-contrast full-width action buttons, readable literal fallback URLs, and long-address wrapping.
- An Outlook conditional wrapper supplies the desktop width; rounded corners gracefully appear square in older Word-based Outlook clients.
- A hidden preheader is included in every file. Footer support and website links are present in all eight files.

Visual previews use fictional addresses and inert sample links. They do not contain live tokens or account information. Static layout rendering is not a guarantee of identical rendering in every email client; send test messages to your target Gmail, Outlook, and Apple Mail clients before rollout.

These files are generated templates. This pack does not change live Supabase settings, send emails, or activate browser verification.

## Primary documentation checked

- https://supabase.com/docs/guides/auth/auth-email-templates
- https://supabase.com/docs/guides/local-development/customizing-email-templates
- https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier
