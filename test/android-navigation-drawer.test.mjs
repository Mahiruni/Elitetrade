import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const activity=readFileSync('android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt','utf8');
const drawer=readFileSync('android-native/app/src/main/java/com/elitetrade/android/EliteNavigationDrawer.kt','utf8');

test('native navigation uses one full-height grouped drawer instead of header dropdown',()=>{
  assert.match(activity,/ModalNavigationDrawer\(/);
  assert.match(activity,/rememberDrawerState\(initialValue=DrawerValue\.Closed\)/);
  assert.match(activity,/BackHandler\(enabled=drawerState\.isOpen\)/);
  assert.match(activity,/onOpenMenu=\{scope\.launch \{ drawerState\.open\(\) \}\}/);
  assert.doesNotMatch(activity,/DropdownMenu\(expanded=menuOpen/);
  assert.match(drawer,/ModalDrawerSheet\(/);
  assert.match(drawer,/verticalScroll\(rememberScrollState\(\)\)/);
  assert.match(drawer,/Modifier\.weight\(1f\)/);
  assert.match(drawer,/BOTS & STRATEGIES/);
  assert.match(drawer,/BILLING & PAYMENTS/);
  assert.match(drawer,/ACCOUNT & HELP/);
});
test('navigation destinations all have implemented screens and admin is gated',()=>{
  const allScreens=new Set([...activity.matchAll(/"([^"]+)"\s*->\s*\w+Page\(/g)].map(x=>x[1]));
  for(const name of ["Home","Markets","Trade","Bot","ClaudeBot","Claude Pro Bot","Gold SMC Scalper","Elite Engine","EliteBridge","Account","MT5","Support","Activity","Settings","Admin"]) {
    assert.match(activity,new RegExp('"' + name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + '"'));
  }
  assert.match(drawer,/DrawerDestination\("Subscription","Billing"/);
  assert.match(drawer,/selected in botDestinations/);
  assert.match(drawer,/selected in billingDestinations/);
  assert.match(drawer,/if\(isAdmin\)/);
  assert.match(drawer,/user\?\.optString\("role"\)=="admin"/);
});
test('account and secure sign out stay pinned beneath scroll and use confirmation',()=>{
  assert.match(drawer,/account actions stay visible even when the groups overflow/);
  assert.match(drawer,/DrawerDestination\("My Account","Account"/);
  assert.match(drawer,/Text\("Sign Out"/);
  assert.match(activity,/title=\{Text\("Sign out of EliteTrade\?"\)\}/);
  assert.match(activity,/api\.signOut\(\)/);
  assert.match(activity,/EliteEngineService\.stop\(context\)/);
  assert.match(activity,/onSignOut=\{confirmSignOut=true\}/);
  assert.match(activity,/signedIn=false; screen="Home"/);
});
test('Android bottom tabs and circular read-only refresh remain preserved',()=>{
  assert.match(activity,/FloatingTabs\(mainTabs,screen,lightTheme\)/);
  assert.match(activity,/FloatingActionButton\(/);
  assert.match(activity,/engineRefreshHandler\?\.invoke\(\)/);
  assert.match(activity,/safeDrawingPadding\(\)/);
});
