import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
export const USDT_CONTRACT='TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
export const USDT_DESTINATION='TYubnUkFUzoh2exZHzUA9ScLtihhC1bxeB';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha=value=>createHash('sha256').update(value).digest();
const issue=message=>Object.assign(new Error(message),{status:503});
export function tronHex(address) {
 if(typeof address!=='string'||address.length!==34||!address.startsWith('T'))throw issue('Invalid TRON payment address.');
 let value=0n;
 for(const c of address){const n=alphabet.indexOf(c);if(n<0)throw issue('Invalid TRON payment address.');value=value*58n+BigInt(n);}
 const raw=Buffer.from(value.toString(16).padStart(50,'0'),'hex');
 if(raw.length!==25||raw[0]!==0x41||!sha(sha(raw.subarray(0,21))).subarray(0,4).equals(raw.subarray(21)))throw issue('Invalid TRON address checksum.');
 return raw.subarray(0,21).toString('hex');
}
export function usdtAmount(units) {
 const n=BigInt(units);return `${n/1000000n}.${String(n%1000000n).padStart(6,'0')}`;
}
const transferTopic='ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export function confirmedUsdt(receipt,invoice,txid) {
 if(!/^[a-f0-9]{64}$/.test(txid)||receipt?.id!==txid||receipt?.receipt?.result!=='SUCCESS'||receipt.result==='FAILED')return null;
 const at=receipt.blockTimeStamp;
 if(!Number.isSafeInteger(receipt.blockNumber)||receipt.blockNumber<=0||!Number.isSafeInteger(at)||at<invoice.created_at||at>invoice.expires_at||!Array.isArray(receipt.log))return null;
 const contract=tronHex(USDT_CONTRACT).slice(2),destination=tronHex(invoice.destination).slice(2);
 let received=0n;
 for(const event of receipt.log){
  if(event.address?.toLowerCase()!==contract||!Array.isArray(event.topics)||event.topics.length!==3||event.topics[0]?.toLowerCase()!==transferTopic)continue;
  if(!/^[a-f0-9]{64}$/i.test(event.topics[2])||event.topics[2].slice(0,24)!=='0'.repeat(24)||event.topics[2].slice(-40).toLowerCase()!==destination||!/^[a-f0-9]{64}$/i.test(event.data||''))continue;
  received+=BigInt(`0x${event.data}`);
 }
 if(received!==BigInt(invoice.amount_units))return null;
 return {txid,amountUnits:received.toString(),blockNumber:receipt.blockNumber,blockTimestamp:at};
}
export function createTronReader({apiKey='',fetchImpl=fetch}={}) {
 const key=typeof apiKey==='string'?apiKey.trim():'';
 const call=async(path,body)=>{
  if(!key)throw issue('Add a TronGrid API key in Administration → Configuration to enable automatic USDT activation.');
  let response;
  try {response=await fetchImpl(`https://api.trongrid.io${path}`,{method:body?'POST':'GET',redirect:'error',headers:{'Content-Type':'application/json','TRON-PRO-API-KEY':key},signal:AbortSignal.timeout(12000),...(body?{body:JSON.stringify(body)}:{})});}
  catch {throw issue('TRON verification could not be reached. Your invoice remains unpaid.');}
  if(!response.ok)throw issue([401,403,429].includes(response.status)?'TRON verification needs a valid TronGrid API key or its request quota has been reached.':'TRON verification is temporarily unavailable.');
  let data;try{data=await response.json();}catch{throw issue('TRON verification returned invalid data.');}
  if(data?.Error||data?.error)throw issue('TRON verification returned a provider error.');
  return data;
 };
 return {
  async transfers(destination,from,to,pages=5){
   tronHex(destination);let fingerprint='',all=[];
   for(let i=0;i<pages;i++){
    const params=new URLSearchParams({only_confirmed:'true',only_to:'true',contract_address:USDT_CONTRACT,limit:'200',min_timestamp:String(from),max_timestamp:String(to),order_by:'block_timestamp,desc',...(fingerprint?{fingerprint}:{})});
    const data=await call(`/v1/accounts/${destination}/transactions/trc20?${params}`);
    if(data.success!==true||!Array.isArray(data.data))throw issue('TRON verification returned incomplete transfer data.');
    all.push(...data.data);fingerprint=data.meta?.fingerprint||'';if(!fingerprint)break;
   }
   return all;
  },
  receipt:txid=>{if(!/^[a-f0-9]{64}$/.test(txid))throw issue('Invalid TRON transaction ID.');return call('/walletsolidity/gettransactioninfobyid',{value:txid});}
 };
}
export async function scanUsdtInvoices({db,reader,at=Date.now(),clock=Date.now}) {
 const started=clock();
 const leased=await db.rpc('elitetrade_crypto_claim_scan',{});
 if(!leased)return {busy:true};
 let checked=0,activated=0;
 try {
  const invoices=await db.query('elitetrade_crypto_invoices',`status=eq.pending&expires_at=gte.${at-86400000}&order=last_checked_at.asc.nullsfirst&limit=40`);
  const from=invoices.length?Math.min(...invoices.map(i=>i.created_at)):at-60000;
  const transfers=await reader.transfers(USDT_DESTINATION,from,at,invoices.length?5:1);
  for(const invoice of invoices){
   if(clock()-started>75000)break;
   if(invoice.destination!==USDT_DESTINATION)continue;
   const candidates=transfers.filter(t=>t.to===invoice.destination&&t.token_info?.address===USDT_CONTRACT&&t.type==='Transfer'&&t.value===String(invoice.amount_units)&&t.block_timestamp>=invoice.created_at&&t.block_timestamp<=invoice.expires_at);
   for(const t of candidates){
    if(clock()-started>75000)break;
    if(!/^[a-f0-9]{64}$/.test(t.transaction_id||''))continue;
    const verified=confirmedUsdt(await reader.receipt(t.transaction_id),invoice,t.transaction_id);
    if(!verified)continue;
    try{await db.rpc('elitetrade_crypto_complete',{p_invoice_id:invoice.id,p_txid:verified.txid,p_amount_units:verified.amountUnits,p_block_number:verified.blockNumber,p_block_timestamp:verified.blockTimestamp});activated++;break;}
    catch(failure){if(!/already|reviewed|active|used|disabled/.test(failure.message||''))throw failure;}
   }
   await db.update('elitetrade_crypto_invoices',`id=eq.${invoice.id}`,{last_checked_at:new Date(at).toISOString()});checked++;
  }
  await db.rpc('elitetrade_crypto_finish_scan',{p_lease_id:leased,p_ok:true,p_message:'USDT TRC20 verification is available.'});
  return {checked,activated};
 }catch(failure){
  await db.rpc('elitetrade_crypto_finish_scan',{p_lease_id:leased,p_ok:false,p_message:failure.status===503?failure.message:'Payment verification needs administrator attention.'}).catch(()=>{});throw failure;
 }
}
