"""Build-time vendor download/extraction; accepts no broker credentials."""
import hashlib
import io
import json
from pathlib import Path
import sys
import urllib.parse
import urllib.request
import zipfile


def extract(artifact, destination):
    url = urllib.parse.urlparse(artifact["url"])
    if url.scheme != "https" or url.hostname not in ("www.python.org", "files.pythonhosted.org"):
        raise ValueError("Unapproved vendor origin")
    with urllib.request.urlopen(artifact["url"], timeout=90) as response:
        archive = response.read(100_000_001)
    if len(archive) > 100_000_000 or hashlib.sha256(archive).hexdigest() != artifact["sha256"]:
        raise ValueError("Vendor artifact digest/size mismatch")
    destination.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
        for member in zipped.infolist():
            path = destination / member.filename
            if not path.resolve().is_relative_to(destination.resolve()) or "\\" in member.filename:
                raise ValueError("Unsafe vendor archive path")
            if (member.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Vendor archive symlink rejected")
        zipped.extractall(destination)


def main():
    manifest = json.loads(Path(sys.argv[1]).read_text())
    root = Path(sys.argv[2])
    extract(manifest["python"], root)
    for wheel in manifest["wheels"]:
        extract(wheel, root / "Lib" / "site-packages")
    (root / "python312._pth").write_text("python312.zip\n.\nLib/site-packages\nimport site\n")
    print("Verified vendor artifacts extracted. No terminal or broker connection installed.")


if __name__ == "__main__":
    main()
