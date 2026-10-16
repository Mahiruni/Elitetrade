// Broker-neutral MT5 server registry. These are broker-reported server labels,
// not hostnames, IP addresses, authenticated sessions or execution authorization.
export const BROKER_SERVER_PROFILES = Object.freeze({
  exness: Object.freeze({
    broker: 'Exness',
    platform: 'mt5',
    demo: Object.freeze({ server: 'Exness-MT5Trial9', tradingEnabled: false }),
    real: Object.freeze({ server: 'Exness-MT5Real9', tradingEnabled: false })
  })
});

export function resolveMt5ServerProfile({broker, mode, server} = {}) {
  if (typeof broker !== 'string' || typeof server !== 'string') throw new Error('Broker and MT5 server required');
  if (mode !== 'demo' && mode !== 'real') throw new Error('Explicit demo or real account mode required');
  const id = broker.trim().toLowerCase();
  const value = server.trim();
  if (!value || value.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))
    throw new Error('Invalid MT5 server label');
  const preset = BROKER_SERVER_PROFILES[id]?.[mode];
  if (preset && value !== preset.server)
    throw new Error('Configured MT5 server does not match selected account mode');
  return Object.freeze({broker:id,platform:'mt5',mode,server:value,
    brokerAuthenticated:false,marketDataVerified:false,orderExecutionAuthorized:false});
}
