/**
 * Original user-supplied MT5 EX5 metadata. Not decrypted, modified or uploaded.
 * Registration is not execution: only the native Windows MT5 Expert runtime
 * can load the EX5, and EliteTrade has no verified Windows host.
 */
export const ORIGINAL_EX5_ID = 'scalpin-ss-ex5';
export const ORIGINAL_EX5 = Object.freeze({
  id: ORIGINAL_EX5_ID,
  name: 'Scalpin SS · Original EX5',
  filename: 'Scalpin SS .ex5',
  sha256: '812d951ed273c8898990af8a9ce40b0287aaeee7b6cd956002e748f723e506e5',
  bytes: 77796,
  runtime: 'windows-mt5',
  executionAvailable: false,
  sourceVerified: false,
  settingsVerified: false,
  brokerCompatibilityVerified: false,
  performanceVerified: false,
  description: 'Original supplied compiled MT5 Expert Advisor, unchanged. Requires a Windows MT5 terminal; no EliteTrade web execution or strategy simulation is available.'
});
export const isOriginalEx5 = strategy => strategy === ORIGINAL_EX5_ID;
