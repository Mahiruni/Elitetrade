# EliteBot account access

The authentication surface uses Instrument Serif for display text and the variable DM Sans face for labels, input text, and controls. Fonts are self-hosted, with DM Sans optical sizing enabled. The EliteBot text wordmark and small Your Trading Bot tagline are preserved.

Email and password are the default on both /login and /signup. Both fields appear immediately, including when returning from password recovery or confirmation screens. Recognized browsers open the workspace after password sign-in and any required MFA. Email-link access remains an explicit alternative. One-time new-account confirmation stays enabled in Supabase.

## Recovery and unfamiliar browsers

- Forgot password sends the existing single-use recovery link. Successful reset clears the application session and returns to password sign-in.
- Forgot email opens /forgot-email with a public support link. Support must verify ownership before changing the sign-in email; this flow never reveals whether another person's address has an account.
- With browser enforcement active, a password session from an unfamiliar browser opens /verify-device and requests an email to the authenticated account address. A secure email link or the eight-digit email code approves the browser. Authenticator codes remain six digits. The return destination is limited to /mt5, /subscription, or /ebook.
- A random 256-bit browser secret lives in a Secure, HttpOnly, SameSite=Lax cookie with the __Host- prefix on HTTPS. Only its SHA-256 digest is stored in private database tables. Browser approval lasts 90 days. Clearing cookies or using another browser/device requires verification again.
- Password and email changes revoke every remembered browser and session approval. Expired or deleted Auth sessions cannot obtain approval. Signed, recent Auth AMR evidence is required to approve a new browser; editable user_metadata is never evidence.
- MFA remains required wherever it was previously enabled. An email check cannot authorize a session that still needs MFA.
- The server forwards the secret to PostgREST from its cookie, ignoring device headers supplied by clients. Restrictive RLS and member/admin RPC wrappers enforce the same approval, including access to the purchased ebook.

### Activation status — October 3, 2026

The trusted-browser migration is applied. A fresh settings page confirms that custom SMTP is enabled and saved. The Magic link or OTP template is saved with the EliteBot verification link and code. The production site URL, /login and /reset-password callbacks, and all three exact new-browser callback URLs are configured. Email OTP length remains eight digits; the application and API now match that setting.

The rollout switch is **off** pending a delivery test to a user-designated registered account. Ordinary password access therefore remains available while delivery is verified. The setup checks read sender status only; SMTP credentials were not read or exported.

Before activation:

1. Use a registered account designated by the user for one explicitly authorized verification email. Confirm receipt and that its callback opens the correct production destination. The saved template is in docs/DEVICE_VERIFICATION_EMAIL.html.
2. After the matching deployment is ready and delivery works, enable `elitetrade_private.browser_auth_config.enforced`. No setting that disables signup email confirmation is needed.

Current validation: 74 Node tests passed, syntax/entrypoint checks passed for 37 JavaScript files, and transactional SQL checks passed for RLS/RPC guards, fresh/stale email evidence, metadata isolation, remembered/different browsers, MFA, expiry, password/email changes, and revoked sessions. All SQL fixtures rolled back and email-provider tests used an isolated HTTP service. These checks do not certify live email delivery. Older browser results below describe prior validation, not a rerun of this rollout.

## Frames and layout

- Desktop: 42% brand panel, 58% form column; form width at most 400px. Warm paper and graphite themes share the same geometry and hierarchy.
- Mobile: a slim wordmark bar and one product-proof line precede the form. The Continue action stays fixed at the bottom with a safe-area inset; reserved scroll space keeps fields and secondary controls reachable. The viewport asks supporting browsers to resize content when the keyboard opens.
- The brand grid moves on a 12-second drift. Tabs and field reveals use a 200ms ease-out. Reduced motion stops drift/reveal animations and removes the sign-in fade.
- The mobile proof line is factual product proof, not a fabricated customer count or testimonial. Replace it with verified customer proof only when available.

## Keyboard and focus

1. Skip to content, home wordmark, theme, selected mode tab, Email & password, Use a passkey, email-link alternative, visible fields, password visibility, recovery, and submission controls. Hidden fields are disabled and excluded from keyboard and form submission.
2. Mode tabs use a roving tab stop. Left/Right switch modes; Home selects Sign in and End selects Create account. Focus stays on the selected tab, and the existing email/password nodes and values are retained.
3. On desktop, Continue and legal links come before social providers. On mobile, the same secondary control nodes move before the pinned Continue zone so visual and keyboard order match.
4. Fields validate on blur. Submit validates all visible fields, announces the summary, and focuses the first invalid input. Each label uses a matching for/id; inline messages use aria-describedby and a live region.
5. The password toggle has an accurate Show/Hide label and aria-pressed. Strength estimation runs locally only during password sign-up. No password is sent to a strength service.
6. Legal links open native modal sheets containing the existing product policies. Native dialog focus containment applies; Escape closes the sheet and returns focus to the triggering link.
7. Successful password or passkey sign-in preserves the existing MFA check, then opens /mt5 with a 200ms fade. Password registration opens the existing subscription workflow after account creation.

## Component states

| State | Input | Primary action |
| --- | --- | --- |
| Default | 48px height, 12px radius, label above | Full width, 48px, Continue |
| Focus | Blue 2px ring, 3px offset | Blue 2px ring, 4px offset |
| Error | Inline alert icon, plain language, aria-invalid | Remains available after validation feedback |
| Disabled | Quiet neutral fill, readable text, no focus stop | Muted blue, disabled |
| Loading | Captured request values; input remains editable | Spinner replaces visible label, aria-busy, duplicate submit blocked |
| Success | Same surface shows email confirmation only for email flows | Password/passkey success opens the app |

Inline field messages reserve 24px and the error summary reserves 64px. Validation messages do not move the next input. The password meter uses a locally loaded zxcvbn estimator, is advisory, and appears only during sign-up. The existing 12-128 character password rule stays in place.

## Error copy and privacy

| Condition | Copy |
| --- | --- |
| Invalid email | Enter a valid email address. |
| Empty/short name | Use 2-64 characters for your name. |
| Missing sign-in password | Enter your password. |
| Short/long sign-up password | Use 12-128 characters. |
| Password mismatch | Your passwords don’t match. |
| Missing/incorrect account details, unconfirmed email | We couldn’t sign you in. Check your details or reset your password. |
| Rate limit | Too many attempts - try again in 30s. |
| Passkey prompt cancelled | Passkey cancelled. Try again or use email. |
| Passkey unavailable | Passkey sign-in is unavailable. Use email or password. |
| Network failure | Connection lost. Check your internet and try again. |

EliteBot deliberately uses neutral credential errors and a visible privacy explanation. It does not expose separate No account and Wrong password messages. Recovery uses the same conditional confirmation for an unknown address. Rate-limit countdowns use Retry-After when provided and disable the primary action until the interval expires.

## Passkey flow

- Returning member: choose Use a passkey, then Continue. Email is not required for discoverable credentials. Fetch a challenge, open the browser-owned fingerprint/face/PIN/security-key prompt, serialize the signed credential, verify with Supabase Auth, preserve MFA when required, and open the workspace.
- New member: choose Create account, then Use a passkey. Ask only for name and email, send a verification link, and explain that verification precedes passkey creation. The verified callback opens /passkey-setup. The authenticated registration ceremony creates the device credential; a recoverable skip path continues to the existing subscription page.
- Cancellation, timeout, unsupported browsers, disabled provider, or verification failure stay on the same surface with an email/password fallback. The UI never simulates a successful device ceremony. Native WebAuthn requires HTTPS or a supported loopback origin, and the provider’s relying-party ID/origins must match the site.

## Integration status

Password sign-in, sign-up, recovery, confirmation, session refresh, and MFA continue to use the existing Supabase adapter. Email-link requests use create_user=false during sign-in and true during sign-up. Apple and Google check the provider settings before redirecting; Work SSO discovers the organization through the entered email domain. Provider configuration has not been changed by this frontend redesign.

Read-only production verification on October 2, 2026 found email authentication enabled, email confirmation required, and Apple/Google disabled. The passkey challenge endpoint returned HTTP 404 with passkey_disabled, so passkeys are also disabled in the current project. Enable/configure a provider before offering its successful live sign-in path. Supabase passkey APIs are currently experimental, and enrollment requires an existing confirmed account.

## Verification

- All 57 existing server/service tests passed.
- Existing desktop/mobile browser journeys passed: registration, profile persistence, administration, payment activation, MT5 settings, bots, support, navigation, and themes.
- Dedicated authentication journeys passed: field/node preservation, blur validation with reserved space, focus restoration, legal sheets, neutral errors, 30-second Retry-After, duplicate-submit protection, email/recovery confirmations, password sign-in, provider fallbacks, and reduced motion.
- Virtual WebAuthn device registration and discoverable sign-in were exercised against an isolated adapter to verify native browser ceremonies and credential serialization. These do not certify a live provider configuration.
- Responsive layouts were checked at 320, 360, 390, 430, 768, 1024, 1440, and 1728px. 200% text enlargement was checked.
- Automated axe checks for WCAG A/AA, including 2.2 AA tags, found zero violations across the eight mode/theme/viewport reference frames. Manual screen-reader testing and a formal conformance audit remain outside that automated result.

## Implementation files

public/auth.js owns the mounted authentication UI and WebAuthn bridge. public/auth.css scopes the visual system to authentication. public/app.js supplies the existing session/MFA/policy adapters. Both server entrypoints explicitly serve the auth modules, fonts, password estimator, and passkey setup route. Existing business workflows remain in their current modules.

## Primary references

- https://supabase.com/docs/guides/auth/auth-email-passwordless
- https://supabase.com/docs/guides/auth/passkeys
- https://github.com/supabase/supabase-js/tree/master/packages/core/auth-js
- https://github.com/dropbox/zxcvbn
