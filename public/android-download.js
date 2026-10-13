/** Premium public Android download page. Server chooses and verifies the latest APK. */
export function androidDownloadPage(icon) {
  return `<div class="android-download-page">
  <section class="download-hero" aria-labelledby="android-download-title">
    <div class="download-hero-copy">
      <span class="download-eyebrow"><span class="download-live-dot" aria-hidden="true"></span> ELITETRADE MOBILE · OFFICIAL ANDROID RELEASE</span>
      <h1 id="android-download-title">Your Trading Workspace.<br><em>Wherever You Go.</em></h1>
      <p class="download-intro">Access your EliteBot dashboard, manage connected MT5 accounts, monitor activity, and stay connected to your trading workspace — right from your Android phone.</p>
      <div class="download-hero-actions">
        <a class="download-primary" href="/api/android-download" aria-label="Download the latest signed EliteTrade Android APK">${icon('download')} Download for Android</a>
        <a class="download-outline" href="https://github.com/Mahiruni/Elitetrade/releases" target="_blank" rel="noopener noreferrer">Official releases ${icon('arrow')}</a>
      </div>
      <p class="download-fineprint">Official signed APK · Android 8.0 or later · Android may require installation approval.</p>
      <p class="download-live-status" id="android-release-status" role="status" aria-live="polite">Checking the latest signed release…</p>
    </div>
    <aside class="download-release" aria-label="Official Android release details">
      <div class="download-release-top"><span>LATEST VERIFIED BUILD</span><span class="download-build-icon">${icon('shield')}</span></div>
      <div class="download-release-ident"><img src="/favicon.svg?v=eb1989" alt="EliteBot" width="92" height="52"><div><strong>EliteTrade for Android</strong><small>Production edition · Signed APK</small></div></div>
      <div class="download-version-line"><span>Version</span><strong data-release-version>Checking…</strong></div>
      <div class="download-version-line"><span>Package size</span><strong data-release-size>—</strong></div>
      <div class="download-version-line"><span>Published</span><strong data-release-date>—</strong></div>
      <div class="download-version-line"><span>Requirements</span><strong>Android 8.0+</strong></div>
      <div class="download-sha-box"><span>SHA-256 checksum</span><code data-release-sha>Waiting for release metadata</code></div>
      <a class="download-release-link" href="https://github.com/Mahiruni/Elitetrade/releases" target="_blank" rel="noopener noreferrer" data-release-notes>Release notes ${icon('arrow')}</a>
    </aside>
  </section>
  <section class="download-benefits" aria-labelledby="download-benefits-title">
    <div class="download-section-heading"><span class="download-kicker">YOUR WORKSPACE ON THE MOVE</span><h2 id="download-benefits-title">Everything connected. Nothing complicated.</h2></div>
    <div class="download-benefit-grid">
      <article><span class="download-benefit-icon">${icon('terminal')}</span><h3>MT5 account access</h3><p>Review your connected broker accounts and connection status from your phone.</p></article>
      <article><span class="download-benefit-icon">${icon('bots')}</span><h3>EliteBot controls</h3><p>Monitor your bot configuration and access authorized trading controls.</p></article>
      <article><span class="download-benefit-icon">${icon('shield')}</span><h3>Account-first security</h3><p>Sign in with your existing account and the same server-enforced security checks.</p></article>
    </div>
  </section>
  <section class="download-install" aria-labelledby="download-install-title">
    <div class="download-section-heading"><span class="download-kicker">GET STARTED</span><h2 id="download-install-title">Three steps. You're in.</h2></div>
    <ol class="download-install-steps">
      <li><span class="download-step-index">01</span><div><h3>Download</h3><p>Tap <strong>Download for Android</strong> to get the official signed APK.</p></div></li>
      <li><span class="download-step-index">02</span><div><h3>Install</h3><p>Open the downloaded file and follow Android's installation prompts.</p></div></li>
      <li><span class="download-step-index">03</span><div><h3>Open EliteTrade</h3><p>Launch the app and sign in securely with your existing account.</p></div></li>
    </ol>
  </section>
  <section class="download-updates" aria-labelledby="download-updates-title">
    <div class="download-update-mark">${icon('refresh')}</div>
    <div><span class="download-kicker">STAY CURRENT</span><h2 id="download-updates-title">Updates that stay with you.</h2><p>Future production APKs signed with the same key can update your installed EliteTrade app without uninstalling it. The native app checks for updates, and Android asks for approval before installing.</p></div>
    <a class="download-outline" href="/api/android-download">${icon('download')} Download official APK</a>
  </section>
  <section class="download-support" aria-label="Download help">
    <details><summary>Download stuck or failed? ${icon('arrow')}</summary><p>Some in-app browsers have trouble saving APK files. Try Chrome or use the GitHub CLI in Termux:</p><pre><code>gh release download -R Mahiruni/Elitetrade --pattern "elitetrade-release.apk" --dir "$HOME/storage/downloads"</code></pre><p>Check the downloaded file against the SHA-256 checksum above. Or open <a href="https://github.com/Mahiruni/Elitetrade/releases" target="_blank" rel="noopener noreferrer">official GitHub Releases</a>.</p></details>
    <details><summary>Will I need to uninstall my current app? ${icon('arrow')}</summary><p>Signed production editions update in place when the app ID and signing certificate match. Older CI debug APKs use a different app identity and require a one-time installation of the signed production edition. Verify any unsynced data before removing a debug installation.</p></details>
    <details><summary>Can I install this APK on iPhone? ${icon('arrow')}</summary><p>No. Android APKs do not run on iOS. Use the responsive EliteTrade website on iPhone or iPad.</p></details>
  </section></div>`;
}

export function androidHomepageBanner(icon) {
  if (!/Android/i.test(navigator.userAgent) || location.pathname !== '/') return '';
  try { if (sessionStorage.getItem('elite-android-promo-dismissed') === '1') return ''; } catch {}
  return `<aside class="android-mobile-promo" aria-label="EliteTrade Android application">
    <span class="android-mobile-promo-icon">${icon('download')}</span>
    <div><strong>EliteTrade for Android</strong><small>Your trading workspace on your phone.</small></div>
    <a href="/api/android-download" aria-label="Download signed EliteTrade APK">Download ${icon('arrow')}</a>
    <button type="button" class="android-mobile-promo-dismiss" aria-label="Dismiss Android download suggestion">${icon('close')}</button>
  </aside>`;
}

export async function hydrateAndroidRelease() {
  const page = document.querySelector('.android-download-page');
  if (!page) return;
  const status = page.querySelector('#android-release-status');
  const set = (selector,value) => {
    const node = page.querySelector(selector);
    if (node) node.textContent = value;
  };
  try {
    const res = await fetch('/api/android-release',{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if (!res.ok) throw Error('Release unavailable');
    const item = await res.json();
    if (!/^android-v\d+\.\d+\.\d+$/.test(item.tag) ||
        !/^[a-f0-9]{64}$/.test(item.sha256) ||
        !Number.isSafeInteger(item.sizeBytes) ||
        item.downloadUrl !== 'https://github.com/Mahiruni/Elitetrade/releases/download/' + item.tag + '/elitetrade-release.apk')
      throw Error('Unverified release');
    set('[data-release-version]','v' + item.version + (item.stale?' · last verified':''));
    set('[data-release-size]',(item.sizeBytes/1000000).toFixed(2) + ' MB');
    set('[data-release-date]',new Date(item.publishedAt).toLocaleDateString('en-US',{day:'numeric',month:'short',year:'numeric'}));
    set('[data-release-sha]',item.sha256);
    const notes=page.querySelector('[data-release-notes]');
    if(notes)notes.href='https://github.com/Mahiruni/Elitetrade/releases/tag/' + item.tag;
    if(status)status.textContent=item.stale?'Showing the most recently verified signed release.':'Latest signed production release verified with GitHub metadata.';
  } catch {
    set('[data-release-version]','Temporarily unavailable');
    if(status)status.textContent='Could not check the signed release right now. Please retry or view official GitHub releases.';
  }
}
