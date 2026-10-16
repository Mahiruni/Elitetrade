"""Provision an encrypted single-account DEMO gateway on its private cloud host.

Interactive password prompt; no plaintext config file, argv or environment.
The generated service token is saved privately, never printed. This script does
not connect to a broker, purchase a host, enable trading or alter app accounts.
"""
import getpass
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys


def main():
    os.umask(0o077)
    directory = Path(os.environ.get("ELITEBRIDGE_GATEWAY_PRIVATE_DIR", "/var/lib/elitebridge/private"))
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink() or directory.stat().st_mode & 0o077:
        raise ValueError("Private directory must have mode 0700")
    paths = {name: directory / ("gateway." + suffix)
             for name, suffix in (("key", "key"), ("vault", "vault"), ("token", "token"))}
    if any(p.exists() or p.is_symlink() for p in paths.values()):
        raise ValueError("Refusing to overwrite existing private configuration")
    service_token = secrets.token_urlsafe(32)
    config = {"broker": "Exness", "mode": "demo", "token": service_token,
              "accountId": input("Saved EliteTrade account UUID: ").strip(),
              "login": input("Authorized MT5 demo login: ").strip(),
              "server": input("Exact Exness-MT5Trial server: ").strip(),
              "symbol": input("Exact broker symbol [XAUUSDm]: ").strip() or "XAUUSDm",
              "terminalPath": input("Windows terminal64.exe path inside Wine: ").strip(),
              "password": getpass.getpass("MT5 demo investor password (hidden): ")}
    env = dict(os.environ, ELITEBRIDGE_GATEWAY_KEY_FILE=str(paths["key"]),
               ELITEBRIDGE_GATEWAY_VAULT_FILE=str(paths["vault"]))
    root = Path(__file__).resolve().parent.parent
    result = subprocess.run(["node", "scripts/elitebridge-cloud-gateway.mjs", "seal"],
               cwd=root, input=json.dumps(config), text=True, env=env, check=False)
    if result.returncode:
        raise ValueError("Sealing failed; inspect private directory before retrying")
    descriptor = os.open(paths["token"], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as file:
        file.write(service_token)
    print("Encrypted DEMO configuration prepared; service token saved privately. Broker UNVERIFIED.")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Provisioning blocked. Check input, directory ownership and private files. No secrets logged.", file=sys.stderr)
        raise SystemExit(1)
