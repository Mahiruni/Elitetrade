"""Synthetic tests for scrubbed, no-raw-output MT5 journal classifier."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import time

SRC = Path(__file__).resolve().parents[1] / "scripts" / "diagnose_mt5.py"
spec = importlib.util.spec_from_file_location("mt5_diag", SRC)
diag = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diag)

class SanitizedJournalTests(unittest.TestCase):
    def scan(self, content: bytes, age_seconds: int = 0):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "Terminal"
            log = root / "logs" / "20261015.log"
            log.parent.mkdir(parents=True)
            log.write_bytes(content)
            now = time.time()
            if age_seconds:
                import os
                os.utime(log, (now - age_seconds, now - age_seconds))
            return diag.categorize([root], now)

    def test_never_emit_account_number_or_server(self):
        result = self.scan(b"authorization failed 12345678 Broker-ExampleDemo")
        self.assertEqual(result["classification"], "AUTH_REJECTED")
        self.assertNotIn("12345678", str(result))
        self.assertNotIn("Broker-ExampleDemo", str(result))
        self.assertFalse(result["broker_authentication_verified"])

    def test_utf16_journal_supported(self):
        result = self.scan(("tester: no history data on symbol").encode("utf-16le"))
        self.assertEqual(result["classification"], "HISTORY_UNAVAILABLE")

    def test_start_failure(self):
        self.assertEqual(self.scan(b"local tester agent failed to start")["classification"], "TESTER_START_FAILED")

    def test_missing_agent_identified(self):
        result = self.scan(b"Tester no agent is ready, optimization not started")
        self.assertEqual(result["classification"], "AGENT_UNAVAILABLE")

    def test_metatester_service_error_identified(self):
        result = self.scan(b"Service MetaTester-1 start failed [1053]")
        self.assertEqual(result["classification"], "AGENT_SERVICE_ERROR")

    def test_positive_connection_not_verified(self):
        result = self.scan(b"connected to ServerName")
        self.assertTrue(result["broker_connection_hint_unverified"])
        self.assertFalse(result["broker_authentication_verified"])

    def test_old_file_excluded(self):
        self.assertEqual(self.scan(b"authorization failed", age_seconds=900)["classification"], "NO_CLASSIFIED_ERROR")

    def test_empty(self):
        with TemporaryDirectory() as tmp:
            result = diag.categorize([Path(tmp)], time.time())
        self.assertFalse(result["log_presence"])
        self.assertEqual(result["logs_inspected"], 0)

if __name__ == "__main__":
    unittest.main()
