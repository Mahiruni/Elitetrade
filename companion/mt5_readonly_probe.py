"""EliteBridge Phase 7: read-only, Windows MetaTrader 5 DEMO or REAL observation probe.

Only MetaTrader5.initialize, terminal_info, account_info, symbol_info_tick,
positions_get (optional local snapshot), and shutdown are used. No login(), order_send(), credential import, trading,
or network transmission. The data is terminal-reported, NOT server-verified.

Python 3.11+ on Windows with a running, already-authenticated MT5 DEMO
terminal and the official MetaTrader5 Python package is required for CLI use.
The explicit ELITEBRIDGE_MT5_EXPECT_MODE must match terminal account mode.
A REAL account produces read-only observations only. It does not grant
trade permission or connect to a remote gateway; no order API is called.
Tests can inject a fake module without importing or connecting to MT5.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import time
from typing import Any

SYMBOL = re.compile(r"^[A-Za-z0-9._-]{3,30}$")
LOGIN = re.compile(r"^[1-9][0-9]{0,15}$")
MAX_QUOTE_AGE_MS = 180_000


class ProbeError(Exception):
    """Sanitized read-only broker-probe error: no account info or credentials."""


def _require(condition: bool, label: str) -> None:
    if not condition:
        raise ProbeError(label)


def _snapshot_account_positions(mt5: Any, account: Any, *, expected_login: str,
                                expected_server: str, required_mode: int,
                                collected_at: int) -> dict[str, Any]:
    """Locally read and validate account and open positions; never publish them.

    Deliberately separate from the signed v3/v4 heartbeat/quote protocol.
    All observations are terminal-reported, not independently broker-verified.
    """
    import hashlib

    def number(value: Any, code: str, *, minimum: float = -1e12,
               maximum: float = 1e12) -> float:
        _require(type(value) in (int, float) and math.isfinite(value) and
                 minimum <= value <= maximum, code)
        return float(value)

    currency = getattr(account, "currency", None)
    _require(isinstance(currency, str) and
             re.fullmatch(r"[A-Z]{3,8}", currency) is not None,
             "INVALID_ACCOUNT_CURRENCY")
    try:
        positions = mt5.positions_get()
        current_account = mt5.account_info()
    except Exception:
        raise ProbeError("ACCOUNT_SNAPSHOT_UNAVAILABLE") from None
    _require(positions is not None and current_account is not None,
             "ACCOUNT_SNAPSHOT_UNAVAILABLE")
    _require(str(getattr(current_account, "login", "")) == expected_login and
             getattr(current_account, "server", None) == expected_server and
             getattr(current_account, "trade_mode", None) == required_mode,
             "ACCOUNT_CHANGED_DURING_SNAPSHOT")
    _require(isinstance(positions, (list, tuple)) and len(positions) <= 100,
             "POSITION_CAP_EXCEEDED")
    seen: set[int] = set()
    rows: list[dict[str, Any]] = []
    for position in positions:
        ticket = getattr(position, "ticket", None)
        symbol = getattr(position, "symbol", None)
        side = getattr(position, "type", None)
        _require(type(ticket) is int and 0 < ticket <= (2**63 - 1) and
                 ticket not in seen, "POSITION_ID_INVALID")
        _require(isinstance(symbol, str) and SYMBOL.fullmatch(symbol) is not None,
                 "POSITION_SYMBOL_INVALID")
        _require(type(side) is int and side in (0, 1), "POSITION_SIDE_INVALID")
        seen.add(ticket)
        rows.append({
            "positionKey": hashlib.sha256(
                (expected_login + ":" + str(ticket)).encode("ascii")
            ).hexdigest()[:24],
            "symbol": symbol,
            "side": "buy" if side == 0 else "sell",
            "volume": number(getattr(position, "volume", None),
                             "POSITION_VOLUME_INVALID", minimum=0.00000001,
                             maximum=100000),
            "entryPrice": number(getattr(position, "price_open", None),
                                 "POSITION_PRICE_INVALID", minimum=0.00000001,
                                 maximum=100000000),
            "currentPrice": number(getattr(position, "price_current", None),
                                   "POSITION_PRICE_INVALID", minimum=0.00000001,
                                   maximum=100000000),
            "stopLoss": number(getattr(position, "sl", None),
                               "POSITION_STOP_INVALID", minimum=0,
                               maximum=100000000),
            "takeProfit": number(getattr(position, "tp", None),
                                 "POSITION_TARGET_INVALID", minimum=0,
                                 maximum=100000000),
            "profit": number(getattr(position, "profit", None),
                             "POSITION_PROFIT_INVALID"),
            "swap": number(getattr(position, "swap", None),
                           "POSITION_SWAP_INVALID"),
        })
    return {
        "collectedAt": collected_at,
        "currency": currency,
        "balance": number(getattr(account, "balance", None), "ACCOUNT_BALANCE_INVALID"),
        "equity": number(getattr(account, "equity", None), "ACCOUNT_EQUITY_INVALID"),
        "margin": number(getattr(account, "margin", None), "ACCOUNT_MARGIN_INVALID",
                         minimum=0),
        "freeMargin": number(getattr(account, "margin_free", None),
                             "ACCOUNT_FREE_MARGIN_INVALID"),
        "floatingProfit": number(getattr(account, "profit", None),
                                 "ACCOUNT_FLOATING_PROFIT_INVALID"),
        "openPositionCount": len(rows),
        "positions": rows,
        "readOnly": True,
        "brokerVerified": False,
        "ordersEnabled": False,
    }


def probe_readonly_terminal(
    mt5: Any,
    *,
    expected_login: str,
    expected_server: str,
    expected_account_mode: str = "demo",
    symbol: str = "XAUUSDm",
    now_ms: int | None = None,
    include_snapshot: bool = False,
) -> dict[str, Any]:
    """Read terminal observations only. Never authenticate or submit orders.

    An adapter object is passed for testability; production CLI imports the
    official MetaTrader5 Python SDK after confirming Windows architecture.
    """
    _require(isinstance(expected_login, str) and LOGIN.fullmatch(expected_login) is not None,
             "INVALID_EXPECTED_LOGIN")
    _require(isinstance(expected_server, str) and
             2 <= len(expected_server.strip()) <= 128 and
             expected_server == expected_server.strip() and
             "\n" not in expected_server and "\r" not in expected_server,
             "INVALID_EXPECTED_SERVER")
    _require(expected_account_mode in ("demo", "real"), "INVALID_EXPECTED_ACCOUNT_MODE")
    _require(isinstance(symbol, str) and SYMBOL.fullmatch(symbol) is not None,
             "INVALID_SYMBOL")
    if now_ms is None:
        now_ms = time.time_ns() // 1_000_000
    _require(type(now_ms) is int and now_ms > 0, "INVALID_CLOCK")

    initialized = False
    try:
        try:
            initialized = mt5.initialize() is True
        except Exception:
            raise ProbeError("TERMINAL_UNAVAILABLE") from None
        _require(initialized, "TERMINAL_UNAVAILABLE")

        try:
            terminal = mt5.terminal_info()
            account = mt5.account_info()
        except Exception:
            raise ProbeError("TERMINAL_UNAVAILABLE") from None
        _require(terminal is not None and account is not None,
                 "TERMINAL_OR_ACCOUNT_MISSING")
        _require(getattr(terminal, "connected", None) is True,
                 "TERMINAL_DISCONNECTED")
        required_mode = (mt5.ACCOUNT_TRADE_MODE_REAL if expected_account_mode == "real"
                         else mt5.ACCOUNT_TRADE_MODE_DEMO)
        _require(getattr(account, "trade_mode", None) == required_mode,
                 "ACCOUNT_MODE_MISMATCH_OR_CONTEST_BLOCKED")
        _require(str(getattr(account, "login", "")) == expected_login,
                 "ACCOUNT_IDENTITY_MISMATCH")
        _require(getattr(account, "server", None) == expected_server,
                 "BROKER_SERVER_MISMATCH")

        try:
            tick = mt5.symbol_info_tick(symbol)
        except Exception:
            raise ProbeError("QUOTE_UNAVAILABLE") from None
        _require(tick is not None, "QUOTE_UNAVAILABLE")
        bid = getattr(tick, "bid", None)
        ask = getattr(tick, "ask", None)
        observed = getattr(tick, "time_msc", None)
        _require(type(bid) in (int, float) and
                 type(ask) in (int, float) and
                 math.isfinite(bid) and math.isfinite(ask) and
                 0.00000001 <= bid <= ask <= 100_000_000,
                 "QUOTE_INVALID")
        _require(type(observed) is int and
                 -30_000 <= now_ms - observed <= MAX_QUOTE_AGE_MS,
                 "QUOTE_STALE_OR_FUTURE")

        result = {
            "source": "mt5-python-terminal",
            "accountType": expected_account_mode,
            "terminalConnectedClaim": True,
            "terminalTradeAllowedClaim": False,
            "symbol": symbol,
            "bid": float(bid),
            "ask": float(ask),
            "observedAt": observed,
            "collectedAt": now_ms,
            "brokerVerified": False,
            "ordersEnabled": False,
        }
        if include_snapshot:
            result["snapshot"] = _snapshot_account_positions(
                mt5, account, expected_login=expected_login,
                expected_server=expected_server, required_mode=required_mode,
                collected_at=now_ms
            )
        return result
    finally:
        if initialized:
            try:
                mt5.shutdown()
            except Exception:
                pass


def main() -> int:
    if sys.argv[1:] not in ([], ["--snapshot"]):
        print("INVALID_READONLY_PROBE_OPERATION", file=sys.stderr)
        return 2
    if sys.platform != "win32" or sys.maxsize <= 2**32:
        print("WINDOWS_64BIT_MT5_TERMINAL_REQUIRED", file=sys.stderr)
        return 2
    expected_login = os.environ.get("ELITEBRIDGE_MT5_EXPECT_LOGIN", "")
    expected_server = os.environ.get("ELITEBRIDGE_MT5_EXPECT_SERVER", "")
    symbol = os.environ.get("ELITEBRIDGE_MT5_SYMBOL", "XAUUSDm")
    account_mode = os.environ.get("ELITEBRIDGE_MT5_EXPECT_MODE", "demo")
    try:
        import MetaTrader5 as mt5  # Windows-only official SDK
        observation = probe_readonly_terminal(
            mt5, expected_login=expected_login,
            expected_server=expected_server,
            expected_account_mode=account_mode, symbol=symbol,
            include_snapshot=sys.argv[1:] == ["--snapshot"]
        )
    except ProbeError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except ImportError:
        print("METATRADER5_PYTHON_PACKAGE_REQUIRED", file=sys.stderr)
        return 2
    except Exception:
        print("TERMINAL_PROBE_FAILED", file=sys.stderr)
        return 2
    print(json.dumps(observation, separators=(",", ":"), allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
