// EliteBridge: authenticated, DEMO-ONLY telemetry ingestion into the
// existing private Supabase device registry. No order or broker adapter.
import {createEliteBridgeRegistry} from './elitebridge-registry.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const exact=(value,fields)=>value!==null && typeof value==='object' &&
  !Array.isArray(value) && Object.keys(value).length===fields.length &&
  fields.every(field=>Object.hasOwn(value,field));
const reject=(reason)=>{throw new Error('EliteBridge telemetry: '+reason)};
function validate(packet){
  if(!exact(packet,['version','kind','accountId','deviceId','sequence','messageId',
    'issuedAt','expiresAt','payload','signature']))reject('invalid packet format');
  if(!['terminal.heartbeat','terminal.quote'].includes(packet.kind))
    reject('terminal DEMO telemetry only');
  if(typeof packet.accountId!=='string'||!uuid.test(packet.accountId)||
    typeof packet.deviceId!=='string'||!uuid.test(packet.deviceId))
    reject('invalid device scope');
  if(packet?.payload?.accountType!=='demo')reject('DEMO accounts only');
  if(!Number.isSafeInteger(packet.sequence)||packet.sequence<1)
    reject('invalid sequence');
  // Reject payload amplification before hitting privileged Postgres.
  let size;
  try{size=Buffer.byteLength(JSON.stringify(packet))}catch{reject('invalid packet')}
  if(size>4096)reject('packet exceeds DEMO telemetry size limit');
}

export function createSupabaseBridgeTelemetry({db,clock=()=>Date.now()}={}){
  if(!db||typeof db.rpc!=='function')reject('private Supabase RPC required');
  const registry=createEliteBridgeRegistry({db});
  return {
    async accept({ownerId,packet}={}){
      if(typeof ownerId!=='string'||!uuid.test(ownerId))reject('authenticated owner required');
      validate(packet);
      const result=await registry.verifySignedDemo({
        ownerId,accountId:packet.accountId,deviceId:packet.deviceId,
        packet,nowMs:clock()
      });
      if(result.verified!==true||result.demoOnly!==true||
        result.actionsAllowed!==false||result.brokerVerified!==false)
        reject('verification did not fail closed');
      // Only accepted signatures are written by the atomic Supabase claim RPC.
      // The heartbeat/quote is NOT an MT5 data source.
      return {
        accepted:true,kind:result.kind,sequence:result.sequence,
        messageId:packet.messageId,demoOnly:true,brokerVerified:false,
        independentMT5Connected:false,ordersEnabled:false
      };
    }
  };
}
