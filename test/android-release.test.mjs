import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndroidReleaseService, validateAndroidRelease } from '../src/android-release.mjs';
import { createSupabaseApplication } from '../src/supabase-app.mjs';

const metadata = () => ({
  tag_name:'android-v1.0.5',draft:false,prerelease:false,
  published_at:'2026-10-13T18:33:15Z',
  assets:[{
    name:'elitetrade-release.apk',state:'uploaded',size:11779672,
    digest:'sha256:193eeed0a0a1fa74412dc3dbf043761cc9591f0493457a6e52ef7a638cfe4121',
    browser_download_url:'https://github.com/Mahiruni/Elitetrade/releases/download/android-v1.0.5/elitetrade-release.apk'
  }]
});

test('recognizes the verified published production Android APK', () => {
  const release=validateAndroidRelease(metadata());
  assert.equal(release.version,'1.0.5');
  assert.equal(release.sizeBytes,11779672);
  assert.equal(release.minAndroidApi,26);
  assert.match(release.sha256,/^[a-f0-9]{64}$/);
  assert.equal(release.downloadUrl,'https://github.com/Mahiruni/Elitetrade/releases/download/android-v1.0.5/elitetrade-release.apk');
});

test('rejects drafts, previews, malicious redirects, unsigned assets and wrong release names', () => {
  for (const edit of [
    x=>{x.draft=true;},
    x=>{x.prerelease=true;},
    x=>{x.tag_name='web-v1.0.5';},
    x=>{x.assets[0].browser_download_url='https://attacker.example/elitetrade-release.apk';},
    x=>{x.assets[0].digest='';},
    x=>{x.assets[0].size=0;},
    x=>{x.assets[0].state='deleted';},
    x=>{x.assets[0].name='elitetrade-debug.apk';}
  ]) {
    const sample=metadata();
    edit(sample);
    assert.throws(()=>validateAndroidRelease(sample));
  }
});

test('caches the latest official release and labels a verified last-good fallback', async () => {
  let calls=0,clock=10000,fail=false;
  const service=createAndroidReleaseService({
    clock:()=>clock,ttlMs:1000,
    fetcher:async () => {
      calls++;
      if(fail)throw Error('Rate limited');
      return {ok:true,json:async()=>metadata()};
    }
  });
  const first=await service.getLatest();
  assert.equal((await service.getLatest()).downloadUrl,first.downloadUrl);
  assert.equal(calls,1);
  fail=true;clock+=1500;
  const fallback=await service.getLatest();
  assert.equal(fallback.stale,true);
  assert.equal(fallback.downloadUrl,first.downloadUrl);
  assert.equal(calls,2);
});

test('first unverified fetch failure never supplies a fake download', async () => {
  const service=createAndroidReleaseService({fetcher:async()=>({ok:false,status:403})});
  await assert.rejects(service.getLatest(),/temporarily unavailable/);
});

test('public release API and latest APK link work without logging in', async t => {
  const serviceResponse={ok:true,json:async()=>metadata()};
  const app=createSupabaseApplication({
    androidReleaseFetcher:async()=>serviceResponse,
    gateway:null,telegram:null,deviceVerification:false,
    env:{APP_ORIGIN:'http://localhost:3000',NODE_ENV:'test'}
  });
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>app.close());
  const base='http://127.0.0.1:'+app.server.address().port;
  const result=await fetch(base+'/api/android-release');
  assert.equal(result.status,200);
  const release=await result.json();
  assert.equal(release.tag,'android-v1.0.5');
  assert.equal(release.sizeBytes,11779672);
  const redirect=await fetch(base+'/api/android-download',{redirect:'manual'});
  assert.equal(redirect.status,302);
  assert.equal(redirect.headers.get('location'),release.downloadUrl);
  const html=await fetch(base+'/download');
  assert.equal(html.status,200);
  assert.match(await html.text(),/EliteTrade for Android/);
  const js=await fetch(base+'/android-download.js');
  assert.equal(js.status,200);
  const css=await fetch(base+'/download.css');
  assert.equal(css.status,200);
});
