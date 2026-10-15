"""Synthetic ONLY tests, no claims about real MT5 strategy performance."""
import csv
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))
from evaluate_capture import HEADERS, DECISIONS, evaluate, EvidenceError

HASH='16627b5419bd777662472479f4fed23f187ca6c3853e4352d0c01d0bc2168528'

def event(seq,ms,deal,pos,side,entry,vol='0.10',profit='0',commission='-0.5',swap='0',symbol='XAUUSD'):
    r=dict.fromkeys(HEADERS,'')
    r.update({'seq':str(seq),'kind':'TRADE_TRANSACTION_DEAL_ADD',
       'server_epoch_ms':str(ms),'time_quality':'deal_time_millisecond',
       'symbol':symbol,'deal_ticket':str(deal),'position_ticket':str(pos),
       'magic':'2026101501','side':'DEAL_TYPE_'+side,'entry':'DEAL_ENTRY_'+entry,
       'volume':vol,'price':'2000.50' if side=='BUY' else '2001.00',
       'profit':profit,'commission':commission,'swap':swap})
    return r

class TestCapture(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir=Path(self.tmp.name)
        self.manifest={
            'capture_type':'MT5_TRANSACTION_EVENTS_V1','dataset_kind':'SYNTHETIC_TEST_ONLY',
            'symbol':'XAUUSD','timeframe':'M1','tick_model':'REAL_TICKS_MODEL_4',
            'from_date':'2026.01.01','to_date':'2026.04.01',
            'initial_deposit':10000,'currency':'USD',
            'broker_server':'SYNTHETIC_NOT_A_BROKER',
            'candidate_ex5_sha256':HASH,'source_commit':'synthetic',
            'execution_enabled':True
        }
        self.rows=[event(1,1000,10,100,'BUY','IN'),
                   event(2,2000,11,100,'SELL','OUT',profit='12',commission='-0.5'),
                   event(3,3000,12,101,'SELL','IN'),
                   event(4,4000,13,101,'BUY','OUT',profit='-5',commission='-0.5')]
        self.report=self.dir/'synthetic-tester-report.htm'
        self.report.write_text('SYNTHETIC MOCK MT5 REPORT, NOT MARKET EVIDENCE')
    def files(self, rows=None, manifest=None):
        ev=self.dir/'events.csv'
        with ev.open('w',newline='',encoding='utf-8') as f:
            wr=csv.DictWriter(f,fieldnames=HEADERS,delimiter=';')
            wr.writeheader();wr.writerows(self.rows if rows is None else rows)
        m=self.dir/'manifest.json'
        m.write_text(json.dumps(self.manifest if manifest is None else manifest))
        return ev,m
    def test_completed_two_episodes_with_costs(self):
        ev,m=self.files()
        r=evaluate(ev,m,tester_report=self.report)
        self.assertEqual(r['complete_episodes'],2)
        self.assertEqual(r['classification'],'SYNTHETIC_FIXTURE_NOT_MARKET_PERFORMANCE')
        self.assertEqual(r['metrics']['net_profit'],5)
        self.assertEqual(r['metrics']['win_rate_pct'],50)
        self.assertAlmostEqual(r['metrics']['net_profit_factor'],11.0/6.0,places=6)
        self.assertEqual(r['status'],'SYNTHETIC_TEST_ONLY')
    def test_zero_trades_never_zero_win_rate(self):
        ev,m=self.files([])
        r=evaluate(ev,m,tester_report=self.report)
        self.assertIsNone(r['metrics'])
        self.assertEqual(r['status'],'INCOMPLETE_EVIDENCE')
    def test_partial_close_completed(self):
        rows=[event(1,1000,10,100,'BUY','IN',vol='0.20'),
              event(2,2000,11,100,'SELL','OUT',vol='0.05',profit='3'),
              event(3,3000,12,100,'SELL','OUT',vol='0.15',profit='6')]
        ev,m=self.files(rows)
        r=evaluate(ev,m,tester_report=self.report)
        self.assertEqual(r['metrics']['closed_episode_count'],1)
        self.assertEqual(r['metrics']['net_profit'],7.5)
    def test_incomplete_positions_withhold_metrics(self):
        ev,m=self.files(self.rows[:-1])
        r=evaluate(ev,m,tester_report=self.report)
        self.assertIsNone(r['metrics'])
        self.assertEqual(r['incomplete_positions'],1)
    def test_missing_tester_report_is_incomplete(self):
        ev,m=self.files()
        r=evaluate(ev,m)
        self.assertIsNotNone(r['metrics'])
        self.assertEqual(r['status'],'INCOMPLETE_EVIDENCE')
    def test_reject_exit_without_entry(self):
        ev,m=self.files([self.rows[1]])
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)
    def test_reject_duplicate_deals(self):
        ev,m=self.files([self.rows[0],dict(self.rows[0],seq='2',server_epoch_ms='2000')])
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)
    def test_reject_timestamp_rewind(self):
        ev,m=self.files([self.rows[0],dict(self.rows[1],server_epoch_ms='999')])
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)
    def test_reject_symbol_mismatch(self):
        rows=[dict(self.rows[0],symbol='EURUSD')]
        ev,m=self.files(rows)
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)
    def test_reject_reversal(self):
        rows=[dict(self.rows[0],entry='DEAL_ENTRY_INOUT')]
        ev,m=self.files(rows)
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)
    def test_reject_signal_only_mode(self):
        ev,m=self.files(manifest=dict(self.manifest,execution_enabled=False))
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)
    def test_reject_missing_manifest_details(self):
        man=dict(self.manifest);del man['broker_server']
        ev,m=self.files(manifest=man)
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)
    def test_reject_wrong_compiled_binary(self):
        ev,m=self.files(manifest=dict(self.manifest,candidate_ex5_sha256='0'*64))
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)
    def test_reject_wrong_tick_model(self):
        ev,m=self.files(manifest=dict(self.manifest,tick_model='OPEN_PRICES'))
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)
    def test_decision_not_fill(self):
        ev,m=self.files()
        dr=dict.fromkeys(DECISIONS,'')
        dr.update({'symbol':'XAUUSD','timeframe':'M1','mode':'DEMO_EXECUTION','event':'SKIP','reason':'SPREAD_TOO_HIGH'})
        dp=self.dir/'decisions.csv'
        with dp.open('w',newline='',encoding='utf-8') as f:
            w=csv.DictWriter(f,fieldnames=DECISIONS,delimiter=';')
            w.writeheader();w.writerow(dr)
        r=evaluate(ev,m,decisions_path=dp,tester_report=self.report)
        self.assertEqual(r['decisions']['reject_reasons']['SPREAD_TOO_HIGH'],1)
        self.assertEqual(r['complete_episodes'],2)
        self.assertEqual(r['deal_records'],4)
    def test_money_nan_blocked(self):
        rows=[dict(self.rows[0],profit='NaN')]
        ev,m=self.files(rows)
        with self.assertRaises(EvidenceError):evaluate(ev,m,tester_report=self.report)

if __name__=='__main__':unittest.main()