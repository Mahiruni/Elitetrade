"""Real SDK import check under Windows Python/Wine. NEVER initializes MT5."""
import contextlib
import json
import struct
import sys


def main():
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if sys.platform != "win32" or struct.calcsize("P") != 8:
                raise ValueError("Windows x64 interpreter required")
            import numpy
            import MetaTrader5 as mt5
            if not all(callable(getattr(mt5, name, None)) for name in
                       ("initialize", "shutdown", "terminal_info", "account_info", "positions_get")):
                raise ValueError("SDK capability unavailable")
            # Exercise the NumPy extension without creating or contacting a terminal.
            if int(numpy.array([1, 2, 3]).sum()) != 6:
                raise ValueError("NumPy unavailable")
            result = {"platform": sys.platform, "pointerBits": 64,
                      "pythonVersion": ".".join(str(v) for v in sys.version_info[:3]),
                      "sdkVersion": mt5.__version__, "numpyVersion": numpy.__version__,
                      "sdkImportable": True, "terminalPresent": False,
                      "brokerAuthenticated": False, "executionEnabled": False}
        print(json.dumps(result, separators=(",", ":")))
        return 0
    except Exception:
        print(json.dumps({"error": "SDK_COMPATIBILITY_FAILED"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
