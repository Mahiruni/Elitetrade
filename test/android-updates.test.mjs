import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = path => readFileSync(new URL(path, import.meta.url),'utf8');
const updater = file('../android-native/app/src/main/java/com/elitetrade/android/EliteUpdateManager.kt');
const activity = file('../android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt');
const manifest = file('../android-native/app/src/main/AndroidManifest.xml');
const gradle = file('../android-native/app/build.gradle');
const release = file('../.github/workflows/android-release.yml');

test('the native app offers check on launch, user consent, and an account shortcut', () => {
  assert.match(activity,/LaunchedEffect\(Unit\)[\s\S]*updater\.check\(\)/);
  assert.match(activity,/Download & update/);
  assert.match(activity,/Check for updates/);
  assert.match(activity,/showUpdateDialog/);
});

test('updates require official GitHub digest, package and signer validation', () => {
  assert.match(updater,/api\.github\.com\/repos\/Mahiruni\/Elitetrade\/releases\/latest/);
  assert.match(updater,/sha256:/);
  assert.match(updater,/sha !=|sum != update\.sha256/);
  assert.match(updater,/incoming\.packageName != activity\.packageName/);
  assert.match(updater,/signatures\(current\) != signatures\(incoming\)/);
  assert.match(updater,/canRequestPackageInstalls/);
  assert.match(updater,/FileProvider/);
  assert.match(updater,/isDebug\(\)/);
});

test('file sharing is restricted to app update directory and install requires approval', () => {
  assert.match(manifest,/REQUEST_INSTALL_PACKAGES/);
  assert.match(manifest,/android:exported="false"/);
  assert.match(manifest,/@xml\/update_file_paths/);
  const paths=file('../android-native/app/src/main/res/xml/update_file_paths.xml');
  assert.match(paths,/external-files-path/);
  assert.match(paths,/path="Download\/"/);
  assert.match(updater,/Intent\.ACTION_VIEW/);
});

test('signed releases increment version code and reject missing keystore secrets', () => {
  assert.match(gradle,/eliteTradeVersionCode/);
  assert.match(gradle,/eliteTradeVersionName/);
  assert.match(release,/ELITETRADE_ANDROID_KEYSTORE_BASE64/);
  assert.match(release,/ELITETRADE_ANDROID_KEYSTORE_PASSWORD/);
  assert.match(release,/ELITETRADE_ANDROID_KEY_ALIAS/);
  assert.match(release,/ELITETRADE_ANDROID_KEY_PASSWORD/);
  assert.match(release,/200000 \+ RELEASE_BUILD/);
  assert.match(release,/apksigner/);
  assert.match(release,/gh release create/);
});
