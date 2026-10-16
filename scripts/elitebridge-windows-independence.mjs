#!/usr/bin/env node
// EliteTrade Windows-independence gate: checks configuration, not broker execution.
const env=process.env;
const providers=[
  {id:'authorized-broker-api',url:env.ELITEBRIDGE_BROKER_API_URL,token:env.ELITEBRIDGE_BROKER_API_TOKEN},
  {id:'remote-terminal-gateway',url:env.ELITEBRIDGE_REMOTE_GATEWAY_URL,token:env.ELITEBRIDGE_REMOTE_GATEWAY_TOKEN}
];
const validUrl=(value)=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false;}};
const configured=providers.filter(p=>validUrl(p.url)&&Boolean(p.token?.trim())).map(p=>p.id);
const mode=env.ELITEBRIDGE_ACCOUNT_MODE;
const report={
  component:'elitebridge-windows-independence',
  phoneOrWebCanControl:true,
  independentBrokerTransportConfigured:configured.length>0,
  configuredTransports:configured,
  requestedAccountMode:['demo','real'].includes(mode)?mode:'unspecified',
  brokerAuthenticated:false,
  terminalRequired:'depends-on-verified-transport',
  remoteOrdersVerified:false,
  liveExecutionAuthorized:false,
  note:'A configured endpoint is not proof of broker access. MT5 generally requires an authorized terminal/gateway or a broker-provided trading API. Do not enable live orders based on this report.'
};
console.log(JSON.stringify(report,null,2));
if(!configured.length)process.exitCode=1;
