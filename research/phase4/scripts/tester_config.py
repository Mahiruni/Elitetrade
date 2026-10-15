#!/usr/bin/env python3
"""Fail-closed MT5 *tester only* configuration generator (no credentials on CLI)."""
from __future__ import annotations
import argparse
from datetime import datetime
import os
from pathlib import Path
import re

VERIFIED_EX5_SHA256 = "16627b5419bd777662472479f4fed23f187ca6c3853e4352d0c01d0bc2168528"
EA = r"EliteTradeResearch\EliteTrade_SweepResearch_v1"


def validated_date(value: str) -> datetime:
    if not re.fullmatch(r"\d{4}\.\d{2}\.\d{2}", value):
        raise ValueError("Date must be YYYY.MM.DD")
    dt = datetime.strptime(value, "%Y.%m.%d")
    if dt.strftime("%Y.%m.%d") != value:
        raise ValueError("Noncanonical date")
    return dt


def make_config(mode: str, symbol: str, start: str, end: str,
                login: str, password: str, server: str) -> str:
    if mode not in {"signal", "execution"}:
        raise ValueError("Invalid mode")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{3,35}", symbol):
        raise ValueError("Invalid broker symbol")
    if validated_date(start) >= validated_date(end):
        raise ValueError("The ending date must be later than the starting date")
    if not re.fullmatch(r"[0-9]{4,20}", login):
        raise ValueError("DEMO login must be numeric")
    if not password or any(c in password for c in "\r\n\x00"):
        raise ValueError("Demo password missing or contains newlines")
    if not re.fullmatch(r"[a-zA-Z0-9_. :\-]{3,150}", server):
        raise ValueError("Invalid DEMO server (must be the broker server)")
    if mode == "execution" and os.environ.get("ELITETRADE_SIMULATION_CONFIRMATION") != "TESTER_ONLY_NO_LIVE_ORDERS":
        raise ValueError("Simulation confirmation is required for execution mode")
    preset = "phase4-signal.set" if mode == "signal" else "phase4-execution.set"
    # The [Common] password is temporarily written to a GitHub runner file,
    # never added to Git, uploaded, reported, or echoed. The worker is ephemeral.
    return ("[Common]\n"
            f"Login={login}\nServer={server}\nPassword={password}\nKeepPrivate=0\n"
            "[Experts]\nEnabled=0\nAllowLiveTrading=0\nAllowDllImport=0\n"
            "[Tester]\n"
            f"Expert={EA}\nExpertParameters={preset}\nSymbol={symbol}\nPeriod=M1\n"
            "Model=4\nExecutionMode=0\nOptimization=0\nForwardMode=0\n"
            f"FromDate={start}\nToDate={end}\n"
            "Deposit=10000\nCurrency=USD\nLeverage=1:100\n"
            "UseLocal=1\nUseRemote=0\nUseCloud=0\nVisual=0\n"
            "Report=reports\\phase4-test\nReplaceReport=1\nShutdownTerminal=1\n")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--mode", choices=("signal", "execution"), required=True)
    ap.add_argument("--symbol", default="XAUUSD")
    ap.add_argument("--from-date", default="2026.01.01")
    ap.add_argument("--to-date", default="2026.04.01")
    ap.add_argument("--output", required=True)
    a = ap.parse_args()
    try:
        config = make_config(a.mode, a.symbol, a.from_date, a.to_date,
                             os.environ.get("MT5_DEMO_LOGIN", ""),
                             os.environ.get("MT5_DEMO_PASSWORD", ""),
                             os.environ.get("MT5_DEMO_SERVER", ""))
        p = Path(a.output)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(config, encoding="utf-8")
    except (OSError, ValueError) as exc:
        # Never echo credential data, and never print the rendered configuration.
        print("Tester configuration could not be prepared:", type(exc).__name__)
        return 2
    print("Protected MT5 tester config created; contents deliberately hidden.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())