import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

// Real MT5 is Windows-only. The fixture exercises the exact Python production
// observer with a fake SDK; it never logs in, transmits credentials or trades.
const pythonFixture = String.raw`
from importlib.util import spec_from_file_location, module_from_spec
from types import SimpleNamespace as NS
import json, sys, time
spec = spec_from_file_location('probe', sys.argv[1])
m = module_from_spec(spec)
spec.loader.exec_module(m)
now = time.time_ns() // 1000000
account = dict(login=123456, server='Broker-Demo', trade_mode=1, currency='USD',
               balance=1000.0, equity=1004.5, margin=30.0, margin_free=974.5, profit=4.5)
position = dict(ticket=987654321, symbol='XAUUSDm', type=0, volume=0.01,
                price_open=3950.0, price_current=3955.0, sl=3900.0, tp=4000.0,
                profit=4.5, swap=0.0)
class Fake:
    ACCOUNT_TRADE_MODE_DEMO = 1
    ACCOUNT_TRADE_MODE_REAL = 0
    def __init__(self):
        self.calls = []
        self.current = dict(account)
        self.positions = [NS(**position)]
        self.second_account = None
        self.tick = NS(bid=3954.9, ask=3955.1, time_msc=now-1000)
    def initialize(self):
        self.calls.append('initialize')
        return True
    def shutdown(self):
        self.calls.append('shutdown')
    def terminal_info(self):
        return NS(connected=True)
    def account_info(self):
        self.calls.append('account_info')
        if self.second_account is not None and self.calls.count('account_info') == 2:
            return NS(**self.second_account)
        return NS(**self.current)
    def symbol_info_tick(self, symbol):
        return self.tick
    def positions_get(self):
        self.calls.append('positions_get')
        return self.positions

def observe(fake, include_snapshot=True):
    return m.probe_readonly_terminal(fake, expected_login='123456',
        expected_server='Broker-Demo', expected_account_mode='demo',
        symbol='XAUUSDm', now_ms=now, include_snapshot=include_snapshot)

f = Fake()
legacy = observe(f, False)
assert 'snapshot' not in legacy
assert 'positions_get' not in f.calls
assert f.calls.count('shutdown') == 1
f = Fake()
result = observe(f)
s = result['snapshot']
assert s['currency'] == 'USD' and s['balance'] == 1000.0
assert s['equity'] == 1004.5 and s['openPositionCount'] == 1
assert s['positions'][0]['side'] == 'buy' and s['positions'][0]['profit'] == 4.5
assert len(s['positions'][0]['positionKey']) == 24
assert all(k not in json.dumps(result) for k in ('987654321','123456','Broker-Demo'))
assert s['ordersEnabled'] is False and s['brokerVerified'] is False
assert f.calls.count('shutdown') == 1
for change, code in [
    (lambda x: setattr(x, 'positions', None), 'ACCOUNT_SNAPSHOT_UNAVAILABLE'),
    (lambda x: setattr(x, 'positions', [NS(**position)] * 101), 'POSITION_CAP_EXCEEDED'),
    (lambda x: x.positions.append(NS(**position)), 'POSITION_ID_INVALID'),
    (lambda x: setattr(x.positions[0], 'type', 3), 'POSITION_SIDE_INVALID'),
    (lambda x: setattr(x.positions[0], 'profit', float('nan')), 'POSITION_PROFIT_INVALID'),
    (lambda x: setattr(x, 'second_account', {**account, 'login': 777}), 'ACCOUNT_CHANGED_DURING_SNAPSHOT'),
    (lambda x: x.current.update(currency=''), 'INVALID_ACCOUNT_CURRENCY'),
]:
    f = Fake()
    change(f)
    try:
        observe(f)
        raise AssertionError('Accepted invalid snapshot: ' + code)
    except m.ProbeError as exc:
        assert str(exc) == code, (code, str(exc))
    assert f.calls.count('shutdown') == 1
f = Fake()
f.positions = []
assert observe(f)['snapshot']['positions'] == []
assert observe(Fake())['snapshot']['readOnly'] is True
print(json.dumps({'passed': True, 'cases': 11, 'brokerConnected': False,
                  'ordersEnabled': False}))
`;
test('Windows MT5 read-only snapshot is identity-scoped, bounded and fail closed', t => {
  const source = new URL('../companion/mt5_readonly_probe.py', import.meta.url);
  const python = process.platform === 'win32' ? 'python' : 'python3';
  const result = spawnSync(python, ['-c', pythonFixture, source.pathname], {
    encoding: 'utf8', timeout: 12000, maxBuffer: 16_384, shell: false
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(JSON.parse(result.stdout).passed, true);
});
test('default signed-telemetry shape cannot accidentally transmit an account snapshot', () => {
  const py = readFileSync(new URL('../companion/mt5_readonly_probe.py', import.meta.url), 'utf8');
  const uplink = readFileSync(new URL('../scripts/elitebridge-terminal-uplink.mjs', import.meta.url), 'utf8');
  assert.match(py, /include_snapshot: bool = False/);
  assert.match(py, /if include_snapshot:/);
  assert.match(py, /include_snapshot=sys\.argv\[1:\] == \["--snapshot"\]/);
  assert.doesNotMatch(uplink, /--snapshot|positions_get|order_send/);
  assert.doesNotMatch(py, /mt5\.order_send\s*\(/);
  assert.match(py, /ELITEBRIDGE_MT5_EXPECT_MODE/);
});
