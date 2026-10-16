# Registration and email audit — 2026-10-16

## Verified production observations

- Intended project: Supabase `cgpvhayfwnpipktyltho`; Vercel `elitetradee`, team `team_AoSdFghTUd6VdeJiBNuaDEyV`.
- Public Auth settings: signup enabled, email provider enabled, automatic email confirmation disabled (verification required).
- The reported 05:21 UTC signup is logged as `user_repeated_signup`. Database inspection confirmed the owner's attempted address already had a verified account. Signup confirmation resends are inapplicable to an already-verified account. The generic 200 response intentionally protects account existence.
- Resend requests at 05:22 and 05:24 UTC returned 200. No matching SMTP/send-limit error was found in the available last-24-hour auth logs. This is not proof of delivery.
- One authorized recovery request to the owner's attempted address returned 200; the account's `recovery_sent_at` advanced to 05:27:45 UTC. Inbox receipt has not been observed. No password or account state was changed.
- Live SMTP credentials, sender identity, SPF/DKIM/DMARC, redirect allowlist, template bodies and cooldown configuration are not exposed by the connected Supabase MCP tools. No inference of correct delivery settings is made.

## Changes

- Registration/resend confirmations remain neutral for pending, unknown and verified addresses. They offer direct sign-in/password-reset recovery and never claim inbox delivery.
- Fixed missing email interpolation in email-link confirmation, and added a live countdown on the resend button, including the first password-signup request.
- Invalid/expired email callbacks, including reset callbacks, now route to the appropriate fresh-link screen and remove failed callback fragments from the URL.
- Native Android recovery now uses `recover?redirect_to=<production>/reset-password`; the previous body-only `/login` redirect was incorrect. Browser reset then native sign-in is the supported fallback; no verified app-link handler exists.
- Native confirmation adds password-reset navigation and resend countdown. These changes require a signed APK release.
- Shared email renderer, eight generated hosted-auth HTML/text templates, legacy reset HTML/text, and a guarded Management API installer with readback verification. Hosted templates still need installation in Supabase.
- Admin email status no longer hardcodes an unverified Supabase mail service as active.

## Delivery operations still requiring infrastructure access

Inspect SMTP/sender, actual provider message events, DNS alignment, rate configuration and production redirect allowlist. Install reviewed templates, test new signup with an explicitly authorized fresh address, check the actual inbox and complete verification/reset on website and Android. Do not disable confirmation or alter existing users to make tests pass.

Supabase advisors were inspected. Existing findings concern intentional private tables, guest-support security-definer functions, and disabled leaked-password protection. This change adds no tables, grants, RLS policies or authorization claims. These pre-existing findings were not modified as part of the email repair.

## Validation at implementation

- 354 Node tests pass, including pending/repeated signup, SMTP failure, escaping and safe email links, confirmation and recovery callback handling.
- Application build and JavaScript syntax checks pass.
- Browser automation initially blocked: no installed Chromium; Playwright browser archive download failed. No inbox or email-client rendering verification is claimed.
