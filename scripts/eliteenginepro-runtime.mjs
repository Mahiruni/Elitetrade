import {createEliteEngineProRuntime} from '../src/eliteenginepro-runtime.mjs';
if(process.env.ELITEENGINEPRO_MODE!=='compatibility')throw Error('Only no-credentials SDK compatibility commissioning is available');
const port=Number(process.env.PORT||10000);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid runtime port');
const runtime=createEliteEngineProRuntime({audit:entry=>console.log(JSON.stringify(entry))});
runtime.server.on('error',async()=>{console.error('EliteEnginePro listener unavailable');await runtime.close();process.exitCode=1;});
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{void runtime.close();});
runtime.server.listen(port,'0.0.0.0',()=>{console.log('EliteEnginePro compatibility runtime listening; broker and execution disabled');void runtime.start();});
