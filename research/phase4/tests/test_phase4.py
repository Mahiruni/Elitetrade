from pathlib import Path
import os
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import tester_config as tc
import evidence_vault as v

class TesterConfig(unittest.TestCase):
    def make(self, **kwargs):
        cfg=dict(mode='signal', symbol='XAUUSD',start='2026.01.01',end='2026.04.01',
                 login='123456',password='disposable-demo-only',server='MetaQuotes-Demo')
        cfg.update(kwargs)
        return tc.make_config(**cfg)

    def test_real_ticks_mode(self):
        out=self.make()
        self.assertIn('Model=4',out)
        self.assertIn('Period=M1',out)
        self.assertIn('phase4-signal.set',out)
        self.assertIn('AllowLiveTrading=0',out)
        self.assertIn('ShutdownTerminal=1',out)

    def test_secret_present_but_no_logging(self):
        self.assertIn('Password=disposable-demo-only',self.make())

    def test_no_live_chart_ea(self):
        self.assertIn('[Experts]\nEnabled=0',self.make())

    def test_bad_symbol(self):
        with self.assertRaises(ValueError): self.make(symbol='XAUUSD\nPassword=evil')

    def test_bad_login(self):
        with self.assertRaises(ValueError): self.make(login='ABC')

    def test_bad_server(self):
        with self.assertRaises(ValueError): self.make(server='B\n[X]')

    def test_no_password(self):
        with self.assertRaises(ValueError): self.make(password='')

    def test_invalid_dates(self):
        with self.assertRaises(ValueError): self.make(end='2025.12.31')

    def test_bad_date_format(self):
        with self.assertRaises(ValueError): self.make(start='2026-01-01')

    def test_execution_requires_guard(self):
        old=os.environ.pop('ELITETRADE_SIMULATION_CONFIRMATION',None)
        try:
            with self.assertRaises(ValueError): self.make(mode='execution')
            os.environ['ELITETRADE_SIMULATION_CONFIRMATION']='TESTER_ONLY_NO_LIVE_ORDERS'
            self.assertIn('phase4-execution.set',self.make(mode='execution'))
        finally:
            if old is None: os.environ.pop('ELITETRADE_SIMULATION_CONFIRMATION',None)
            else: os.environ['ELITETRADE_SIMULATION_CONFIRMATION']=old

class EvidenceVault(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try: import cryptography
        except ImportError: raise unittest.SkipTest('cryptography not installed (CI installs it)')

    def test_encrypt_decrypt_roundtrip(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td)
            source=root/'raw';source.mkdir()
            (source/'report.htm').write_text('ACCOUNT 123456')
            (source/'deal.csv').write_text('deal;profit\n1;2')
            sealed=root/'evidence.encrypted';opened=root/'opened'
            v.seal(source,sealed,b'a long secret passphrase that is not shared')
            self.assertNotIn(b'ACCOUNT',sealed.read_bytes())
            self.assertNotIn(b'report.htm',sealed.read_bytes())
            v.unseal(sealed,opened,b'a long secret passphrase that is not shared')
            self.assertEqual((opened/'report.htm').read_text(),'ACCOUNT 123456')

    def test_wrong_password_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td);(p/'a').mkdir();(p/'a'/'a.csv').write_text('hello')
            v.seal(p/'a',p/'b.enc',b'a long secret passphrase that is not shared')
            with self.assertRaises(Exception):
                v.unseal(p/'b.enc',p/'c',b'another long secret passphrase that is wrong')

    def test_tampered_ciphertext_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td);(p/'a').mkdir();(p/'a'/'a.csv').write_text('hello')
            v.seal(p/'a',p/'b.enc',b'a long secret passphrase that is not shared')
            x=bytearray((p/'b.enc').read_bytes());x[-1] ^= 1;(p/'b.enc').write_bytes(x)
            with self.assertRaises(Exception):
                v.unseal(p/'b.enc',p/'c',b'a long secret passphrase that is not shared')

    def test_missing_evidence_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td);(p/'a').mkdir()
            with self.assertRaises(ValueError):v.seal(p/'a',p/'b',b'a long secret passphrase that is not shared')

if __name__ == '__main__': unittest.main()