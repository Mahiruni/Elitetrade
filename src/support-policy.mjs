import {inflateRawSync} from 'node:zlib';
export const SUPPORT_DEFAULTS = {words:['fuck','shit','bitch','asshole'],categories:['Account access','MT5 connection','Bot settings','Subscription','Payments','Other'],priorities:['Normal','High','Urgent'],replies:['Thanks for contacting EliteTrade. Could you describe the issue and when it started?','Please share the error message. Keep passwords, API keys, and MT5 credentials out of this chat.'],hours:'Support hours have not been configured.',offline:'Your message is saved. An assigned agent can reply when available.',maxAttachments:5,maxFileBytes:20*1024*1024};
export function supportError(status,message){const e=new Error(message);e.status=status;e.support=true;return e;}
export const normalizedWords = text => String(text).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_]+/gu)||[];
export function moderated(text,words){const tokens=new Set(normalizedWords(text));return words.some(w=>tokens.has(String(w).normalize('NFKC').toLowerCase()));}
export function validateSupportConfig(data){
  const out={...SUPPORT_DEFAULTS};
  for(const key of ['words','categories','priorities','replies']){
    if(!Array.isArray(data[key])||data[key].length>100||data[key].some(v=>typeof v!=='string'||!v.trim()||v.length>(key==='replies'?2000:80)))throw supportError(400,'Invalid support configuration.');
    out[key]=[...new Set(data[key].map(v=>v.trim()))];
  }
  if(!out.categories.length||!out.priorities.length)throw supportError(400,'Keep at least one category and priority.');
  if(out.words.some(w=>normalizedWords(w).length!==1||normalizedWords(w)[0]!==w.normalize('NFKC').toLowerCase()))throw supportError(400,'Moderation entries must be single whole words.');
  for(const key of ['hours','offline']){if(typeof data[key]!=='string'||data[key].length>1000)throw supportError(400,'Invalid support hours or offline message.');out[key]=data[key];}
  out.maxAttachments=Math.max(1,Math.min(5,Number(data.maxAttachments)||5));out.maxFileBytes=Math.max(1024,Math.min(20*1024*1024,Number(data.maxFileBytes)||20*1024*1024));return out;
}
const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain',csv:'text/csv'};
// Read the ZIP central directory rather than trusting filename strings embedded in a payload.
function officeEntries(b){
  let end=-1;for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0||b.readUInt16LE(end+10)>2048)throw supportError(400,'Invalid Office document.');
  let pos=b.readUInt32LE(end+16);const files=new Map();let expanded=0;
  for(let i=0;i<b.readUInt16LE(end+10);i++){
    if(pos+46>b.length||b.readUInt32LE(pos)!==0x02014b50)throw supportError(400,'Invalid Office document.');
    const flags=b.readUInt16LE(pos+8),method=b.readUInt16LE(pos+10),packed=b.readUInt32LE(pos+20),size=b.readUInt32LE(pos+24),n=b.readUInt16LE(pos+28),extra=b.readUInt16LE(pos+30),comment=b.readUInt16LE(pos+32),local=b.readUInt32LE(pos+42),name=b.subarray(pos+46,pos+46+n).toString();expanded+=size;
    if(flags&1||expanded>80*1024*1024||name.includes('..')||name.startsWith('/')||/vbaProject|activeX|embeddings/i.test(name)||![0,8].includes(method)||local+30>b.length||b.readUInt32LE(local)!==0x04034b50)throw supportError(400,'Encrypted, embedded, or macro-enabled documents are not supported.');
    const start=local+30+b.readUInt16LE(local+26)+b.readUInt16LE(local+28);if(start+packed>b.length)throw supportError(400,'Invalid Office document.');
    if(name==='[Content_Types].xml')files.set(name,method===0?b.subarray(start,start+packed):inflateRawSync(b.subarray(start,start+packed),{maxOutputLength:1024*1024}));else files.set(name,null);
    pos+=46+n+extra+comment;
  }return files;
}
export function validateAttachment(bytes,name,mime,max=20*1024*1024){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>max)throw supportError(413,`Each file must be between 1 byte and ${Math.floor(max/1024/1024)} MB.`);
  if(typeof name!=='string'||name.length>180||/[\x00-\x1f/\\]/.test(name))throw supportError(400,'Use a safe filename.');
  const ext=name.split('.').at(-1).toLowerCase(),expected=types[ext];if(!expected||mime.split(';')[0].trim()!==expected)throw supportError(400,'Unsupported file extension or MIME type.');
  let valid=false;
  if(['jpg','jpeg'].includes(ext))valid=bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
  if(ext==='png')valid=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(ext==='webp')valid=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
  if(ext==='pdf')valid=bytes.toString('ascii',0,5)==='%PDF-'&&bytes.subarray(-1024).includes(Buffer.from('%%EOF'));
  if(ext==='docx'||ext==='xlsx'){let entries;try{entries=officeEntries(bytes);}catch(e){if(e.status)throw e;throw supportError(400,'Invalid Office document.');}const xml=entries.get('[Content_Types].xml')?.toString()||'';valid=entries.has(ext==='docx'?'word/document.xml':'xl/workbook.xml')&&xml.includes(ext==='docx'?'wordprocessingml':'spreadsheetml')&&!/macroEnabled/i.test(xml);}
  if(ext==='txt'||ext==='csv'){const t=new TextDecoder('utf-8',{fatal:true});try{const text=t.decode(bytes);valid=!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)&&!/<\s*(?:!doctype\s+html|html|script|iframe|svg)\b/i.test(text);}catch{valid=false;}}
  if(!valid)throw supportError(400,'The file content does not match its declared format.');return {name,mime:expected,size:bytes.length};
}
