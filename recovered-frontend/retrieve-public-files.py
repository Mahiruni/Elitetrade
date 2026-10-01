import concurrent.futures
import hashlib
import json
import mimetypes
import pathlib
import re
import subprocess
import urllib.parse
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent
BASE = 'https://elitebot.live'
ROOT.mkdir(parents=True, exist_ok=True)
records = []
external = set()
seen = set()
MAX_FILES = 180

def local_path(url):
    parsed = urllib.parse.urlsplit(url)
    path = parsed.path
    if path == '/':
        path = '/pages/home.html'
    elif not pathlib.PurePosixPath(path).suffix:
        path = '/pages' + path.rstrip('/') + '.html'
    return ROOT / path.lstrip('/')

def fetch(url):
    dest = local_path(url)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 0:
        proc = subprocess.CompletedProcess([], 0, '', '')
        status, mime, effective = '200', mimetypes.guess_type(dest.name)[0] or 'application/octet-stream', url
    else:
        proc = subprocess.run(['curl', '-L', '--max-time', '20', '--connect-timeout', '10', '-sS', '-w', '%{http_code}\n%{content_type}\n%{url_effective}', url, '-o', str(dest)], capture_output=True, text=True)
        output = proc.stdout.splitlines()
        status = output[0] if output else '000'
        mime = output[1] if len(output) > 1 else ''
        effective = output[2] if len(output) > 2 else url
    rec = {'url': url, 'effective_url': effective, 'status': status, 'content_type': mime, 'path': str(dest.relative_to(ROOT)), 'retrieved_at': datetime.now(timezone.utc).isoformat()}
    if dest.exists():
        data = dest.read_bytes()
        rec['bytes'] = len(data)
        rec['sha256'] = hashlib.sha256(data).hexdigest()
    else:
        data = b''
    if proc.returncode or status != '200':
        rec['error'] = proc.stderr.strip() or 'HTTP ' + status
        if dest.exists():
            dest.unlink()
        print('FAILED', status, url, flush=True)
        return rec, []
    print('OK', len(data), rec['path'], flush=True)
    if any(v in mime for v in ['javascript', 'text/', 'json', 'svg']) or dest.suffix in ['.js', '.css', '.html']:
        text = data.decode('utf-8', errors='replace')
        candidates = re.findall(r'''["'`](https?://[^"'`<>\s]+|(?:\./|/|assets/)[^"'`<>\s]+?\.(?:js|css|png|jpg|jpeg|svg|webp|ico|woff2|woff|json)(?:\?[^"'`<>\s]*)?)["'`]''', text)
        candidates += re.findall(r'''url\(["']?([^\)"'\s]+)["']?\)''', text)
        candidates += re.findall(r'''sourceMappingURL=([^\s]+)''', text)
        urls = []
        for candidate in candidates:
            candidate = candidate.replace('&amp;', '&')
            if candidate.startswith('data:'):
                continue
            absolute = urllib.parse.urljoin(BASE + '/', candidate) if candidate.startswith('assets/') else urllib.parse.urljoin(url, candidate)
            absolute = urllib.parse.urldefrag(absolute)[0]
            parts = urllib.parse.urlsplit(absolute)
            if parts.netloc != 'elitebot.live':
                external.add(absolute)
                continue
            if '..' in pathlib.PurePosixPath(parts.path).parts:
                continue
            if pathlib.PurePosixPath(parts.path).suffix.lower() not in ['.js', '.css', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.ico', '.woff2', '.woff', '.json', '.map']:
                continue
            urls.append(absolute)
        return rec, urls
    return rec, []

pending = [BASE + '/', BASE + '/assets/index-CELiIWTZ.js']
while pending and len(seen) < MAX_FILES:
    batch = sorted(set(pending) - seen)[:MAX_FILES - len(seen)]
    if not batch:
        break
    seen.update(batch)
    pending = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        results = list(executor.map(fetch, batch))
    for rec, urls in results:
        records.append(rec)
        pending.extend(u for u in urls if u not in seen)
    (ROOT / 'manifest.json').write_text(json.dumps({'origin': BASE, 'records': records, 'external_references': sorted(external)}, indent=2))

# Download public pages actually named by the retrieved route definitions.
entry = ROOT / 'assets/index-CELiIWTZ.js'
client = entry.read_text() if entry.exists() else ''
public = ['login', 'signup', 'forgot-password', 'reset-password', 'support', 'subscribe']
batch = [BASE + '/' + route for route in public if '/' + route in client and BASE + '/' + route not in seen]
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    for rec, urls in executor.map(fetch, batch):
        records.append(rec)
(ROOT / 'manifest.json').write_text(json.dumps({'origin': BASE, 'records': records, 'external_references': sorted(external)}, indent=2))
print('COMPLETE', len(records), 'resources,', sum(r.get('bytes', 0) for r in records), 'bytes', flush=True)
