import {resolveMt5ServerProfile} from './elitebridge-broker-server-profiles.mjs';

// Read-only cloud transport. An authenticated gateway is required; a server
// label alone is not a network endpoint. No order methods are exposed.
export function createCloudMt5Observer({endpoint,token,fetchImpl=fetch,clock=Date.now}={}){
  let base;
  try{base=new URL(endpoint);}catch{throw Error('Gateway HTTPS URL required');}
  if(base.protocol!=='https:'||base.username||base.password||base.hash||base.search)
    throw Error('Gateway must use an unambiguous HTTPS URL');
  if(typeof token!=='string'||!token.trim()||/[\r\n]/.test(token))
    throw Error('Private gateway credential required');
  return Object.freeze({
    mode:'read-only',
    tradingEnabled:false,
    async snapshot({broker,server,mode,accountId,signal}={}){
      const profile=resolveMt5ServerProfile({broker,server,mode});
      if(!accountId||typeof accountId!=='string'||accountId.length>128)
        throw Error('Account binding required');
      const url=new URL(base);
      url.pathname=url.pathname.replace(/\/$/,'')+'/snapshot';
      url.searchParams.set('accountId',accountId);
      url.searchParams.set('mode',profile.mode);
      const response=await fetchImpl(url,{
        method:'GET',redirect:'error',cache:'no-store',signal,
        headers:{Authorization:'Bearer '+token,Accept:'application/json'}
      });
      if(!response.ok)throw Error('Gateway snapshot unavailable');
      const data=await response.json();
      if(data?.authenticated!==true||data?.brokerConnected!==true||
        data?.platform!=='mt5'||data?.mode!==profile.mode||
        data?.server!==profile.server||data?.accountId!==accountId)
        throw Error('Gateway account identity not verified');
      const observed=Date.parse(data.observedAt);
      const age=clock()-observed;
      if(!Number.isFinite(observed)||age< -2000||age>30000)
        throw Error('Gateway snapshot stale');
      if(!Number.isFinite(data.balance)||!Number.isFinite(data.equity)||
        data.balance<0||data.equity<0)
        throw Error('Gateway financial snapshot invalid');
      return Object.freeze({accountId,broker:profile.broker,server:profile.server,
        mode:profile.mode,observedAt:new Date(observed).toISOString(),
        balance:data.balance,equity:data.equity,
        brokerConnected:true,brokerAuthenticated:true,
        tradingEnabled:false,source:'authenticated-cloud-gateway'});
    }
  });
}
