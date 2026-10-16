import {createHash} from 'node:crypto';

export const EXECUTION_ADAPTER_SCHEMA='elitebridge-demo-execution-v1';
// The existing observation gateway fails this contract by design. A descriptor
// is only a capability declaration; broker authentication is a separate check.
export function assertIndependentDemoAdapter(adapter){
  if(adapter?.schema!==EXECUTION_ADAPTER_SCHEMA||adapter.provider!=='elitebridge'||
    adapter.demoOnly!==true||adapter.readOnly!==false||adapter.metaapiRequired!==false)
    throw Error('Independent DEMO execution adapter is not commissioned');
  for(const method of ['snapshot','instrument','preflight','submit','history','modify','close'])
    if(typeof adapter[method]!=='function')throw Error('Independent adapter capability missing: '+method);
  return adapter;
}

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const decimal=value=>typeof value==='string'&&/^[0-9]{1,12}(\.[0-9]{1,8})?$/.test(value)&&Number(value)>0;
const epoch=value=>typeof value==='string'&&/^[0-9]{1,19}$/.test(value);

export function validateIntentCommand(command){
  if(!command||Object.getPrototypeOf(command)!==Object.prototype||
    Object.keys(command).sort().join(',')!=='side,stopLoss,symbol,takeProfit,volume'||
    typeof command.symbol!=='string'||!/^[A-Za-z0-9._-]{3,30}$/.test(command.symbol)||
    !['buy','sell'].includes(command.side)||!['volume','stopLoss','takeProfit'].every(k=>decimal(command[k])))
    throw Error('Invalid DEMO intent command');
  return {...command};
}

// Deliberately excludes strategy configuration version: changing risk/config
// must not turn the same signal into a second order after a restart.
export function executionSignalKey({accountId,botId,timeframe,candleTime,side,signalFamily}){
  if(!uuid(accountId)||!uuid(botId)||!['buy','sell'].includes(side)||
    typeof timeframe!=='string'||!/^[A-Z0-9]{1,8}$/.test(timeframe)||
    !Number.isSafeInteger(candleTime)||candleTime<=0||
    typeof signalFamily!=='string'||!/^[a-z0-9-]{1,50}$/.test(signalFamily))
    throw Error('Invalid strategy signal identity');
  return createHash('sha256').update(JSON.stringify(['enginepro-signal-v1',accountId.toLowerCase(),
    botId.toLowerCase(),timeframe,candleTime,side,signalFamily])).digest('hex');
}

// Trusted worker use only. No broker calls, client credentials or hidden
// MetaApi fallback. Database grants enforce access independently of this client.
export function createEngineProLedger({db,ownerId}){
  if(typeof db?.rpc!=='function'||!uuid(ownerId))throw Error('Trusted ledger client required');
  const fence=(id,generation)=>{
    if(!uuid(id)||!epoch(generation))throw Error('Invalid intent fence');
    return {p_intent_id:id,p_owner:ownerId,p_epoch:generation};
  };
  return Object.freeze({
    claim(accountId){
      if(!uuid(accountId))throw Error('Invalid account scope');
      return db.rpc('elitetrade_enginepro_claim',{p_account_id:accountId,p_owner:ownerId,p_ttl:30});
    },
    prepare({accountId,botId,generation,strategyVersion,signalKey,command}){
      if(!uuid(accountId)||!uuid(botId)||!epoch(generation)||!hash(strategyVersion)||!hash(signalKey))
        throw Error('Invalid durable intent identity');
      return db.rpc('elitetrade_enginepro_prepare',{p_account_id:accountId,p_bot_id:botId,
        p_owner:ownerId,p_epoch:generation,p_strategy_version:strategyVersion,p_signal_key:signalKey,
        p_command:validateIntentCommand(command)});
    },
    load(id,generation){return db.rpc('elitetrade_enginepro_load',fence(id,generation));},
    advance(id,generation,next,receipt=null){
      if(!['validating','ready','submitting','accepted','rejected','unknown','reconciled','cancelled'].includes(next))
        throw Error('Invalid intent transition');
      return db.rpc('elitetrade_enginepro_advance',{...fence(id,generation),p_next:next,p_receipt:receipt});
    }
  });
}
