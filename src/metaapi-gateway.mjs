import { createHash } from 'node:crypto';
const provisioning = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai';
const idPattern = /^[a-zA-Z0-9_-]{1,128}$/;
const error = (message, status = 503) => Object.assign(new Error(message), { status });
const nameFor = id => `EliteTrade ${id}`;
const providerErrors = new Map([
  ['E_SRV_NOT_FOUND', 'MetaApi could not find this broker server for MT5. Copy the exact MT5 server from your broker account details. If it is correct, configure a provisioning profile in MetaApi.'],
  ['E_AUTH', 'The broker rejected the MT5 login. Confirm this is an MT5 account, its exact assigned server, and its trading or investor password.'],
  ['E_SERVER_TIMEZONE', 'MetaApi could not detect the broker settings. Retry later or configure a provisioning profile in MetaApi.'],
  ['E_RESOURCE_SLOTS', 'This account needs more MetaApi resource slots. Review the required capacity and cost in MetaApi before connecting.'],
  ['E_NO_SYMBOLS', 'The broker account has no configured trading symbols. Check the account with your broker.'],
  ['ERR_OTP_REQUIRED', 'This broker account requires a one-time password that MetaApi cannot use. Review the account authentication settings with your broker.'],
  ['E_PASSWORD_CHANGE_REQUIRED', 'The broker requires a trading-account password change. Change it with your broker, then update the saved account details.'],
  ['E_TRADING_ACCOUNT_DISABLED', 'The broker reports this trading account is disabled. Contact the broker or use an active MT5 account.']
]);
const providerErrorNames = new Set(['ValidationError','UnauthorizedError','ForbiddenError','NotFoundError','TooManyRequestsError','QuotaExceededError','InternalError']);

function requestOperation(path, method) {
  const route = path.split('?')[0];
  if (route === '/users/current/accounts') return method === 'POST' ? 'create-account' : 'list-accounts';
  if (route.endsWith('/deploy')) return 'deploy-account';
  if (route.endsWith('/account-information')) return 'account-information';
  if (/^\/users\/current\/accounts\/[^/]+$/.test(route)) return method === 'DELETE' ? 'delete-account' : 'read-account';
  return 'account-request';
}

async function providerFailure(response, path, method) {
  let data;
  try {
    const raw = await response.text();
    try { data = JSON.parse(raw); } catch { data = {message:raw}; }
  } catch { /* A response body can be unavailable after a transport failure. */ }
  const candidate = typeof data?.details === 'string' ? data.details : data?.details?.code;
  const code = providerErrors.has(candidate) ? candidate : 'UNKNOWN';
  const operation = requestOperation(path, method);
  const balanceBlocked = code === 'UNKNOWN' && ['create-account','deploy-account'].includes(operation) && [400,402,403].includes(response.status)
    && typeof data?.message === 'string' && /\binsufficient\s+balance\b/i.test(data.message);
  // Allowlisted codes only: never expose provider messages, details, URLs or credentials.
  console.warn(JSON.stringify({event:'metaapi.response',operation,method,status:response.status,code,
    name:providerErrorNames.has(data?.error) ? data.error : 'UNKNOWN',
    ...(balanceBlocked ? {reason:'insufficient-provider-balance'} : {})}));
  let message;
  if (balanceBlocked) message = 'MetaApi hosting balance is insufficient. The website administrator must add funds in MetaApi Billing, then retry approval.';
  else if (response.status === 401) message = 'MetaApi rejected the API token. Replace METAAPI_TOKEN with a valid API token in Vercel Production, then redeploy.';
  else if (response.status === 403) message = 'MetaApi access was denied. Check the server-side token permissions and provider account restrictions in the MetaApi dashboard.';
  else if (response.status === 429) message = 'MetaApi rate limit reached. Wait before retrying.';
  else if (response.status === 400) {
    if (operation === 'create-account' && providerErrors.has(code)) message = `${providerErrors.get(code)} (${code})`;
    else message = `MetaApi rejected the ${operation.replaceAll('-',' ')} request (HTTP 400). Check the MetaApi dashboard; the server recorded a safe diagnostic. This response does not confirm that the password is wrong.`;
  } else message = 'MetaApi could not complete the account request. Check the provider dashboard.';
  return Object.assign(error(message),{providerCode:code,providerStatus:response.status,providerOperation:operation,
    ...(balanceBlocked ? {providerReason:'insufficient-provider-balance'} : {})});
}

function normalizeToken(value) {
  const trim = text => text.replace(/^[\s\u200b\u200c\u200d\u2060\ufeff]+|[\s\u200b\u200c\u200d\u2060\ufeff]+$/gu, '');
  const quotes = new Map([['"','"'],["'","'"],['`','`'],['“','”'],['‘','’']]);
  let token = trim(String(value));
  for (let pass = 0; pass < 3; pass++) {
    const closing = quotes.get(token[0]);
    if (token.length >= 2 && closing && token.endsWith(closing)) token = trim(token.slice(1,-1));
    token = trim(token.replace(/^Bearer\s+/i, ''));
  }
  // Only a structurally valid JWT can safely recover internal copy/paste wraps.
  // Opaque tokens with internal whitespace remain invalid; never join arbitrary text.
  const compact = token.replace(/[\s\u200b\u200c\u200d\u2060\ufeff]/gu, '');
  if (compact !== token && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(compact)) {
    try {
      const [header,payload] = compact.split('.').slice(0,2).map(part => JSON.parse(Buffer.from(part,'base64url').toString('utf8')));
      if (header && !Array.isArray(header) && typeof header.alg === 'string' && header.alg && payload && typeof payload === 'object' && !Array.isArray(payload)) return compact;
    } catch { /* Preserve the original invalid value for the request-time guard. */ }
  }
  return token;
}

export function createMetaApiGateway(env, fetchImpl = fetch) {
  if (!env.METAAPI_TOKEN) return null;
  const token = normalizeToken(env.METAAPI_TOKEN);
  const region = env.METAAPI_REGION || 'new-york';
  if (!/^[a-z][a-z0-9-]{0,40}$/.test(region)) throw error('Invalid MetaApi region.');
  const call = async (base, path, method = 'GET', body, extra = {}) => {
    if (!token || /\s|[^\x21-\x7e]/.test(token)) throw error('METAAPI_TOKEN contains spaces or invalid characters. Paste only the API token in Vercel, then redeploy.');
    let response;
    for (let attempt=0; attempt < (method === 'GET' ? 2 : 1); attempt++) {
     try {
      response = await fetchImpl(new URL(path, base), {
        method, redirect:'error', signal:AbortSignal.timeout(20000),
        headers:{ 'auth-token':token, Accept:'application/json', 'Content-Type':'application/json', ...extra },
        ...(body ? {body:JSON.stringify(body)} : {})
      });
       break;
     } catch (failure) {
       const code = failure?.cause?.code || failure?.code || failure?.name;
       const kind = ['TimeoutError','AbortError','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(code) ? 'timeout' : ['ENOTFOUND','EAI_AGAIN'].includes(code) ? 'dns' : ['ECONNRESET','ECONNREFUSED','UND_ERR_SOCKET'].includes(code) ? 'network' : 'request';
       // Never log provider response bodies, tokens or submitted account credentials.
       console.warn(JSON.stringify({event:'metaapi.transport',host:new URL(base).hostname,method,kind}));
       if(method === 'GET' && attempt === 0 && kind !== 'request') continue;
       if(kind === 'timeout') throw error('MetaApi connection timed out. Retry approval shortly; any created account will be reused.');
       if(kind === 'dns') throw error('The website server could not resolve the MetaApi API address. Check provider DNS availability and retry.');
       if(kind === 'network') throw error('The website server could not establish a connection to MetaApi. Retry approval shortly.');
       throw error('MetaApi request could not be sent. Check METAAPI_TOKEN formatting in Vercel and redeploy; provider diagnostics have been recorded.');
     }
    }
    if (response.status === 202) throw error('MetaApi is processing this connection. Retry approval later; the same request will be resumed.');
    if (!response.ok) throw await providerFailure(response,path,method);
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
          metadata:{elitetradeAccountId:localId},
          ...(typeof account.broker === 'string' && account.broker.trim() ? {keywords:[account.broker.trim()]} : {})
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
      const account=await metadata(id),info=await figures(id,account);
      const base=`https://mt-client-api-v1.${account.region}.agiliumtrade.ai`;
      // A positions permission/outage must not hide otherwise available account figures.
      const positions=await call(base,`/users/current/accounts/${parse(id).remoteId}/positions?refreshTerminalState=true`).catch(()=>null);
      const profit=Array.isArray(positions)&&positions.every(p=>Number.isFinite(p?.profit)) ? positions.reduce((total,p)=>total+p.profit,0) : undefined;
      return {connected:true,currency:info.currency,balance:info.balance,equity:info.equity,...(Number.isFinite(profit)?{profit}:{}),...(Array.isArray(positions)?{positions}:{}),accountType:info.type === 'ACCOUNT_TRADE_MODE_REAL' ? 'real' : 'demo',history:[]};
    },
    async market(id,symbol,timeframe) {
      if (!/^[A-Za-z0-9._-]{3,30}$/.test(symbol) || !['5m','15m'].includes(timeframe)) throw error('Invalid strategy market request.',400);
      const account=await metadata(id),info=await figures(id,account);
      const {remoteId}=parse(id),base=`https://mt-client-api-v1.${account.region}.agiliumtrade.ai`,path=`/users/current/accounts/${remoteId}`;
      const [quote,spec,positions,orders,candles]=await Promise.all([
        call(base,`${path}/symbols/${encodeURIComponent(symbol)}/current-price`),
        call(base,`${path}/symbols/${encodeURIComponent(symbol)}/specification`),
        call(base,`${path}/positions?refreshTerminalState=true`),
        call(base,`${path}/orders?refreshTerminalState=true`),
        call(`https://mt-market-data-client-api-v1.${account.region}.agiliumtrade.ai`,`${path}/historical-market-data/symbols/${encodeURIComponent(symbol)}/timeframes/${timeframe}/candles?limit=120`)
      ]);
      if(!Array.isArray(positions)||!Array.isArray(orders))throw error('Invalid broker positions or orders.');
      return {info,quote,spec,positions,orders,candles};
    },
    async margin(id,plan) {
      const a=await metadata(id);
      return call(`https://mt-client-api-v1.${a.region}.agiliumtrade.ai`,`/users/current/accounts/${parse(id).remoteId}/calculate-margin`,'POST',{
        symbol:plan.symbol,type:plan.actionType,volume:plan.volume,openPrice:plan.openPrice
      });
    },
    async demoOrder(id,plan,receiptId) {
      if(env.DEMO_EXECUTION_ENABLED!=='true')throw error('Demo execution is disabled on this worker.');
      const a=await metadata(id),info=await figures(id,a);
      if(info.type!=='ACCOUNT_TRADE_MODE_DEMO'||info.tradeAllowed!==true||info.investorMode!==false)throw error('Only trade-enabled demo accounts can receive engine orders.',403);
      if(!['ORDER_TYPE_BUY','ORDER_TYPE_SELL'].includes(plan.actionType)||!Number.isFinite(plan.volume)||plan.volume<=0||!Number.isFinite(plan.stopLoss)||plan.stopLoss<=0||!Number.isFinite(plan.takeProfit)||plan.takeProfit<=0||!idPattern.test(receiptId||''))throw error('Invalid protected demo order.',400);
      const result=await call(`https://mt-client-api-v1.${a.region}.agiliumtrade.ai`,`/users/current/accounts/${parse(id).remoteId}/trade`,'POST',{
        actionType:plan.actionType,symbol:plan.symbol,volume:plan.volume,stopLoss:plan.stopLoss,takeProfit:plan.takeProfit,
        comment:'ET',clientId:`ET_D_${receiptId.replaceAll('-','').slice(0,16)}`
      });
      if(result?.numericCode!==10009||result?.stringCode!=='TRADE_RETCODE_DONE'||!(result.orderId||result.positionId))throw error('Demo order outcome requires reconciliation in MetaApi.');
      return {orderId:result.orderId||null,positionId:result.positionId||null,numericCode:result.numericCode,stringCode:result.stringCode};
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
