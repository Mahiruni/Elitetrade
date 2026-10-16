import {resolveMt5ServerProfile} from './elitebridge-broker-server-profiles.mjs';
import {validateGatewaySnapshot} from './elitebridge-gateway-snapshot.mjs';

// Read-only cloud transport. The remote gateway must authenticate against MT5.
// This client does not prove the gateway is connected until a valid snapshot arrives.
export function createCloudMt5Observer({endpoint,token,fetchImpl=fetch,clock=Date.now}={}){
  let base;
  try{base=new URL(endpoint);}catch{throw Error('Gateway HTTPS URL required');}
  if(base.protocol!=='https:'||base.username||base.password||base.hash||base.search)
    throw Error('Gateway must use an unambiguous HTTPS URL');
  if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))
    throw Error('Private gateway credential required');
  return Object.freeze({
    mode:'read-only',tradingEnabled:false,
    async snapshot({broker,server,mode,accountId,login,symbol='XAUUSDm',signal}={}){
      const profile=resolveMt5ServerProfile({broker,server,mode});
      if(mode!=='demo')throw Error('REAL account cloud access is locked');
      if(typeof login!=='string'||!/^[1-9][0-9]{0,15}$/.test(login))throw Error('Expected MT5 login required');
      if(typeof accountId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId))
        throw Error('Valid account binding required');
      const url=new URL(base);
      url.pathname=url.pathname.replace(/\/$/,'')+'/snapshot';
      url.searchParams.set('accountId',accountId);
      url.searchParams.set('mode',profile.mode);
      const timeout=AbortSignal.timeout(10000);
      const combined=signal?AbortSignal.any([signal,timeout]):timeout;
      const response=await fetchImpl(url,{
        method:'GET',redirect:'error',cache:'no-store',signal:combined,
        headers:{Authorization:'Bearer '+token,Accept:'application/json'}
      });
      if(!response.ok)throw Error('Gateway snapshot unavailable');
      const data=await response.json();
      if(data?.authenticated!==true||data?.brokerConnected!==true||
        data?.platform!=='mt5'||data?.mode!==profile.mode||
        data?.server!==profile.server||data?.accountId!==accountId||
        typeof data.broker!=='string'||data.broker.trim().toLowerCase()!==profile.broker)
        throw Error('Gateway account identity not verified');
      if(typeof data.observedAt!=='string'||!/\d{4}-\d\d-\d\dT/.test(data.observedAt))
        throw Error('Gateway timestamp invalid');
      const observed=Date.parse(data.observedAt);
      const age=clock()-observed;
      if(!Number.isFinite(observed)||age< -2000||age>30000)
        throw Error('Gateway snapshot stale');
      if(typeof data.balance!=='number'||typeof data.equity!=='number'||
        !Number.isFinite(data.balance)||!Number.isFinite(data.equity)||
        data.balance<0||data.equity<0)
        throw Error('Gateway financial snapshot invalid');
      return Object.freeze(validateGatewaySnapshot(data,{broker,server,mode,accountId,login,symbol},clock));
    }
  });
}
