import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mintEliteBridgeToken} from '../src/elitebridge-tokens.mjs';
import {eliteBridgeSafeStatusEndpoint,checkOwnEliteBridgeToken} from '../src/elitebridge-own-token-health-client.mjs';

const good={provider:'elitebridge',authenticated:true,scope:'bridge:status',
 bridgeBackendReady:true,mt5TerminalConnected:false,brokerVerified:false,
 tradeExecutionEnabled:false,metaapiFallbackPreserved:true};

test('own token status client contacts HTTPS read-only endpoint and never sends MT5 secrets',async()=>{
 const key=mintEliteBridgeToken();
 const requests=[];
 const result=await checkOwnEliteBridgeToken({token:key,
   serverUrl:'https://elitetradee.vercel.app',
   fetcher:async(url,options)=>{
     requests.push({url,options});
     return {ok:true,status:200,json:async()=>good};
   }});
 assert.deepEqual(result,{
   tokenAuthenticated:true,scope:'bridge:status',terminalConnected:false,
   brokerVerified:false,ordersEnabled:false,metaapiFallbackPreserved:true
 });
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'https://elitetradee.vercel.app/api/elitebridge/token/status');
 assert.equal(requests[0].options.method,'GET');
 assert.equal(requests[0].options.redirect,'error');
 assert.equal(requests[0].options.cache,'no-store');
 assert.equal(requests[0].options.headers.Authorization,'EliteBridge '+key);
 assert.ok(!requests[0].url.includes(key));
 assert.equal(requests[0].options.body,undefined);
});
test('only explicit HTTPS root is allowed for status endpoint',()=>{
 for(const url of [
  'http://elitetradee.vercel.app',
  'https://user:pass@elitetradee.vercel.app',
  'https://elitetradee.vercel.app/redirect',
  'https://elitetradee.vercel.app/?s=1',
  'https://elitetradee.vercel.app/#attack',
  'https://elitetradee.vercel.app:8080',
  'https://evil.example',
  'https://elite-trade.vercel.app',
  'https://elitetradee.vercel.app.evil.example'
 ])assert.throws(()=>eliteBridgeSafeStatusEndpoint(url),/HTTPS_BASE_URL_REQUIRED/);
});
test('reject revoked keys, malformed tokens, untrusted authority claims, and network failures',async()=>{
 const key=mintEliteBridgeToken();
 const input={token:key,serverUrl:'https://elitetradee.vercel.app'};
 await assert.rejects(checkOwnEliteBridgeToken({...input,token:'metaapi-token',fetcher:async()=>{throw Error('should not call')}}),/INVALID_OWN_TOKEN/);
 await assert.rejects(checkOwnEliteBridgeToken({...input,fetcher:async()=>({ok:false,status:401})}),/TOKEN_UNAUTHORIZED_OR_REVOKED/);
 await assert.rejects(checkOwnEliteBridgeToken({...input,fetcher:async()=>{throw Error('secret=' +key)}}),/STATUS_NETWORK_UNAVAILABLE/);
 await assert.rejects(checkOwnEliteBridgeToken({...input,fetcher:async()=>({ok:true,status:200,json:async()=>({...good,brokerVerified:true})})}),/UNTRUSTED_STATUS_RESPONSE/);
 await assert.rejects(checkOwnEliteBridgeToken({...input,fetcher:async()=>({ok:true,status:200,json:async()=>({...good,tradeExecutionEnabled:true})})}),/UNTRUSTED_STATUS_RESPONSE/);
 await assert.rejects(checkOwnEliteBridgeToken({...input,fetcher:async()=>({ok:true,status:200,json:async()=>({...good,scope:'broker:trade'})})}),/UNTRUSTED_STATUS_RESPONSE/);
});
test('Windows companion remains local, read-only; token smoke client does not upload broker data',()=>{
 const py=readFileSync(new URL('../companion/mt5_readonly_probe.py',import.meta.url),'utf8');
 const companion=readFileSync(new URL('../scripts/elitebridge-mt5-probe.mjs',import.meta.url),'utf8');
 const check=readFileSync(new URL('../scripts/elitebridge-own-token-check.mjs',import.meta.url),'utf8');
 assert.match(py,/ACCOUNT_TRADE_MODE_DEMO/);
 assert.match(py,/mt5\.symbol_info_tick\(symbol\)/);
 assert.doesNotMatch(py,/mt5\.order_send\(/);
 assert.doesNotMatch(py,/mt5\.login\(/);
 assert.doesNotMatch(companion,/fetch\(|http\.request\(|order_send\(/);
 assert.match(check,/checkOwnEliteBridgeToken/);
 assert.doesNotMatch(check,/console\.log\(.*TOKEN\)/);
});
