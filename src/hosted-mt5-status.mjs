// Research-only hosted-MT5 readiness. Never infer operational status from
// deployed frontend, GitHub build success, or configured demo-account secrets.
// A live host requires a separately provisioned Windows terminal with verified
// authenticated heartbeat and broker/EA evidence before this status can change.
export const ELITETRADE_EA_SHA256 =
  '16627b5419bd777662472479f4fed23f187ca6c3853e4352d0c01d0bc2168528';

export function hostedMt5Status() {
  return {
    schema: 'hosted_mt5_readiness_v1',
    updatedAt: null,
    host: { state: 'not_provisioned', provider: null, lastHeartbeatAt: null },
    terminal: { state: 'not_verified', platform: 'MetaTrader 5 Windows' },
    broker: { state: 'not_verified', expectedType: 'Exness MT5 Demo', symbol: 'XAUUSDm' },
    strategy: { timeframe: 'M1', mode: 'signal_only', realTickBacktest: 'not_verified',
      liveOrdersEnabled: false, realTickCoverageVerified: false },
    research: {
      compiled: true,
      name: 'EliteTrade Sweep Research v1',
      sha256: ELITETRADE_EA_SHA256,
      windowsCompilationRun: '38734987113',
      referenceEquivalenceProven: false,
      lastCloudRunOutcome: 'tester_start_failed',
      evidenceRun: '38747403478'
    },
    provisioning: {
      availableInApp: false,
      requiresExternalWindowsHost: true,
      reason: 'No Windows VPS has been provisioned, verified or connected to EliteTrade.'
    }
  };
}
