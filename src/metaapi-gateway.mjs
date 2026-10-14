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
  if (/\/symbols\/[^/]+\/current-price$/.test(route)) return 'symbol-price';
  if (/\/symbols\/[^/]+\/specification$/.test(route)) return 'symbol-specification';
  if (/\/historical-market-data\/symbols\/[^/]+\/timeframes\/[^/]+\/candles$/.test(route)) return 'historical-candles';
  if (/\/accounts\/[^/]+\/symbols$/.test(route)) return 'symbol-list';
  if (/\/accounts\/[^/]+\/positions$/.test(route)) return 'positions';
  if (/\/accounts\/[^/]+\/orders$/.test(route)) return 'orders';
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
  else if (response.status === 404) {
    if (['symbol-price','symbol-specification','historical-candles'].includes(operation))
      message = 'MetaApi cannot retrieve this broker instrument right now (HTTP 404). The symbol may have a suffix or may not be subscribed; select Check broker symbols and use the exact broker name. A newly connected account may also need time to initialize.';
    else if (operation === 'symbol-list')
      message = 'MetaApi cannot read this account\'s symbol list yet (HTTP 404). Confirm the account is Connected in MetaApi and retry later.';
    else if (operation === 'read-account')
      message = 'MetaApi cannot find the hosted account. Confirm it still exists and is deployed in the provider dashboard.';
    else
      message = 'MetaApi reports this broker resource is not available (HTTP 404). Check account provisioning and symbol access in MetaApi.';
  }
  else if ([500,502,503,504].includes(response.status))
    message = `MetaApi ${operation.replaceAll('-',' ')} is temporarily unavailable (HTTP ${response.status}). The MT5 connection is not necessarily lost. Retry after the provider recovers.`;
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
       // Node fetch often surfaces a transport failure as TypeError: fetch failed,
       // with an unfamiliar low-level cause code. Do not diagnose that as a bad
       // METAAPI_TOKEN: only a provider HTTP 401 establishes a rejected token.
       const kind = ['TimeoutError','AbortError','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(code) ? 'timeout' : ['ENOTFOUND','EAI_AGAIN'].includes(code) ? 'dns' : ['ECONNRESET','ECONNREFUSED','UND_ERR_SOCKET'].includes(code) || failure instanceof TypeError ? 'network' : 'request';
       // Never log provider response bodies, tokens or submitted account credentials.
       console.warn(JSON.stringify({event:'metaapi.transport',host:new URL(base).hostname,method,kind}));
       if(method === 'GET' && attempt === 0 && kind !== 'request') continue;
       if(kind === 'timeout') throw error('MetaApi timed out while responding to EliteTrade. Check MT5 connection status, then retry later. If this was a trade request, reconcile it in MT5 before retrying.');
       if(kind === 'dns') throw error('EliteTrade could not resolve the MetaApi service address. This is an upstream network issue, not proof that your MT5 login or Vercel configuration is wrong.');
       if(kind === 'network') throw error('EliteTrade could not establish a network connection to MetaApi for this request. Check MT5 status and retry after the provider recovers. Your API token has not been confirmed invalid.');
       throw error('EliteTrade could not complete the MetaApi request. Check MetaApi connection diagnostics before retrying; this is not evidence that Vercel environment variables need updating.');
     }
    }
    if (response.status === 202) throw error('MetaApi is processing this connection. Retry approval later; the same request will be resumed.');
    if (!response.ok) throw await providerFailure(response,path,method);
    if (response.status === 204) return null;
    try { return await response.json(); } catch { throw error('MetaApi returned an invalid response.'); }
  };
  const parse = id => {
    const parts = String(id).split(':');
    if (parts.length !== 3 || !['metaapi','metaapi-existing'].includes(parts[0]) || !parts.slice(1).every(p => idPattern.test(p))) throw error('Invalid hosted account binding.',403);
    return {localId:parts[1],remoteId:parts[2],imported:parts[0] === 'metaapi-existing'};
  };
  const metadata = async id => {
    const {localId,remoteId,imported} = parse(id);
    const account = await call(provisioning,`/users/current/accounts/${remoteId}`);
    if (account._id !== remoteId || (imported
      ? (account.metadata?.elitetradeAccountId != null && account.metadata.elitetradeAccountId !== localId)
      : (account.metadata?.elitetradeAccountId !== localId || account.name !== nameFor(localId)))) throw error('MetaApi account ownership could not be verified.',403);
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
    // Attach an already hosted account without creating or redeploying a second paid instance.
    // Called only by an authenticated administrator after verifying the matching local MT5 row.
    async adoptDemo(account,remoteId) {
      if (!idPattern.test(account?.accountId || '') || !idPattern.test(remoteId || '') || !/^\d+$/.test(String(account?.login || '')) || !account?.server) throw error('Invalid account binding request.',400);
      const hosted=await call(provisioning,`/users/current/accounts/${remoteId}`);
      // MetaApi's provisioning read-account response can omit 'platform'; its
      // connected broker account-information endpoint is authoritative for MT5.
      // If provisioning *does* explicitly report a non-MT5 platform, refuse it.
      if (hosted?._id !== remoteId || String(hosted.login) !== String(account.login) || hosted.server !== account.server) throw error('The hosted account does not match the saved MT5 login and broker server.',409);
      if (hosted.platform != null && hosted.platform !== 'mt5') throw error('The hosted MetaApi account is not an MT5 account.',409);
      if (hosted.metadata?.elitetradeAccountId != null && hosted.metadata.elitetradeAccountId !== account.accountId) throw error('This hosted account belongs to another EliteTrade record.',409);
      if (hosted.state !== 'DEPLOYED' || hosted.connectionStatus !== 'CONNECTED') throw error('Connect the hosted MetaApi account before importing it.',409);
      const id=`metaapi-existing:${account.accountId}:${remoteId}`;
      const info=await figures(id,hosted);
      if (info.type !== 'ACCOUNT_TRADE_MODE_DEMO') throw error('Only a broker-verified DEMO account can be imported using this action.',409);
      return {accountId:id,connected:true,tradingAllowed:info.tradeAllowed === true && info.investorMode === false};
    },
    // Read-only live connection diagnostics; keep broker type unverified if
    // the provider is disconnected or the account-information API times out.
    async connectionHealth(id) {
      const hosted=await metadata(id);
      const hostingState=['CREATED','DEPLOYING','DEPLOYED','DEPLOY_FAILED','UNDEPLOYING','UNDEPLOYED','UNDEPLOY_FAILED','REDEPLOY_FAILED'].includes(hosted.state) ? hosted.state : 'UNKNOWN';
      const connectionStatus=['CONNECTED','DISCONNECTED','DISCONNECTED_FROM_BROKER'].includes(hosted.connectionStatus) ? hosted.connectionStatus : 'UNKNOWN';
      const base={hostingState,connectionStatus,brokerVerified:false,accountType:null,executionEnabled:false};
      if(hostingState!=='DEPLOYED')
        return {...base,message:'MetaApi hosting is not fully deployed. Review this account in the MetaApi MT Accounts dashboard.'};
      if(connectionStatus==='DISCONNECTED_FROM_BROKER')
        return {...base,message:'MetaApi reports that the MT5 terminal cannot connect to the broker. Check the MT5 trading login, exact server, broker access and MetaApi account diagnostics; wait for Connected.'};
      if(connectionStatus!=='CONNECTED')
        return {...base,message:'MetaApi terminal is not currently connected. Wait until its MT Accounts dashboard reports Connected; this does not mean the EliteTrade link was lost.'};
      try {
        const info=await figures(id,hosted);
        return {...base,brokerVerified:true,accountType:info.type==='ACCOUNT_TRADE_MODE_DEMO'?'demo':'real',
          tradeAllowed:info.tradeAllowed===true&&info.investorMode===false,
          message:info.type==='ACCOUNT_TRADE_MODE_DEMO'?
            'MetaApi hosting and broker account data are connected. This is a verified demo account; demo worker and risk checks are still required for orders.':
            'This is a REAL account. Demo trade execution must remain disabled.'};
      } catch (failure) {
        if(![500,502,503,504].includes(failure.providerStatus))throw failure;
        return {...base,providerStatus:failure.providerStatus,
          message:'MetaApi reports Connected, but the broker account-information API is temporarily unavailable. The account type cannot be safely verified. Wait for the provider to recover; no order will be placed.'};
      }
    },
    // Read-only broker symbol discovery. Do not infer or auto-substitute an instrument.
    async goldSymbols(id,requestedSymbol='XAUUSD') {
      if(!/^[A-Za-z0-9._-]{3,30}$/.test(requestedSymbol))throw error('Invalid symbol.',400);
      const account=await metadata(id),info=await figures(id,account);
      if(info.type!=='ACCOUNT_TRADE_MODE_DEMO')throw error('A broker-verified DEMO account is required.',403);
      const {remoteId}=parse(id);
      const symbols=await call(`https://mt-client-api-v1.${account.region}.agiliumtrade.ai`,`/users/current/accounts/${remoteId}/symbols`);
      if(!Array.isArray(symbols)||symbols.length>50000||symbols.some(s=>typeof s!=='string'))throw error('MetaApi returned an invalid broker symbol list.');
      const exactAvailable=symbols.includes(requestedSymbol);
      const goldSymbols=[...new Set(symbols.filter(s=>/^(?:XAU|GOLD)[A-Za-z0-9._-]{0,26}$/i.test(s)))].sort((a,b)=>a.localeCompare(b)).slice(0,40);
      return {requestedSymbol,exactAvailable,goldSymbols,accountType:'demo',executionEnabled:false};
    },
    async snapshot(id) {
      const account=await metadata(id),info=await figures(id,account);
      const base=`https://mt-client-api-v1.${account.region}.agiliumtrade.ai`;
      // A positions permission/outage must not hide otherwise available account figures.
      const positions=await call(base,`/users/current/accounts/${parse(id).remoteId}/positions?refreshTerminalState=true`).catch(()=>null);
      const profit=Array.isArray(positions)&&positions.every(p=>Number.isFinite(p?.profit)) ? positions.reduce((total,p)=>total+p.profit,0) : undefined;
      return {connected:true,currency:info.currency,balance:info.balance,equity:info.equity,...(Number.isFinite(profit)?{profit}:{}),...(Array.isArray(positions)?{positions}:{}),accountType:info.type === 'ACCOUNT_TRADE_MODE_REAL' ? 'real' : 'demo',history:[]};
    },
    // Separate, authenticated read-only OHLCV path for the POI research workspace.
    // Does not expose provider credentials or support trading actions.
    async poiMarket(id,symbol) {
      if(!/^[A-Za-z0-9._-]{3,30}$/.test(symbol))throw error('Invalid broker symbol.',400);
      const account=await metadata(id),info=await figures(id,account);
      const remoteId=parse(id).remoteId;
      const root='/users/current/accounts/'+remoteId;
      const base='https://mt-client-api-v1.'+account.region+'.agiliumtrade.ai';
      const history='https://mt-market-data-client-api-v1.'+account.region+'.agiliumtrade.ai';
      const frames={w1:'1w',h4:'4h',m15:'15m',m5:'5m'};
      const [quote,spec,...datasets]=await Promise.all([
        call(base,root+'/symbols/'+encodeURIComponent(symbol)+'/current-price'),
        call(base,root+'/symbols/'+encodeURIComponent(symbol)+'/specification'),
        ...Object.values(frames).map(frame=>call(history,root+'/historical-market-data/symbols/'+encodeURIComponent(symbol)+'/timeframes/'+frame+'/candles?limit=120'))
      ]);
      if(datasets.some(data=>!Array.isArray(data)))throw error('The broker returned an incomplete multi-timeframe candle response.');
      return {info,quote,spec,timeframes:Object.fromEntries(Object.keys(frames).map((frame,i)=>[frame,datasets[i]]))};
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
      // An imported account remains managed in MetaApi. Removing the EliteTrade link
      // must never delete the user's existing hosted account or incur a replacement.
      if (parse(id).imported) return {disconnected:true,hostedAccountPreserved:true};
      await metadata(id);
      await call(provisioning,`/users/current/accounts/${parse(id).remoteId}`,'DELETE');
      return {disconnected:true};
    }
  };
}
