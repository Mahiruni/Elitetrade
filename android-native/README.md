# EliteTrade — Android host (initial foundation)

This module adds a native Android shell for the existing server-hosted EliteTrade app. It is **not a complete native reimplementation**. Trading, authenticated data, realtime chat, security, and MT5 remain implemented and authorized by the existing live server. Never treat local WebView state as a trading authorization.

## Supported initial capabilities

- Android 8–16 API 26–36 Android Studio project (Android 16 target).
- Android 15/16 system status-bar, battery/clock, cutout, and keyboard inset protection.
- Isolated first-party HTTPS origin, no cleartext HTTP, no mixed content, and SSL errors fail closed.
- Website navigation/history and Android Back handling.
- Native Android document/image chooser for web file fields.
- External links open in the system browser; untrusted WebView origins are blocked.
- Readable offline/error recovery state; no fabricated or cached live trading information.
- No unnecessary background location service, risky downloads into public storage, or premature notification permissions.

## Build debug APK

Requires JDK 17, Android SDK 36, and Gradle 8.13. From this directory:

    gradle :app:assembleDebug

Build output: app/build/outputs/apk/debug/app-debug.apk

The CI workflow publishes the built **debug** APK to the run's Artifacts section only if the Android build succeeds.

The default origin is https://elitetradee.vercel.app (the current Git-connected deployment). Only after verifying domain ownership and the serving backend may you build against a custom domain:

    gradle :app:assembleDebug -PeliteTradeOrigin=https://elitebot.live

**Do not point the APK at a domain that serves a different frontend or account database.**

## Release signing

A production release APK/AAB is *not* signed or published by this module. Use a protected CI environment with securely managed signing keystore, passwords, and review gates after completing end-to-end authentication and MT5 verification. Never commit signing secrets.

## Release gates still required

- Verify real device login, signup, recovery, upload, and financial-account flows.
- Implement secure, permission-aware native push channels/deep links and biometric reauthentication where justified.
- Verify native file downloads and safe document storage with authenticated endpoints.
- Add app-link association / assetlinks.json only after obtaining release signing certificate SHA-256 and verifying the canonical domain.
- Validate tablet/foldable layouts, keyboard, Android gesture and three-button navigation.
- Finish release branding/launcher artwork review using the approved EliteBot asset.
- Verify production backend persistence/worker suitability; do not assume Vercel ephemeral storage is a persistent database.

This is a conservative foundation for an Android application, not a claim that release readiness or broker execution has been certified.
