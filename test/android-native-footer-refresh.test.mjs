import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const native = readFileSync('android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt','utf8');

test('native Home avoids duplicate subscription card while retaining billing navigation', () => {
  assert.doesNotMatch(native,/EliteBot subscription active/);
  assert.doesNotMatch(native,/View billing & payment history/);
  assert.match(native,/EliteBillingPage\(/);
  assert.match(native,/AccountRow\(Icons\.Default\.AccountBalanceWallet,"Subscription"/);
});

test('native signed-in pages expose one circular FAB above navigation for real backend reads', () => {
  assert.match(native,/if \(!keyboardOpen\) \{\s*FloatingActionButton\(/);
  assert.match(native,/Modifier\.align\(Alignment\.BottomEnd\)/);
  assert.match(native,/shape=CircleShape/);
  assert.match(native,/contentDescription="Refresh backend data"/);
  assert.match(native,/if \(refreshing\) return/);
  assert.match(native,/api\.refreshMember\(\)/);
  assert.match(native,/api\.accounts\(\)/);
  assert.match(native,/api\.botsOverview\(\)/);
  assert.match(native,/billingMethods=api\.paymentMethods\(\)/);
  assert.match(native,/if\s*\(!keyboardOpen && screen!="Claude Pro Bot"\)/);
  assert.doesNotMatch(native,/IconButton\(onClick=onRefresh/);
});
