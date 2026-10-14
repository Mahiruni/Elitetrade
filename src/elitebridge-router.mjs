import {bridgeProviderForBinding} from './elitebridge.mjs';

// Phase 2 broker-neutral, read-only routing. Trading and account mutations are
// deliberately excluded. The live DEMO engine continues to use its unchanged
// MetaApi gateway and server-side risk/lease/order controls.
const VALID_SYMBOL=/^[A-Za-z0-9._-]{3,30}$/;
const VALID_STATUS=new Set(['DEPLOYED','DEPLOYING','UNDEPLOYED','UNKNOWN']);
const VALID_CONNECTION=new Set(['CONNECTED','DISCONNECTED','DISCONNECTED_FROM_BROKER','UNKNOWN']);
const safeError=(message)=>({state:'unavailable',message});

export function createReadOnlyBrokerRouter({metaapi,clock=()=>Date.now()}={}) {
  return {
    async probe({account,symbol='XAUUSDm'}={}) {
      if(!account || typeof account!=='object')throw new Error('Saved account is required.');
      if(!VALID_SYMBOL.test(symbol))throw new Error('Invalid MT5 symbol.');
      const provider=bridgeProviderForBinding(account.gateway_id);
      const base={provider:provider||'unverified',readOnly:true,executedOrder:false,symbol,
        checkedAt:new Date(clock()).toISOString()};
      if(!provider)return {...base,state:'unsupported-binding',message:'No supported verified MT5 provider is bound.',market:{state:'not-checked'}};
      if(account.status!=='connected')return {...base,state:'saved-disconnected',
        message:'The saved MT5 binding is not connected. Recheck it in MT5 settings.',
        market:{state:'not-checked'}};
      const adapter=provider==='metaapi'?metaapi:null;
      if(adapter?.mode!=='account-data' || typeof adapter.connectionHealth!=='function' || typeof adapter.previewMarket!=='function')
        return {...base,state:'unavailable',message:'The selected broker provider is not configured.',market:{state:'not-checked'}};
      let health;
      try{health=await adapter.connectionHealth(account.gateway_id);}
      catch{
        return {...base,...safeError('Broker verification is temporarily unavailable. Retry later.'),
          market:{state:'not-checked'}};
      }
      const hostingState=VALID_STATUS.has(health?.hostingState)?health.hostingState:'UNKNOWN';
      const connectionStatus=VALID_CONNECTION.has(health?.connectionStatus)?health.connectionStatus:'UNKNOWN';
      const verification={hostingState,connectionStatus,
        brokerVerified:health?.brokerVerified===true,
        accountType:health?.accountType==='demo'?'demo':health?.accountType==='real'?'real':null,
        tradeAllowed:health?.tradeAllowed===true};
      if(verification.accountType==='real')
        return {...base,state:'real-account-blocked',verification,
          message:'Only broker-verified DEMO accounts can be probed in EliteBridge.',
          market:{state:'blocked'}};
      if(!verification.brokerVerified||verification.accountType!=='demo'||connectionStatus!=='CONNECTED'||hostingState!=='DEPLOYED')
        return {...base,state:'broker-unverified',verification,
          message:'The MT5 DEMO broker session has not passed all live connection checks.',
          market:{state:'not-checked'}};
      let feed;
      try{feed=await adapter.previewMarket(account.gateway_id,symbol,'5m');}
      catch{
        return {...base,state:'verified-demo',verification,
          message:'The demo connection is verified, but its live quote is temporarily unavailable.',
          market:{state:'unavailable'}};
      }
      const brokerDemo=feed?.info?.platform==='mt5' && feed?.info?.type==='ACCOUNT_TRADE_MODE_DEMO';
      if(!brokerDemo)return {...base,state:'broker-unverified',verification,
        message:'The market feed did not reconfirm an MT5 DEMO account.',
        market:{state:'blocked'}};
      const bid=feed?.quote?.bid,ask=feed?.quote?.ask;
      const quoteTime=Date.parse(feed?.quote?.time||'');
      const now=clock();
      const age=Math.round((now-quoteTime)/1000);
      if(feed?.quote?.symbol!==symbol||!Number.isFinite(bid)||bid<=0||
         !Number.isFinite(ask)||ask<bid||!Number.isFinite(age)||age < -30 ||age>180)
        return {...base,state:'verified-demo',verification,
          message:'The MT5 DEMO connection is verified, but the quote is stale or invalid.',
          market:{state:'stale-or-invalid'}};
      return {...base,state:'verified-demo',verification,
        message:'Broker-verified MT5 DEMO connection and a fresh read-only quote. No order sent.',
        market:{state:'fresh',quote:{bid,ask,spread:Number((ask-bid).toFixed(6)),
          quoteAt:new Date(quoteTime).toISOString(),ageSeconds:Math.max(0,age)},
          timeframe:'5m',executionApproved:false}};
    }
  };
}
