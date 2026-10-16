import {accessSync,constants,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {openGatewayConfig,sealGatewayConfig,privateGatewayFile} from '../src/elitebridge-gateway-vault.mjs';
import {createGatewaySupervisor,gatewayHttpHandler,sdkCollector,validateGatewayConfig} from '../src/elitebridge-gateway-runtime.mjs';

// The gateway binds ONLY loopback. A trusted HTTPS proxy is required for the
// Vercel consumer. Never expose this port through a public container mapping.
async function main(){
  const mode=process.argv[2],env=process.env;
  if(mode==='seal'){
    if(process.stdin.isTTY)throw Error('Supply private configuration through stdin from a secret manager; never put it in argv');
    let raw='';for await(const part of process.stdin){raw+=part;if(raw.length>16384)throw Error('Configuration too large');}
    const config=JSON.parse(raw);validateGatewayConfig(config);
    // New destination only; refuse accidental overwrite or key rotation.
    const key=randomBytes(32);
    writeFileSync(env.ELITEBRIDGE_GATEWAY_KEY_FILE,key,{mode:0o600,flag:'wx'});
    writeFileSync(env.ELITEBRIDGE_GATEWAY_VAULT_FILE,JSON.stringify(sealGatewayConfig(config,key)),{mode:0o600,flag:'wx'});
    console.log('Private DEMO gateway configuration sealed. No broker session tested.');return;
  }
  if(!['check','serve'].includes(mode))throw Error('Use seal, check, or serve');
  const config=validateGatewayConfig(openGatewayConfig(JSON.parse(privateGatewayFile(env.ELITEBRIDGE_GATEWAY_VAULT_FILE)),privateGatewayFile(env.ELITEBRIDGE_GATEWAY_KEY_FILE)));
  const executable=env.ELITEBRIDGE_GATEWAY_EXECUTABLE;
  const args=JSON.parse(env.ELITEBRIDGE_GATEWAY_ARGS||'[]');
  if(typeof executable!=='string'||!executable.startsWith('/')||!Array.isArray(args)||!args.length||!args.every(x=>typeof x==='string'))throw Error('Configure an absolute reviewed SDK launcher and argument array');
  accessSync(executable,constants.X_OK); // launcher existence, not broker availability
  if(mode==='check'){console.log('Encrypted configuration and launcher path valid. Broker connection UNVERIFIED.');return;}
  const audit=value=>console.log(JSON.stringify({...value,at:new Date().toISOString()}));
  const supervisor=createGatewaySupervisor({config,collect:sdkCollector({executable,args,config}),audit});
  const server=createServer(gatewayHttpHandler({config,supervisor,audit}));
  server.on('error',async()=>{
    stopped=true;clearTimeout(timer);await supervisor.stop();
    console.error('Gateway listener unavailable. No broker data published.');process.exitCode=1;
  });
  server.requestTimeout=5000;server.headersTimeout=5000;server.maxHeadersCount=20;
  const port=Number(env.ELITEBRIDGE_GATEWAY_PORT||8787);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid gateway port');
  let stopped=false,timer;
  const cycle=async()=>{
    await supervisor.refresh();
    if(!stopped&&supervisor.status().state!=='blocked')timer=setTimeout(cycle,supervisor.delay());
  };
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{
    stopped=true;clearTimeout(timer);await supervisor.stop();server.close();
  });
  server.listen(port,'127.0.0.1',()=>{audit({event:'elitebridge.gateway',state:'listening-read-only'});void cycle();});
}
main().catch(()=>{console.error('Gateway startup blocked. Inspect private configuration and permissions. No credentials logged.');process.exitCode=1;});
