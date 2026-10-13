import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const file = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('true-black skin is loaded last and scoped to dark mode', () => {
  const html = file('../public/index.html');
  const css = file('../public/true-black.css');
  assert.match(html, /href="\/true-black\.css"/);
  assert.ok(html.indexOf('href="/true-black.css"') > html.indexOf('href="/mobile-premium.css"'));
  assert.match(css, /body:not\(\.light\)\s*\{[^}]*--bg:\s*#000000/s);
  assert.match(css, /body:not\(\.light\)\s+\.layout\s*\{/);
  assert.match(css, /--chat-bg:\s*#000000/);
  assert.match(css, /--premium-glass:\s*rgba\(10, 10, 10, \.90\)/);
  assert.doesNotMatch(css, /--(?:green|red|brand-primary|chat-gold):/);
});

test('Android uses a matching dark canvas and retains light-mode support', () => {
  const native = file('../android-native/app/src/main/java/com/elitetrade/android/NativeActivity.kt');
  const theme = file('../android-native/app/src/main/res/values/styles.xml');
  assert.match(native, /private val Night = Color\(0xFF000000\)/);
  assert.match(native, /private val Ink = Color\(0xFFFFFFFF\)/);
  assert.match(native, /getSharedPreferences\("elitetrade_appearance"/);
  assert.match(native, /val bg = if \(lightTheme\)/);
  assert.match(theme, /<item name="android:statusBarColor">#000000<\/item>/);
});

test('both HTTP application modes serve the true-black stylesheet with the correct MIME type', () => {
  for (const path of ['../src/app.mjs', '../src/supabase-app.mjs']) {
    const source = file(path);
    assert.match(source, /['"]\/true-black\.css['"]\s*:\s*\['true-black\.css','text\/css'\]/);
  }
});
