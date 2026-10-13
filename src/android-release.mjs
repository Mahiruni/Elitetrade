/**
 * Official signed Android APK discovery. Treat GitHub release data as untrusted
 * until asset name, release tag, download origin, digest, and size are validated.
 */
const ENDPOINT = 'https://api.github.com/repos/Mahiruni/Elitetrade/releases/latest';
const REPO = 'https://github.com/Mahiruni/Elitetrade';
const ASSET = 'elitetrade-release.apk';

export function validateAndroidRelease(metadata) {
  if (!metadata || metadata.draft || metadata.prerelease) throw Error('No published Android release.');
  const tag = String(metadata.tag_name || '');
  if (!/^android-v\d+\.\d+\.\d+$/.test(tag)) throw Error('Latest release is not an Android production build.');
  const assets = Array.isArray(metadata.assets) ? metadata.assets : [];
  const item = assets.find(asset => asset?.name === ASSET && asset?.state === 'uploaded');
  const expected = REPO + '/releases/download/' + tag + '/' + ASSET;
  if (!item || item.browser_download_url !== expected ||
      !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 100 * 1024 * 1024)
    throw Error('No verified production APK is available.');
  const sha256 = String(item.digest || '').match(/^sha256:([0-9a-f]{64})$/i)?.[1]?.toLowerCase();
  if (!sha256) throw Error('The APK is missing its published SHA-256 digest.');
  const publishedAt = Date.parse(metadata.published_at);
  if (!Number.isFinite(publishedAt) || publishedAt > Date.now() + 86400000)
    throw Error('The release date could not be verified.');
  return Object.freeze({
    tag,
    version:tag.slice('android-v'.length),
    downloadUrl:expected,
    releaseNotesUrl:REPO + '/releases/tag/' + tag,
    sha256,
    sizeBytes:item.size,
    publishedAt:new Date(publishedAt).toISOString(),
    minAndroidApi:26, // Android minSdk 26 in android-native/app/build.gradle.
    stale:false
  });
}

export function createAndroidReleaseService({fetcher = globalThis.fetch, clock = () => Date.now(), ttlMs = 300000} = {}) {
  let cached = null;
  let expires = 0;
  let pending = null;
  async function getLatest() {
    if (cached && clock() < expires) return cached;
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetcher(ENDPOINT, {
          headers:{Accept:'application/vnd.github+json','User-Agent':'EliteTrade-Android-Release-Discovery'},
          signal:AbortSignal.timeout(8000)
        });
        if (!response?.ok) throw Error('Release service unavailable.');
        const verified = validateAndroidRelease(await response.json());
        cached = verified;
        expires = clock() + ttlMs;
        return verified;
      } catch (error) {
        if (cached) return {...cached,stale:true};
        throw Error('The signed Android download is temporarily unavailable.',{cause:error});
      } finally { pending = null; }
    })();
    return pending;
  }
  return {getLatest};
}
