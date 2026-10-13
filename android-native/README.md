# EliteTrade Native Android (Compose)

The main launcher activity is now **native Kotlin + Jetpack Compose**, not a WebView. The legacy Java WebView is retained in source solely for rollback/reference and is not launched.

## Backend integration
- GET /api/config provides the configured Supabase Auth endpoint and public publishable key.
- Supabase email/password sign-in is exchanged with POST /api/auth/supabase-session for a server-verified HttpOnly session cookie.
- Authenticated GET /api/accounts and /api/bots supply account and bot states. No dummy prices, performance or balance are invented.
- Live bot controls use existing /api/bots/{id}/control. Confirm all operations through the server before updating the UI.
- Support uses the existing /api/support/workspace API.
- The existing web application, admin dashboard and backend are not modified by this Android-only change.

## Security and scope
Refresh tokens are encrypted through the device Android Keystore. A server session cookie and CSRF token are held in app memory only; they are recreated after app restart from a refreshed Supabase token. No trading/provider secrets are bundled. Browsers and the native app continue to use the same secure server API.

## Build
Gradle 8.13, Android SDK 36, JDK 17, Kotlin 2.2.20, Compose BOM 2025.09.00.

```
cd android-native
gradle :app:assembleDebug
```

CI builds and attaches debug APKs. Signed release APK/AAB requires configured signing credentials and acceptance tests. Integration on physical Android devices, including successful authenticated Supabase sign-in, MT5 provider, and live support should be independently verified.

The native UI exposes server-authorized functionality only. If a gateway cannot verify quotes or bot execution, show unavailable/unknown rather than simulated data.
