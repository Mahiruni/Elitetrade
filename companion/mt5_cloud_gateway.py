"""Private Exness DEMO SDK collector. Run with Windows Python, including under Wine.

One JSON request on stdin, one allowlisted JSON result on stdout. Passwords never
appear in argv, environment, returned data or error messages. No order API exists.
This is distinct from the unsigned local observation probe and signed uplink.
"""
from __future__ import annotations

import contextlib
import hashlib
import json
import math
import re
import sys
import time
from datetime import datetime, timezone

from mt5_readonly_probe import ProbeError, _snapshot_account_positions


def require(value, code):
    if not value:
        raise ProbeError(code)


def collect(mt5, config, now_ms=None):
    require(isinstance(config, dict), "CONFIG_INVALID")
    login = config.get("login")
    server = config.get("server")
    password = config.get("password")
    symbol = config.get("symbol", "XAUUSDm")
    require(config.get("mode") == "demo", "REAL_ACCOUNT_LOCKED")
    require(isinstance(login, str) and re.fullmatch(r"[1-9][0-9]{0,15}", login), "LOGIN_INVALID")
    require(isinstance(server, str) and re.fullmatch(r"Exness-MT5Trial[1-9][0-9]*", server), "SERVER_MODE_MISMATCH")
    require(isinstance(config.get("accountId"), str) and
            re.fullmatch(r"[a-zA-Z0-9_-]{1,128}", config["accountId"]), "BINDING_INVALID")
    require(isinstance(password, str) and 1 <= len(password) <= 128, "CREDENTIAL_MISSING")
    require(isinstance(symbol, str) and re.fullmatch(r"[A-Za-z0-9._-]{3,30}", symbol), "SYMBOL_INVALID")
    require(isinstance(config.get("terminalPath"), str) and
            config["terminalPath"].lower().endswith("terminal64.exe"), "TERMINAL_PATH_INVALID")
    connected = False
    try:
        connected = mt5.initialize(config["terminalPath"], login=int(login),
                                    password=password, server=server,
                                    timeout=5000, portable=True) is True
        require(connected, "AUTHENTICATION_OR_TERMINAL_UNAVAILABLE")
        terminal = mt5.terminal_info()
        account = mt5.account_info()
        require(terminal is not None and getattr(terminal, "connected", False) is True,
                "BROKER_DISCONNECTED")
        require(account is not None, "ACCOUNT_UNAVAILABLE")
        require(str(account.login) == login, "ACCOUNT_IDENTITY_MISMATCH")
        require(account.server == server, "BROKER_SERVER_MISMATCH")
        require(account.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO, "REAL_ACCOUNT_LOCKED")
        require(isinstance(getattr(account, "company", None), str) and
                re.match(r"^Exness(?:\b|$)", account.company, re.I), "BROKER_IDENTITY_MISMATCH")
        now_ms = now_ms if now_ms is not None else time.time_ns() // 1_000_000
        financial = _snapshot_account_positions(mt5, account, expected_login=login,
                     expected_server=server, required_mode=mt5.ACCOUNT_TRADE_MODE_DEMO,
                     collected_at=now_ms)
        # A missing/stale quote does not turn an authenticated account into a
        # fabricated market feed. Account state and price freshness are separate.
        quote = None
        if mt5.symbol_select(symbol, True):
            tick = mt5.symbol_info_tick(symbol)
            if (tick is not None and type(tick.time_msc) is int and
                -2000 <= now_ms - tick.time_msc <= 30000 and
                all(type(x) in (float, int) and math.isfinite(x) for x in (tick.bid, tick.ask)) and
                0 < tick.bid <= tick.ask <= 1e8):
                quote = {"symbol": symbol, "bid": tick.bid, "ask": tick.ask,
                         "observedAt": datetime.fromtimestamp(tick.time_msc / 1000, timezone.utc).isoformat()}
        # Reconfirm identity AND connection after all reads. No mixed-account result.
        final = mt5.account_info()
        final_terminal = mt5.terminal_info()
        require(final is not None and str(final.login) == login and
                final.server == server and final.trade_mode == mt5.ACCOUNT_TRADE_MODE_DEMO and
                final_terminal is not None and final_terminal.connected is True,
                "ACCOUNT_CHANGED_DURING_SNAPSHOT")
        return {"authenticated": True, "brokerConnected": True, "platform": "mt5",
                "broker": "Exness", "server": server, "mode": "demo",
                "accountId": config["accountId"],
                "loginDigest": hashlib.sha256(login.encode("ascii")).hexdigest(),
                "observedAt": datetime.fromtimestamp(now_ms / 1000, timezone.utc).isoformat(),
                **{k: financial[k] for k in ("balance", "equity", "currency", "margin",
                   "freeMargin", "floatingProfit", "positions", "openPositionCount")},
                "quote": quote, "marketState": "fresh" if quote else "unavailable-or-stale",
                "brokerTradeAllowed": getattr(account, "trade_allowed", False) is True,
                "tradingEnabled": False, "readOnly": True}
    finally:
        if connected:
            mt5.shutdown()


def main():
    try:
        # An SDK/library diagnostic must not accidentally become public JSON.
        with contextlib.redirect_stdout(sys.stderr):
            require(sys.platform == "win32", "WINDOWS_PYTHON_REQUIRED_USE_WINE")
            import MetaTrader5 as mt5
            raw = sys.stdin.buffer.read(16385)
            require(len(raw) <= 16384, "CONFIG_INVALID")
            result = collect(mt5, json.loads(raw))
        print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    except ProbeError as exc:
        print(json.dumps({"error": str(exc)}))
        return 1
    except Exception:
        print(json.dumps({"error": "SDK_COLLECTION_FAILED"}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
