import {resolveMt5ServerProfile} from './elitebridge-broker-server-profiles.mjs';

// Discovery is provided by an authorized broker directory or authenticated
// terminal gateway. Never infer a broker server from an account number.
export async function discoverMt5Servers({broker,mode,lookup,verify,accountRef}={}){
  if(typeof broker!=='string'||!broker.trim())throw Error('Broker required');
  if(!['demo','real'].includes(mode))throw Error('Account mode required');
  if(typeof lookup!=='function'||typeof verify!=='function')
    throw Error('Verified server discovery provider not configured');
  if(typeof accountRef!=='string'||!accountRef.trim())
    throw Error('Private account reference required');
  const candidates=await lookup({broker,mode,accountRef});
  if(!Array.isArray(candidates)||candidates.length>100)
    throw Error('Server directory unavailable');
  const accepted=[];
  for(const candidate of candidates){
    let profile;
    try{profile=resolveMt5ServerProfile({broker,mode,server:candidate?.server});}
    catch{continue;}
    if(accepted.some(x=>x.server===profile.server))continue;
    // verify must check a real broker-authenticated session; directory labels
    // alone are never considered verified.
    const evidence=await verify({broker,mode,server:profile.server,accountRef});
    if(evidence?.brokerAuthenticated===true&&evidence?.server===profile.server&&
       evidence?.mode===mode&&evidence?.accountRef===accountRef)
      accepted.push(Object.freeze({...profile,brokerAuthenticated:true}));
  }
  return Object.freeze(accepted);
}
