# EliteTrade Native Android (Compose)

The main launcher activity is now **native Kotlin + Jetpack Compose**, not a WebView. The legacy Java WebView is retained in source solely for rollback/reference and is not launched.

## Backend integration
- GET /api/config provides the configured Supabase Auth endpoint and public publishable key.
- Supabase email/password sign-in uses a Bearer access token for the production `src/supabase-app.mjs` API. `POST /api/auth/supabase-session` checks account, MFA and device-verification status; it does not issue a legacy `elite_session` cookie.
- New or unrecognized devices must complete server-enforced eight-digit email device verification through `/api/auth/device/email` and `/api/auth/device/verify` before entering the authenticated app. The signed `__Host-elite_device` cookie is encrypted on Android with the Keystore.
- Accounts with an enrolled TOTP factor are not silently accepted at assurance level AAL1; until native TOTP screens are implemented, the user is directed to the existing web MFA flow.
- Authenticated GET /api/accounts and /api/bots supply account and bot states. No dummy prices, performance or balance are invented.
- Live bot controls use existing /api/bots/{id}/control. Confirm all operations through the server before updating the UI.
- Support uses the existing /api/support/workspace API.
- The existing web application, admin dashboard and backend are not modified by this Android-only change.

## Security and scope
Refresh tokens are encrypted through the device Android Keystore. Supabase bearer tokens are used for authenticated requests; the refresh token and the server-issued trusted-device cookie are encrypted at rest and reused across restarts. Neither a legacy `elite_session` cookie nor a local MFA bypass is accepted. No trading/provider secrets are bundled. Browsers and the native app continue to use the same secure server API.

## Build
Gradle 8.13, Android SDK 36, JDK 17, Kotlin 2.2.20, Compose BOM 2025.09.00.

```
cd android-native
gradle :app:assembleDebug
```

CI builds and attaches debug APKs. Signed release APK/AAB requires configured signing credentials and acceptance tests. Integration on physical Android devices, including successful authenticated Supabase sign-in, MT5 provider, and live support should be independently verified.

The native UI exposes server-authorized functionality only. If a gateway cannot verify quotes or bot execution, show unavailable/unknown rather than simulated data.
