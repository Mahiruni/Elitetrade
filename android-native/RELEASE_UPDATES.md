# EliteTrade Android Update Channel

EliteTrade checks official signed Android releases on startup and offers an Update button in the app. It downloads through Android DownloadManager, checks the GitHub release SHA-256 digest, validates the installed app ID and signing certificate, and launches Android's normal installer. User installation approval cannot be bypassed.

## One-time signing setup — required before first release

**Do not send signing passwords or keystore contents in chat or commit them to the repository.**

On a trusted developer computer, create and securely back up a permanent keystore:

    keytool -genkeypair -v -keystore elitetrade-release.jks -alias elitetrade -keyalg RSA -keysize 3072 -validity 10000

Encode the binary JKS file as one continuous base64 string. Example Linux command:

    base64 -w 0 elitetrade-release.jks

Open GitHub repository Settings → Secrets and variables → Actions and configure four repository secrets:

- ELITETRADE_ANDROID_KEYSTORE_BASE64 — the full base64-encoded binary keystore
- ELITETRADE_ANDROID_KEYSTORE_PASSWORD — keystore password
- ELITETRADE_ANDROID_KEY_ALIAS — key alias, usually elitetrade
- ELITETRADE_ANDROID_KEY_PASSWORD — signing key password

Then manually start the GitHub Actions workflow named EliteTrade signed Android releases. It publishes the first official, signed production APK as a public GitHub Release. Once configured, updates to android-native/ on main automatically publish newer versioned signed APKs.

The workflow refuses to publish an unsigned APK if signing credentials are absent.

## One-time transition from existing debug APKs

Previous CI debug APKs use application ID com.elitetrade.android.debug and per-run debug signing keys. They **cannot** be updated in place to the production package com.elitetrade.android. Android prohibits such upgrades. Install the first signed production version alongside the debug app and sign in again. Check that any needed unsynced local data is backed up before deleting the debug app.

All subsequent signed production releases can install over the existing signed production app and preserve its app data when the app ID and keystore remain unchanged.

Never lose or regenerate the signing keystore between releases. Store a secure independent backup.

## Customer experience

- On app launch: checks the latest public GitHub Release API for an available update.
- When available: shows an update prompt with a Download & update action and a Later choice.
- Signed-in customers also see a banner; Account and Settings provide a Check for updates shortcut.
- Before installing: verifies published release checksum, package identity, higher version code, and matching signature.
- The user approves installation in Android. Android may request Allow from this source once for sideloaded upgrades.
- If there is no release, the app continues to work normally. Offline checks never prevent sign-in.

The release must be named android-v1.0.N and contain asset elitetrade-release.apk. The GitHub Release asset digest must be SHA-256. The updater ignores unexpected names and sources.

Google Play apps should use Play In-App Updates instead; sideloaded APKs need normal Android consent.

## Verification checklist

Install the initial signed production APK; publish another version using exactly the same keystore; tap Update on a physical Android device; verify no uninstall is requested and the app remains signed in. Also test offline launch, cancel, invalid checksum, and download failures. Never claim a real-device install was tested only because CI built an APK.
