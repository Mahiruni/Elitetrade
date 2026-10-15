"""Simulated MT5 adapter tests. No MetaTrader package or broker needed."""
import sys
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "companion"))
from mt5_readonly_probe import ProbeError, probe_demo_terminal  # noqa: E402

NOW = 1_760_528_400_000
EXPECTED_LOGIN = "12345678"
EXPECTED_SERVER = "Broker-Demo"


class FakeMT5:
    ACCOUNT_TRADE_MODE_DEMO = 0
    ACCOUNT_TRADE_MODE_CONTEST = 1
    ACCOUNT_TRADE_MODE_REAL = 2

    def __init__(self):
        self.started = 0
        self.stopped = 0
        self.init_ok = True
        self.terminal = SimpleNamespace(connected=True)
        self.account = SimpleNamespace(
            login=12345678, server=EXPECTED_SERVER,
            trade_mode=self.ACCOUNT_TRADE_MODE_DEMO,
            trade_allowed=True,
        )
        self.tick = SimpleNamespace(
            bid=4000.25, ask=4000.50,
            time_msc=NOW - 2000,
        )
        self.order_calls = 0

    def initialize(self):
        self.started += 1
        return self.init_ok

    def terminal_info(self):
        return self.terminal

    def account_info(self):
        return self.account

    def symbol_info_tick(self, symbol):
        if symbol != "XAUUSDm":
            return None
        return self.tick

    def shutdown(self):
        self.stopped += 1

    def order_send(self, request):
        self.order_calls += 1
        raise AssertionError("ORDER EXECUTION MUST NEVER BE CALLED")


class ReadOnlyMt5ProbeTests(unittest.TestCase):
    def read(self, mt5=None, **override):
        mt5 = mt5 or FakeMT5()
        return probe_demo_terminal(
            mt5,
            expected_login=override.get("expected_login", EXPECTED_LOGIN),
            expected_server=override.get("expected_server", EXPECTED_SERVER),
            symbol=override.get("symbol", "XAUUSDm"),
            now_ms=override.get("now_ms", NOW),
        )

    def test_genuine_demo_observation_is_labelled_unverified_and_never_trades(self):
        fake = FakeMT5()
        result = self.read(fake)
        self.assertEqual(result["source"], "mt5-python-terminal")
        self.assertEqual(result["symbol"], "XAUUSDm")
        self.assertEqual(result["observedAt"], NOW - 2000)
        self.assertEqual(result["accountType"], "demo")
        self.assertIs(result["ordersEnabled"], False)
        self.assertIs(result["brokerVerified"], False)
        self.assertIs(result["terminalTradeAllowedClaim"], False)
        self.assertEqual(fake.started, 1)
        self.assertEqual(fake.stopped, 1)
        self.assertEqual(fake.order_calls, 0)
        self.assertNotIn("login", result)
        self.assertNotIn("server", result)

    def test_real_and_contest_accounts_are_rejected_and_terminal_closed(self):
        for mode in (FakeMT5.ACCOUNT_TRADE_MODE_REAL,
                     FakeMT5.ACCOUNT_TRADE_MODE_CONTEST):
            with self.subTest(mode=mode):
                fake = FakeMT5()
                fake.account.trade_mode = mode
                with self.assertRaisesRegex(
                        ProbeError, "REAL_OR_NONDEMO_ACCOUNT_BLOCKED"):
                    self.read(fake)
                self.assertEqual(fake.order_calls, 0)
                self.assertEqual(fake.stopped, 1)

    def test_wrong_account_and_server_are_rejected(self):
        fake = FakeMT5()
        with self.assertRaisesRegex(ProbeError, "ACCOUNT_IDENTITY_MISMATCH"):
            self.read(fake, expected_login="999999")
        self.assertEqual(fake.stopped, 1)
        fake = FakeMT5()
        with self.assertRaisesRegex(ProbeError, "BROKER_SERVER_MISMATCH"):
            self.read(fake, expected_server="Other-Demo")
        self.assertEqual(fake.stopped, 1)

    def test_disconnected_and_missing_accounts_fail_closed(self):
        fake = FakeMT5()
        fake.terminal.connected = False
        with self.assertRaisesRegex(ProbeError, "TERMINAL_DISCONNECTED"):
            self.read(fake)
        self.assertEqual(fake.stopped, 1)
        fake = FakeMT5()
        fake.account = None
        with self.assertRaisesRegex(ProbeError, "TERMINAL_OR_ACCOUNT_MISSING"):
            self.read(fake)
        self.assertEqual(fake.stopped, 1)
        fake = FakeMT5()
        fake.init_ok = False
        with self.assertRaisesRegex(ProbeError, "TERMINAL_UNAVAILABLE"):
            self.read(fake)
        self.assertEqual(fake.stopped, 0)

    def test_missing_and_stale_market_quotes_cannot_be_claimed_live(self):
        for observed in (NOW - 180001, NOW + 30001):
            with self.subTest(observed=observed):
                fake = FakeMT5()
                fake.tick.time_msc = observed
                with self.assertRaisesRegex(ProbeError, "QUOTE_STALE_OR_FUTURE"):
                    self.read(fake)
                self.assertEqual(fake.stopped, 1)
        fake = FakeMT5()
        fake.tick = None
        with self.assertRaisesRegex(ProbeError, "QUOTE_UNAVAILABLE"):
            self.read(fake)

    def test_invalid_prices_and_account_configuration_are_rejected(self):
        for bid, ask in ((float("nan"), 4000), (4000.25, float("inf")),
                         (4001, 4000), (0, 10)):
            fake = FakeMT5()
            fake.tick.bid, fake.tick.ask = bid, ask
            with self.assertRaisesRegex(ProbeError, "QUOTE_INVALID"):
                self.read(fake)
        for value in ("", "abc", "00000", "-1"):
            with self.assertRaisesRegex(ProbeError, "INVALID_EXPECTED_LOGIN"):
                self.read(FakeMT5(), expected_login=value)
        with self.assertRaisesRegex(ProbeError, "INVALID_SYMBOL"):
            self.read(FakeMT5(), symbol="XAUUSD;DROP")

    def test_source_contains_no_credentials_or_trading_commands(self):
        source = (Path(__file__).resolve().parents[1] /
                  "companion" / "mt5_readonly_probe.py").read_text()
        self.assertNotIn("mt5.login(", source)
        self.assertNotIn("mt5.order_send(", source)
        self.assertNotIn("mt5.order_check(", source)
        self.assertNotIn("mt5.copy_rates", source)
        self.assertNotIn("password=", source)


if __name__ == "__main__":
    unittest.main()
