#!/usr/bin/env python3
"""Independent MT5 deal-capture evaluator. NEVER claims to verify broker tick provenance.

Input: EliteTrade EA's Phase-2-compatible OnTradeTransaction CSV, not signals.
Only complete, non-reversed flat-to-flat position episodes enter performance stats.
"""
from __future__ import annotations
import argparse
import collections
import csv
from decimal import Decimal, InvalidOperation
import hashlib
import json
from pathlib import Path
from typing import Any

HEADERS = ['seq','kind','server_epoch_ms','time_quality','symbol','order_ticket',
           'deal_ticket','position_ticket','magic','side','entry','order_type',
           'order_state','volume','price','sl','tp','profit','commission','swap','retcode']
DECISIONS = ['server_epoch_ms','bar_epoch','run_tag','symbol','timeframe','mode',
             'event','side','reason','reference_high','reference_low','setup_high',
             'setup_low','setup_close','atr_points','spread_points','entry','sl',
             'tp','lots','retcode']
MAX_SIZE = 64*1024*1024
VERIFIED_EX5_SHA256 = '16627b5419bd777662472479f4fed23f187ca6c3853e4352d0c01d0bc2168528'
D = Decimal

class EvidenceError(ValueError):
    pass

def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()

def data_rows(path: Path, headers: list[str], sep: str=';') -> list[dict[str,str]]:
    if not path.is_file() or path.stat().st_size > MAX_SIZE:
        raise EvidenceError(f'Missing or oversized file: {path}')
    with path.open('r',encoding='utf-8-sig',newline='') as fp:
        reader=csv.DictReader(fp,delimiter=sep)
        if reader.fieldnames!=headers:
            raise EvidenceError(f'Unexpected CSV header in {path.name}')
        rows=[]
        for row in reader:
            if len(rows)>=250000 or None in row or any(v is None for v in row.values()):
                raise EvidenceError('Malformed row or record limit exceeded')
            rows.append(row)
    return rows

def number(value: str, field: str, nonneg: bool=False) -> Decimal:
    try: val=D(value)
    except (InvalidOperation,TypeError): raise EvidenceError(f'Bad numeric {field}')
    if not val.is_finite() or (nonneg and val<0):
        raise EvidenceError(f'Non-finite or negative numeric {field}')
    return val

def validate_manifest(path:Path)->dict[str,Any]:
    try:
        obj=json.loads(path.read_text(encoding='utf-8'))
    except (OSError,UnicodeError,json.JSONDecodeError) as exc:
        raise EvidenceError('Missing or invalid evidence manifest') from exc
    required=('capture_type','symbol','timeframe','tick_model','from_date','to_date',
              'initial_deposit','currency','candidate_ex5_sha256','broker_server',
              'source_commit','execution_enabled','dataset_kind')
    missing=[k for k in required if k not in obj or obj[k] in ('',None)]
    if missing: raise EvidenceError('Missing manifest fields: '+','.join(missing))
    if obj['capture_type']!='MT5_TRANSACTION_EVENTS_V1':
        raise EvidenceError('Unsupported capture_type')
    if obj['timeframe']!='M1' or obj['tick_model']!='REAL_TICKS_MODEL_4':
        raise EvidenceError('Phase 3 requires M1, Model 4 declared')
    if not isinstance(obj['execution_enabled'],bool) or not obj['execution_enabled']:
        raise EvidenceError('Signal-only capture cannot establish trading performance')
    if obj['dataset_kind'] not in ('SYNTHETIC_TEST_ONLY','USER_EXPORTED_MT5_UNVERIFIED'):
        raise EvidenceError('Unrecognized dataset_kind')
    if (not isinstance(obj['candidate_ex5_sha256'],str) or len(obj['candidate_ex5_sha256'])!=64 or
        any(c not in '0123456789abcdef' for c in obj['candidate_ex5_sha256'].lower())):
        raise EvidenceError('EX5 SHA256 must have 64 hex digits')
    if obj['candidate_ex5_sha256'].lower()!=VERIFIED_EX5_SHA256:
        raise EvidenceError('EX5 fingerprint differs from verified Phase 3 candidate build')
    if number(str(obj['initial_deposit']),'initial_deposit')<=0:
        raise EvidenceError('initial_deposit must be positive')
    if obj['from_date']>=obj['to_date']:
        raise EvidenceError('Invalid date range')
    return obj

def evaluate(events_path:Path, manifest_path:Path, decisions_path:Path|None=None,
             tester_report:Path|None=None)->dict[str,Any]:
    manifest=validate_manifest(manifest_path)
    records=data_rows(events_path,HEADERS)
    decision_summary=None
    if decisions_path:
        decision_rows=data_rows(decisions_path,DECISIONS)
        for row in decision_rows:
            if row['symbol']!=manifest['symbol'] or row['timeframe']!='M1':
                raise EvidenceError('Decision audit symbol/timeframe mismatch')
            if row['mode']!='DEMO_EXECUTION':
                raise EvidenceError('Signal-only decisions cannot prove fills')
            if row['event'] not in ('SKIP','SIGNAL','ORDER_RESULT','ORDER_REJECTED'):
                raise EvidenceError('Unexpected decision event')
        decision_summary={
            'evaluated_bars':len(decision_rows),
            'decision_events':dict(sorted(collections.Counter(x['event'] for x in decision_rows).items())),
            'reject_reasons':dict(sorted(collections.Counter(x['reason'] for x in decision_rows if x['event'] in ('SKIP','ORDER_REJECTED')).items()))
        }
    episodes=[]; positions={}; previous_seq=0; previous_ms=0; seen_deals=set()
    received_deals=0; issues=[]
    for row in records:
        try:
            seq=int(row['seq']); ms=int(row['server_epoch_ms'])
        except ValueError as e:
            raise EvidenceError('Invalid sequence/timestamp') from e
        if seq<=previous_seq or ms<previous_ms or ms<=0:
            raise EvidenceError('Nonmonotonic event timestamp or sequence')
        previous_seq,previous_ms=seq,ms
        if row['kind']!='TRADE_TRANSACTION_DEAL_ADD':
            continue
        received_deals+=1
        if row['symbol']!=manifest['symbol']:
            raise EvidenceError('Deal symbol mismatch')
        key=row['deal_ticket']; pos=row['position_ticket']
        if not key or key in seen_deals or not pos:
            raise EvidenceError('Missing/duplicated deal ticket or position id')
        seen_deals.add(key)
        if row['side'] not in ('DEAL_TYPE_BUY','DEAL_TYPE_SELL'):
            raise EvidenceError('Non BUY/SELL deal in strategy capture')
        entry=row['entry']
        if entry not in ('DEAL_ENTRY_IN','DEAL_ENTRY_OUT'):
            raise EvidenceError('Unsupported reverse/out-by entry: '+entry)
        volume=number(row['volume'],'volume',True)
        price=number(row['price'],'price',True)
        if volume<=0 or price<=0:
            raise EvidenceError('Deal has nonpositive price/volume')
        money=sum((number(row[k] or '0',k) for k in ('profit','commission','swap')),D('0'))
        side=1 if row['side']=='DEAL_TYPE_BUY' else -1
        if entry=='DEAL_ENTRY_IN':
            if pos not in positions:
                positions[pos]={'remaining':D('0'),'side':side,'cash':D('0'),
                                'first_ms':ms,'last_ms':ms,'deal_count':0,'ticket':pos}
            p=positions[pos]
            if p['side']!=side:
                raise EvidenceError('Direction change/reversal on same position')
            p['remaining']+=volume
        else:
            if pos not in positions:
                raise EvidenceError('Exit deal without entry (capture truncated)')
            p=positions[pos]
            if p['side']==side or volume>p['remaining']:
                raise EvidenceError('Exit direction or volume mismatch')
            p['remaining']-=volume
        p['cash']+=money
        p['deal_count']+=1
        p['last_ms']=ms
        if p['remaining']==0:
            episodes.append({'position_ticket':pos,'opened_epoch_ms':p['first_ms'],
                             'closed_epoch_ms':ms,'net_realized':p['cash'],
                             'deal_count':p['deal_count']})
            del positions[pos]
    if not records: issues.append('Empty event capture')
    if received_deals==0: issues.append('No DEAL_ADD records: orders and signals are not fills')
    if positions: issues.append('Open or incomplete positions exist; complete episode statistics withheld')
    if not tester_report: issues.append('Original MT5 Strategy Tester report missing')
    elif not tester_report.is_file() or tester_report.stat().st_size==0 or tester_report.stat().st_size>MAX_SIZE:
        raise EvidenceError('Missing, empty, or oversized tester report')
    initial=number(str(manifest['initial_deposit']),'initial_deposit')
    report={
      'classification':'SYNTHETIC_FIXTURE_NOT_MARKET_PERFORMANCE' if manifest['dataset_kind']=='SYNTHETIC_TEST_ONLY' else 'USER_DECLARED_EVIDENCE_NOT_INDEPENDENTLY_VERIFIED',
      'status':('INCOMPLETE_EVIDENCE' if issues else
                'SYNTHETIC_TEST_ONLY' if manifest['dataset_kind']=='SYNTHETIC_TEST_ONLY' else
                'METRICS_COMPUTED_REAL_TICK_PROVENANCE_NOT_VERIFIED'),
      'issues':issues,
      'input_sha256':{'events':sha256(events_path),'manifest':sha256(manifest_path),
                      'decisions':sha256(decisions_path) if decisions_path else None,
                      'tester_report':sha256(tester_report) if tester_report else None},
      'symbol':manifest['symbol'],'timeframe':'M1','declared_tick_model':manifest['tick_model'],
      'candidate_ex5_sha256':manifest['candidate_ex5_sha256'],
      'broker_server_label':manifest['broker_server'],
      'event_records':len(records),'deal_records':received_deals,
      'complete_episodes':len(episodes),'incomplete_positions':len(positions),
      'decisions':decision_summary,
      'metrics':None,
      'caveats':[
         'No CSV or handwritten manifest independently authenticates MT5 real-tick history.',
         'Metrics reflect closed flat-to-flat episodes from recorded deals, not signals or requests.',
         'Realized-balance drawdown EXCLUDES floating P/L; NOT a true equity drawdown.',
         'Swap and commission are included if logged; external fees and financing adjustments may be missing.',
         'Broker Strategy Tester HTML report and original reference EA report must be verified separately.',
         'Historical performance does not prove future profitability or reference-EA equivalence.'
       ]
    }
    if positions or received_deals==0:
        return report
    episodes.sort(key=lambda e:(e['closed_epoch_ms'],e['position_ticket']))
    profits=[e['net_realized'] for e in episodes]
    gains=sum((x for x in profits if x>0),D('0'))
    losses=-sum((x for x in profits if x<0),D('0'))
    net=sum(profits,D('0'))
    balance=initial;peak=initial;dd=D('0')
    for pnl in profits:
        balance+=pnl;peak=max(peak,balance)
        dd=max(dd,(peak-balance)/peak*100)
    def round_num(n:Decimal)->float: return round(float(n),6)
    report['metrics']={
        'closed_episode_count':len(episodes),
        'win_rate_pct':round_num(D(100)*sum(x>0 for x in profits)/len(profits)),
        'net_profit':round_num(net),
        'average_net_per_episode':round_num(net/D(len(episodes))),
        'net_profit_factor':round_num(gains/losses) if losses>0 else None,
        'gross_positive_episode_sum':round_num(gains),
        'abs_negative_episode_sum':round_num(losses),
        'max_realized_balance_drawdown_pct':round_num(dd),
        'end_realized_balance_estimate':round_num(balance),
        'profit_factor_null_reason':'No losing episodes' if losses==0 else None
    }
    return report

def main()->int:
    cli=argparse.ArgumentParser(description=__doc__)
    cli.add_argument('--events',required=True,type=Path)
    cli.add_argument('--manifest',required=True,type=Path)
    cli.add_argument('--decisions',type=Path)
    cli.add_argument('--tester-report',type=Path)
    cli.add_argument('--out',type=Path)
    opt=cli.parse_args()
    try:
        r=evaluate(opt.events,opt.manifest,opt.decisions,opt.tester_report)
        text=json.dumps(r,indent=2,allow_nan=False)+'\n'
        if opt.out:
            opt.out.parent.mkdir(parents=True,exist_ok=True)
            opt.out.write_text(text,encoding='utf-8')
        print(text,end='')
        return 0 if (r['status']=='METRICS_COMPUTED_REAL_TICK_PROVENANCE_NOT_VERIFIED' and r['classification']=='USER_DECLARED_EVIDENCE_NOT_INDEPENDENTLY_VERIFIED') else 1
    except (EvidenceError,OSError,UnicodeError,ValueError) as e:
        cli.exit(2,'BLOCKED: '+str(e)+'\n')
if __name__=='__main__':raise SystemExit(main())