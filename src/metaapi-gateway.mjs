// First-stage hosted connection: reads an explicitly bound demo account only.
// Account provisioning and billing stay under the operator's MetaApi account.
const provisioning = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const error = (message, status = 503) => Object.assign(new Error(message), { status });

export function createMetaApiGateway(env, fetchImpl = fetch) {
  if (!env.METAAPI_TOKEN || !env.METAAPI_ACCOUNT_ID || !env.METAAPI_LOCAL_ACCOUNT_ID) return null;
  const remoteId = env.METAAPI_ACCOUNT_ID;
  const localId = env.METAAPI_LOCAL_ACCOUNT_ID;
  const region = env.METAAPI_REGION || 'new-york';
  if (!idPattern.test(remoteId) || !idPattern.test(localId) || !/^[a-z][a-z0-9-]{0,40}$/.test(region)) {
    throw error('Invalid MetaApi account binding or region.');
  }
  const gatewayId = `metaapi:${localId}:${remoteId}`;
  const clientBase = `https://mt-client-api-v1.${region}.agiliumtrade.ai`;
  const read = async (base, path) => {
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method:'GET', redirect:'error', signal:AbortSignal.timeout(12000),
        headers:{ 'auth-token':env.METAAPI_TOKEN, Accept:'application/json' }
      });
    } catch { throw error('MetaApi could not be reached. Check the provider connection.'); }
    if (!response.ok) {
      if ([401,403].includes(response.status)) throw error('MetaApi access was denied. Check the server-side token permissions.');
      if (response.status === 429) throw error('MetaApi rate limit reached. Wait before trying again.');
      throw error('MetaApi account is unavailable. Check that the demo account is deployed and connected.');
    }
    try { return await response.json(); }
    catch { throw error('MetaApi returned an invalid response.'); }
  };
  const verifyId = value => {
    if (value !== gatewayId) throw error('This account is not bound to the hosted demo connection.',403);
  };
  const readAccount = async () => {
    const account = await read(provisioning,`/users/current/accounts/${encodeURIComponent(remoteId)}`);
    if (account._id !== remoteId) throw error('MetaApi returned a different account.',403);
    if (account.region !== region) throw error('METAAPI_REGION must match the account region shown in MetaApi.');
    if (account.state !== 'DEPLOYED' || account.connectionStatus !== 'CONNECTED') {
      throw error('The MetaApi demo account is not connected. Deploy it in MetaApi and try again.');
    }
    const info = await read(clientBase,`/users/current/accounts/${encodeURIComponent(remoteId)}/account-information?refreshTerminalState=true`);
    if (info.platform !== 'mt5' || info.type !== 'ACCOUNT_TRADE_MODE_DEMO') {
      throw error('This integration accepts MT5 demo accounts only.',403);
    }
    if (String(info.login) !== String(account.login) || info.server !== account.server) {
      throw error('MetaApi account identity could not be verified.',403);
    }
    if (!Number.isFinite(info.balance) || !Number.isFinite(info.equity) || !/^[A-Z]{3}$/.test(info.currency || '')) {
      throw error('MetaApi account figures are incomplete.');
    }
    return info;
  };
  return {
    mode:'demo-read-only', tradingEnabled:false,
    async connect(account) {
      if (account.accountId !== localId) throw error('This EliteTrade account is not enabled for the hosted demo connection.',403);
      const info = await readAccount();
      if (String(info.login) !== String(account.login) || info.server !== account.server) {
        throw error('The MT5 login and server must match the configured MetaApi demo account.',403);
      }
      // Password is deliberately not forwarded: the operator added the demo
      // account to MetaApi directly, preferably with its investor password.
      return { accountId:gatewayId, connected:true };
    },
    async snapshot(id) {
      verifyId(id);
      const info = await readAccount();
      return { connected:true, currency:info.currency, balance:info.balance, equity:info.equity, history:[] };
    },
    async botState(id) {
      verifyId(id);
      throw error('This hosted connection is read-only. No strategy execution state is available.');
    },
    async control(id) {
      verifyId(id);
      throw error('Demo connection only: automatic trading is not implemented. No order or bot command was sent.');
    },
    async disconnect(id) {
      verifyId(id);
      // Removing the application binding is not a provider account deletion.
      return { disconnected:true };
    }
  };
}
