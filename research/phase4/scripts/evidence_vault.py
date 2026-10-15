#!/usr/bin/env python3
"""Encrypt MT5 evidence using authenticated AES-256-GCM; decrypt in Termux.

Uses environment passphrase in CI; locally prompts for a passphrase when absent.
Encrypted archives have no unencrypted filenames. Never upload original records.
"""
from __future__ import annotations
import argparse
from getpass import getpass
import io
import os
from pathlib import Path
import secrets
import struct
import sys
import zipfile

MAGIC = b"ELITETRADE-EVIDENCE-AES256GCM-V1\n"
ITERATIONS = 350000
MAX_ARCHIVE_BYTES = 100 * 1024 * 1024


def get_passphrase() -> bytes:
    p = os.environ.get("MT5_EVIDENCE_PASSPHRASE")
    if p is None:
        p = getpass("Evidence vault passphrase: ")
    if len(p) < 20:
        raise ValueError("Evidence vault passphrase must be >=20 characters")
    return p.encode("utf-8")


def derive(pw: bytes, salt: bytes) -> bytes:
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    return PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt,
                     iterations=ITERATIONS).derive(pw)


def seal(source: Path, out: Path, pw: bytes) -> None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    if not source.is_dir():
        raise ValueError("Evidence staging directory not found")
    files = sorted(p for p in source.rglob("*") if p.is_file())
    if not files or len(files) > 100 or sum(p.stat().st_size for p in files) > MAX_ARCHIVE_BYTES:
        raise ValueError("Missing evidence or evidence size limit reached")
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in files:
            if p.is_symlink():
                raise ValueError("Symlinks forbidden")
            zf.write(p, p.relative_to(source).as_posix())
    payload = mem.getvalue()
    if len(payload) > MAX_ARCHIVE_BYTES:
        raise ValueError("Compressed evidence too large")
    salt, nonce = secrets.token_bytes(16), secrets.token_bytes(12)
    ciphertext = AESGCM(derive(pw, salt)).encrypt(nonce, payload, MAGIC)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(MAGIC + salt + nonce + ciphertext)


def unseal(source: Path, dest: Path, pw: bytes) -> None:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    raw = source.read_bytes()
    if not raw.startswith(MAGIC) or len(raw) > MAX_ARCHIVE_BYTES + 1000:
        raise ValueError("Unsupported or oversized encrypted evidence")
    data = raw[len(MAGIC):]
    if len(data) < 16 + 12 + 16:
        raise ValueError("Truncated encrypted evidence")
    salt, nonce, ciphertext = data[:16], data[16:28], data[28:]
    plain = AESGCM(derive(pw, salt)).decrypt(nonce, ciphertext, MAGIC)
    with zipfile.ZipFile(io.BytesIO(plain)) as zf:
        for info in zf.infolist():
            name = info.filename
            if (name.startswith("/") or "\\" in name or ".." in Path(name).parts
                or info.file_size > MAX_ARCHIVE_BYTES):
                raise ValueError("Unsafe archive path")
        if sum(x.file_size for x in zf.infolist()) > MAX_ARCHIVE_BYTES:
            raise ValueError("Expanded archive too large")
        dest.mkdir(parents=True, exist_ok=True)
        zf.extractall(dest)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("action", choices=("seal", "open"))
    ap.add_argument("--source", required=True)
    ap.add_argument("--output", required=True)
    a = ap.parse_args()
    try:
        pw = get_passphrase()
        if a.action == "seal":
            seal(Path(a.source), Path(a.output), pw)
        else:
            unseal(Path(a.source), Path(a.output), pw)
    except Exception as exc:
        # Cryptographic failures get generic messages: no plaintext or passwords.
        print("Evidence vault operation failed:", type(exc).__name__, file=sys.stderr)
        return 1
    print("Evidence vault", "encrypted" if a.action == "seal" else "decrypted", "successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())