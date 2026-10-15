#!/usr/bin/env python3
"""Privacy-preserving MT5 terminal log classifier. Never outputs journal text,
paths, account numbers, broker server names or credential values.
An observed phrase is a clue, NOT proof that broker authentication succeeded.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re

MAX_FILES = 40
TAIL_BYTES = 256 * 1024
PATTERNS = {
    "AUTH_REJECTED": r"authorization failed|invalid (?:login|password|account)|login failed|authorization error",
    "NETWORK_PROBLEM": r"no connection|connection failed|failed to connect|network unavailable|network is unavailable",
    "SYMBOL_UNAVAILABLE": r"unknown symbol|symbol .{0,80}(?:not found|does not exist|not exist)",
    "HISTORY_UNAVAILABLE": r"no history data|history .{0,80}(?:unavailable|not found)|no tick data|ticks? .{0,80}not found",
    "TESTER_START_FAILED": r"tester .{0,80}(?:failed|not start)|agent .{0,80}(?:failed to start|not started)",
    "TERMINAL_EXCEPTION": r"access violation|unhandled exception|fatal error",
    "BROKER_CONNECTION_HINT": r"connected to|authorized|authorization successful",
    "TESTER_ACTIVITY_HINT": r"strategy tester|testing started|test started",
}
COMPILED = {k: re.compile(v, re.I) for k, v in PATTERNS.items()}
PRIORITY = ("AUTH_REJECTED", "NETWORK_PROBLEM", "SYMBOL_UNAVAILABLE",
            "HISTORY_UNAVAILABLE", "TESTER_START_FAILED", "TERMINAL_EXCEPTION")
SCAN_RELATIVE = ("logs", "Tester/logs", "Tester", "MQL5/Logs")

def categorize(roots: list[Path], since: float) -> dict:
    candidates: list[Path] = []
    for root in roots:
        for rel in SCAN_RELATIVE:
            base = root / rel
            if not base.is_dir():
                continue
            try:
                for path in base.rglob("*.log"):
                    if path.is_symlink() or not path.is_file():
                        continue
                    if path.stat().st_mtime >= since - 300:
                        candidates.append(path)
            except OSError:
                continue
    files = sorted(set(candidates), key=lambda p: p.stat().st_mtime, reverse=True)[:MAX_FILES]
    hits = {k: False for k in PATTERNS}
    read_count = 0
    for path in files:
        try:
            with path.open("rb") as fh:
                size = path.stat().st_size
                if size > TAIL_BYTES:
                    fh.seek(-TAIL_BYTES, 2)
                raw = fh.read(TAIL_BYTES)
            # MT5 journals are frequently UTF-16LE. Never print decoded text.
            decoded = raw.decode("utf-16le", errors="ignore") if raw.startswith(b"\xff\xfe") or raw.count(b"\x00") > len(raw)//5 else raw.decode("utf-8", errors="ignore")
            read_count += 1
            for key, regex in COMPILED.items():
                if regex.search(decoded):
                    hits[key] = True
        except (OSError, UnicodeError):
            continue
    category = next((key for key in PRIORITY if hits[key]), "NO_CLASSIFIED_ERROR")
    return {
        "classification": category,
        "logs_inspected": read_count,
        "log_presence": bool(read_count),
        "authentication_rejected_hint": hits["AUTH_REJECTED"],
        "network_problem_hint": hits["NETWORK_PROBLEM"],
        "symbol_unavailable_hint": hits["SYMBOL_UNAVAILABLE"],
        "history_unavailable_hint": hits["HISTORY_UNAVAILABLE"],
        "tester_start_failure_hint": hits["TESTER_START_FAILED"],
        "terminal_exception_hint": hits["TERMINAL_EXCEPTION"],
        "broker_connection_hint_unverified": hits["BROKER_CONNECTION_HINT"],
        "tester_activity_hint_unverified": hits["TESTER_ACTIVITY_HINT"],
        "broker_authentication_verified": False,
        "real_ticks_verified": False,
        "source": "LOCAL_MT5_JOURNAL_CLASSIFICATION_NO_RAW_LINES"
    }

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--terminal-root", required=True)
    parser.add_argument("--appdata-root", required=True)
    parser.add_argument("--since-utc", required=True)
    parser.add_argument("--output", required=True)
    a = parser.parse_args()
    try:
        since = datetime.fromisoformat(a.since_utc.replace("Z", "+00:00"))
        if since.tzinfo is None:
            raise ValueError("UTC time requires timezone")
        info = categorize([Path(a.terminal_root), Path(a.appdata_root)], since.timestamp())
        target = Path(a.output)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(info, indent=2), encoding="utf-8")
    except (OSError, ValueError):
        print("Safe MT5 diagnostic generation failed (no raw journal output).")
        return 2
    print("Sanitized MT5 log classification saved (no account identifiers or log lines).")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
