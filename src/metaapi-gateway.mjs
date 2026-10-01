import { createHash } from 'node:crypto';
const provisioning = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const error = (message, status = 503) => Object.assign(new Error(message), { status });
const nameFor = id => `EliteTrade ${id}`;

export function createMetaApiGateway(env, fetchImpl = fetch) {
  if (!env.METAAPI_TOKEN) return null;
  const region = env.METAAPI_REGION || 'new-york';
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(region)) throw error('Invalid MetaApi region.');
  const call = async (base, path, method = 'GET', body, extra = {}) => {
    let response;
    try {
      response = await fetchImpl(new URL(path, base), {
        method, redirect:'error', signal:AbortSignal.timeout(12000),
        headers:{ 'auth-token':env.METAAPI_TOKEN, Accept:'application/json', 'Content-Type':'application/json', ...extra },
        ...(body ? {body:JSON.stringify(body)} : {})
      });
    } catch { throw error('MetaApi could not be reached. Check the provider connection.'); }
    if (response.status === 202) throw error('MetaApi is processing this connection. Retry approval later; the same request will be resumed.');
    if (!response.ok) {
      if ([401,403].includes(response.status)) throw error('MetaApi access was denied. Check the server-side token permissions.');
      if (response.status === 429) throw error('MetaApi rate limit reached. Wait before retrying.');
      if (response.status === 400) throw error('MetaApi could not verify these MT5 credentials or broker settings. Check the login, server and password.');
      throw error('MetaApi could not complete the account request. Check the provider dashboard.');
    }
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw error('MetaApi returned an invalid response.'); }
  };
  const parse = id => {
    const parts = String(id).split(':');
    if (parts.length !== 3 || parts[0] !== 'metaapi' || !parts.slice(1).every(p => idPattern.test(p))) throw error('Invalid hosted account binding.',403);
    return {localId:parts[1],remoteId:parts[2]};
  };
  const metadata = async id => {
    const {localId,remoteId} = parse(id);
    const account = await call(provisioning,`/users/current/accounts/${remoteId}`);
    if (account._id !== remoteId || account.metadata?.elitetradeAccountId !== localId || account.name !== nameFor(localId)) throw error('MetaApi account ownership could not be verified.',403);
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(account.region || '')) throw error('MetaApi returned an invalid account region.');
    return account;
  };
  const figures = async (id, account) => {
    account ||= await metadata(id);
    if (account.state !== 'DEPLOYED' || account.connectionStatus !== 'CONNECTED') throw error('The MT5 account is still connecting. Retry approval after MetaApi confirms the connection.');
    const {remoteId} = parse(id);
    const info = await call(`https://mt-client-api-v1.${account.region}.agiliumtrade.ai`,`/users/current/accounts/${remoteId}/account-information?refreshTerminalState=true`);
    if (info.platform !== 'mt5' || !['ACCOUNT_TRADE_MODE_DEMO','ACCOUNT_TRADE_MODE_REAL'].includes(info.type)) throw error('A verified MT5 demo or real account is required.',403);
    if (String(info.login) !== String(account.login) || info.server !== account.server) throw error('MetaApi account identity could not be verified.',403);
    if (!Number.isFinite(info.balance) || !Number.isFinite(info.equity) || !/^[A-Z]{3}$/.test(info.currency || '')) throw error('MetaApi account figures are incomplete.');
    return info;
  };
  return {
    mode:'account-data', tradingEnabled:false,
    async connect(account) {
      const localId = account.accountId;
      if (!idPattern.test(localId || '') || !/^\d+$/.test(String(account.login)) || !account.server || !account.password) throw error('Valid MT5 account credentials are required.',400);
      // Exact local-row metadata, never a shared broker login, identifies retries.
      const list = await call(provisioning,`/users/current/accounts?query=${encodeURIComponent(nameFor(localId))}&limit=1000`);
      if (!Array.isArray(list)) throw error('MetaApi returned an invalid accounts list.');
      const matches = list.filter(a => a.metadata?.elitetradeAccountId === localId && a.name === nameFor(localId));
      if (matches.length > 1) throw error('Multiple provider bindings found. Review this connection in MetaApi.');
      let remoteId = matches[0]?._id;
      if (!remoteId) {
        const result = await call(provisioning,'/users/current/accounts','POST',{
          name:nameFor(localId), login:String(account.login), password:account.password, server:account.server,
          platform:'mt5',type:'cloud-g2',region,magic:0,manualTrades:true,
          metadata:{elitetradeAccountId:localId}
        },{'transaction-id':createHash('sha256').update(`elitetrade:${localId}`).digest('hex').slice(0,32)});
        remoteId = result?.id;
      }
      if (!idPattern.test(remoteId || '')) throw error('MetaApi did not return a valid account ID.');
      const id = `metaapi:${localId}:${remoteId}`;
      const details = await metadata(id);
      if (String(details.login) !== String(account.login) || details.server !== account.server) throw error('The provider connection does not match these MT5 details.',403);
      if (details.state === 'UNDEPLOYED') await call(provisioning,`/users/current/accounts/${remoteId}/deploy`,'POST');
      if (details.state !== 'DEPLOYED' || details.connectionStatus !== 'CONNECTED') return {accountId:id,connected:false,pending:true};
      await figures(id,details);
      return {accountId:id,connected:true};
    },
    async snapshot(id) {
      const info = await figures(id);
      return {connected:true,currency:info.currency,balance:info.balance,equity:info.equity,accountType:info.type === 'ACCOUNT_TRADE_MODE_REAL' ? 'real' : 'demo',history:[]};
    },
    async botState() { throw error('No strategy execution state is available.'); },
    async control() { throw error('Automatic trading is not implemented. No order or bot command was sent.'); },
    async disconnect(id) {
      await metadata(id);
      await call(provisioning,`/users/current/accounts/${parse(id).remoteId}`,'DELETE');
      return {disconnected:true};
    }
  };
}
