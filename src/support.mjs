import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {SUPPORT_DEFAULTS,validateSupportConfig,validateAttachment,supportError,moderated} from './support-policy.mjs';
export const supportRoute = path => /^\/api\/support\/workspace(?:\/|$)/.test(path);
const uuid = value => typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

export function createSupportHandler({call,env={},local=false,notify=()=>{},rateLimit=()=>{}}){
  const root=resolve(env.SUPPORT_FILES_PATH||'./data/support-files');
  const secret=env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SECRET_KEY;
  const base=String(env.SUPABASE_URL||'https://cgpvhayfwnpipktyltho.supabase.co').replace(/\/$/,'');
  const storageReady=local||!!secret;
  // Vercel request limits are lower than the product's 20 MB default.
  const platformMax=env.VERCEL?3*1024*1024:20*1024*1024;
  const rpc=async(ctx,action,id,data={})=>{const r=await call(ctx,action,id,data);if(r?.error)throw supportError(r.status||400,r.error);return r;};
  async function storage(method,id,bytes,mime){
    if(local){mkdirSync(root,{recursive:true,mode:0o700});const path=join(root,id);if(method==='POST'){writeFileSync(path,bytes,{mode:0o600});return;}if(method==='DELETE'){try{unlinkSync(path);}catch{}return;}try{return readFileSync(path);}catch{throw supportError(404,'Attachment unavailable.');}}
    if(!secret)throw supportError(503,'Private attachments are not configured yet. You can still send text messages.');
    const r=await fetch(`${base}/storage/v1/object/elitetrade-support/${id}`,{method,headers:{apikey:secret,Authorization:`Bearer ${secret}`,...(mime?{'Content-Type':mime}:{})},body:bytes,signal:AbortSignal.timeout(60000)});
    if(!r.ok)throw supportError(503,'Private storage is unavailable. Please try again.');if(method==='GET')return Buffer.from(await r.arrayBuffer());
  }
  return async(req,res,url,ctx,body)=>{
    const match=url.pathname.match(/^\/api\/support\/workspace(?:\/([^/]+))?(?:\/([^/]+))?(?:\/([^/]+))?$/);if(!match)throw supportError(404,'Support operation not found.');
    const [,id,operation,fileId]=match,method=req.method;
    if(method!=='GET'&&['send','note'].includes(operation))rateLimit(`support-submit:${ctx.user.id}`,30);
    if(method==='POST'&&operation==='attachments')rateLimit(`support-upload-submit:${ctx.user.id}`,15);
    const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if(id==='config'&&method==='POST'){if(ctx.user.role!=='admin')throw supportError(403,'Administrator access required.');return json(await rpc(ctx,'config_save',null,validateSupportConfig(body)));}
    if(!id){
      if(method==='GET'){const d=await rpc(ctx,'list',null);d.config.maxFileBytes=Math.min(d.config.maxFileBytes,platformMax);d.config.attachmentsAvailable=storageReady;return json(d);}
      if(method==='POST'){const d=await rpc(ctx,'create',null,body);notify(ctx);return json(d,201);}
    }
    if(!uuid(id))throw supportError(404,'Conversation not found.');
    if(method==='GET'&&!operation)return json(await rpc(ctx,'history',id,{...(url.searchParams.has('before')?{before:Number(url.searchParams.get('before'))}:{}),...(url.searchParams.has('search')?{search:url.searchParams.get('search').slice(0,300)}:{}),...(url.searchParams.has('after')?{after:Number(url.searchParams.get('after'))}:{})}));
    if(operation==='attachments'){
      if(method==='POST'){
        await rpc(ctx,'history',id);if(!storageReady)throw supportError(503,'Private attachments are not configured yet. You can still send text messages.');
        const {config}=await rpc(ctx,'list',null),max=Math.min(config.maxFileBytes,platformMax);let total=0;const chunks=[];
        for await(const chunk of req){total+=chunk.length;if(total>max)throw supportError(413,`This host accepts files up to ${Math.floor(max/1024/1024)} MB.`);chunks.push(chunk);}
        let name;try{name=decodeURIComponent(req.headers['x-file-name']||'');}catch{throw supportError(400,'Invalid filename.');}
        const bytes=Buffer.concat(chunks),meta=validateAttachment(bytes,name,String(req.headers['content-type']||''),max),file=randomUUID();
        // Register only verified files; no client can write to the private bucket.
        await storage('POST',file,bytes,meta.mime);
        try{const result=await rpc(ctx,'upload',id,{id:file,...meta});return json(result,201);}catch(e){await storage('DELETE',file).catch(()=>{});throw e;}
      }
      if(!uuid(fileId))throw supportError(404,'Attachment not found.');
      const meta=await rpc(ctx,'attachment',id,{id:fileId});
      if(method==='DELETE'){if(meta.message_id||meta.owner_id!==ctx.user.id)throw supportError(403,'Only your unsent attachment can be removed.');await rpc(ctx,'remove_attachment',id,{id:fileId});await storage('DELETE',fileId);return json({ok:true});}
      if(method==='GET'){
        const bytes=await storage('GET',fileId);res.writeHead(200,{'Content-Type':meta.mime,'Content-Length':bytes.length,'Content-Disposition':`attachment; filename="download.${meta.name.split('.').at(-1).replace(/[^a-z0-9]/gi,'')}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','Content-Security-Policy':"default-src 'none'; sandbox"});res.end(bytes);return;
      }
    }
    if(method==='POST'&&['send','note','heartbeat','read','update'].includes(operation)){
      if(['send','note'].includes(operation)){
        if(typeof body.message!=='string'||body.message.length>20000||!body.message.trim()&&!body.attachments?.length)throw supportError(400,'Write a message up to 20,000 characters or attach a file.');
        if(operation==='send'&&(!uuid(body.clientId)||!Array.isArray(body.attachments)||body.attachments.length>5||body.attachments.some(x=>!uuid(x))))throw supportError(400,'Invalid message or attachment IDs.');
      }
      if(operation==='heartbeat'&&!uuid(body.tabId))throw supportError(400,'Invalid presence session.');
      const d=await rpc(ctx,operation,id,body);if(['send','note','update'].includes(operation))notify(ctx);return json(d);
    }
    throw supportError(405,'Support operation not available.');
  };
}

// Isolated SQLite adapter mirrors the production RPC, with durable state and transactional writes.
export function sqliteSupport(db){
  db.exec(`CREATE TABLE IF NOT EXISTS support_state(id TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE IF NOT EXISTS support_files(id TEXT PRIMARY KEY,conversation_id TEXT,owner_id TEXT,message_id TEXT,name TEXT,mime TEXT,size INTEGER,created_at INTEGER);`);
  const get=(s,...a)=>db.prepare(s).get(...a),all=(s,...a)=>db.prepare(s).all(...a),run=(s,...a)=>db.prepare(s).run(...a);
  const load=id=>JSON.parse(get('SELECT value FROM support_state WHERE id=?',id)?.value||'{}');
  const save=(id,value)=>run('INSERT INTO support_state VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',id,JSON.stringify(value));
  const presence=(s,uid)=>{
    const p=all('SELECT value FROM support_state').flatMap(r=>Object.values(JSON.parse(r.value).presence||{})).filter(p=>p.user_id===uid);const pending=Object.values(s.presence||{}).filter(p=>p.user_id===uid);for(const a of pending){const existing=p.findIndex(x=>x.user_id===a.user_id&&x.tabId===a.tabId);if(existing>=0)p.splice(existing,1);p.push(a);}if(!uid||!p.length)return {status:'unavailable',lastSeen:null};
    const fresh=p.filter(p=>p.connected&&p.seen>Date.now()-45000);return {status:fresh.length?fresh.some(p=>p.active>Date.now()-120000)?'online':'away':'offline',lastSeen:Math.max(...p.map(p=>p.seen)),typing:Object.values(s.presence||{}).some(p=>p.user_id===uid&&p.connected&&p.seen>Date.now()-45000&&p.typing>Date.now()-5000)};
  };
  return async(ctx,action,id,data={})=>{
    const u=ctx.user,adm=u.role==='admin',now=Date.now(),cfg={...SUPPORT_DEFAULTS,...load('config')};db.exec('BEGIN IMMEDIATE');
    try{
      let result;const limit=load('limits:'+u.id);
      if(['send','note','create','upload','config_save','update'].includes(action)){let r=limit[action];if(!r||r.window<now-60000)r={window:now,hits:0};r.hits++;limit[action]=r;save('limits:'+u.id,limit);if(r.hits>(action==='create'?5:action==='upload'?15:30)){db.exec('COMMIT');return {error:'Too many attempts. Please wait a minute.',status:429};}}
      const meta=c=>{const s=load(c.id);s.stage||=(c.status==='closed'?'resolved':'open');s.category||='Other';s.priority||='Normal';s.reference='ET-'+c.id.slice(0,8).toUpperCase();return s;};
      const safe=(c,s)=>{const {guest_hash,...r}=c;return {...r,stage:s.stage,category:s.category,priority:s.priority,rating:s.rating,reference:s.reference,assigned_to:s.assigned_to||null,agent_name:s.assigned_to?get('SELECT name FROM users WHERE id=?',s.assigned_to)?.name:null};};
      const msgs=cid=>all('SELECT rowid AS support_seq,* FROM messages WHERE conversation_id=? ORDER BY rowid',cid);
      if(action==='config_save'){if(!adm)throw supportError(403,'Administrator access required.');save('config',validateSupportConfig(data));result={ok:true};}
      else if(action==='list'){
        const conversations=all(`SELECT * FROM conversations ${adm?'':'WHERE user_id=?'} ORDER BY updated_at DESC`,...(adm?[]:[u.id])).map(c=>{const s=meta(c),messages=msgs(c.id);return {...safe(c,s),preview:messages.at(-1)?.body.slice(0,160)||'',unread:messages.filter(m=>m.sender===(adm?'customer':'admin')&&m.support_seq>(s.reads?.[u.id]||0)).length,presence:presence(s,adm?c.user_id:s.assigned_to)};});
        const publicCfg={...cfg};if(!adm){delete publicCfg.words;delete publicCfg.replies;}result={conversations,config:publicCfg,agents:adm?all("SELECT id,name FROM users WHERE role='admin' AND disabled=0"):[],abuse:adm?Object.values(load('abuse')).filter(x=>x.count>=3&&x.updated_at>now-2592000000):[]};
      }else if(action==='create'){
        if(!cfg.categories.includes(data.category||'Other'))throw supportError(400,'Choose a valid category.');id=randomUUID();run('INSERT INTO conversations(id,user_id,name,email,created_at,updated_at) VALUES(?,?,?,?,?,?)',id,u.id,u.name,u.email,now,now);save(id,{category:data.category||'Other'});result={id};
      }else{
        const c=get('SELECT * FROM conversations WHERE id=?',id);if(!c||!adm&&c.user_id!==u.id)throw supportError(404,'Conversation not found.');const s=meta(c),messages=msgs(id);
        if(action==='history'){
          const filtered=messages.filter(m=>(!data.search||m.body.toLowerCase().includes(data.search.toLowerCase()))&&(!data.before||m.support_seq<data.before)&&(!data.after||m.support_seq>data.after));const selected=(data.after?filtered.slice(0,60):filtered.slice(-60)).map(m=>({...m,client_id:s.clients?.[m.id],attachments:all('SELECT id,name,mime,size,conversation_id,message_id FROM support_files WHERE message_id=?',m.id)}));
          result={conversation:safe(c,s),messages:selected,presence:presence(s,adm?c.user_id:s.assigned_to),peerRead:adm?s.reads?.[c.user_id]||0:Math.max(0,...Object.entries(s.reads||{}).filter(([uid])=>get('SELECT role FROM users WHERE id=?',uid)?.role==='admin').map(([,v])=>v)),...(adm?{notes:s.notes||[]}:{})};
        }else if(action==='heartbeat'){s.presence||={};const key=u.id+data.tabId,old=s.presence[key];if(!old||Number(data.seq||0)>Number(old.seq??-1))s.presence[key]={user_id:u.id,tabId:data.tabId,seq:Number(data.seq||0),seen:now,active:data.active?now:old?.active||0,typing:data.typing?now:0,connected:!data.leaving};result={presence:presence(s,adm?c.user_id:s.assigned_to)};}
        else if(action==='read'){s.reads||={};s.reads[u.id]=Math.max(s.reads[u.id]||0,...messages.filter(m=>m.support_seq<=Number(data.cursor||0)).map(m=>m.support_seq));result={ok:true};}
        else if(action==='send'||action==='note'){
          if(action==='note'){if(!adm)throw supportError(403,'Administrator access required.');s.notes||=[];s.notes.push({id:randomUUID(),author_id:u.id,body:data.message,created_at:now});result={ok:true};}
          else{
            const duplicate=Object.entries(s.clients||{}).find(([,v])=>v===data.clientId);
            if(duplicate)result={message:messages.find(m=>m.id===duplicate[0]),duplicate:true};
            else if(s.stage==='resolved')throw supportError(409,'This conversation is resolved. Reopen it before sending.');
            else if(moderated(data.message,cfg.words)){const flags=load('abuse');flags[u.id]={user_id:u.id,count:(flags[u.id]?.updated_at>now-2592000000?flags[u.id]?.count||0:0)+1,updated_at:now};save('abuse',flags);result={error:'This message contains a blocked word. Please revise it; your draft is still here.',status:422};}
            else{
              const files=(data.attachments||[]).map(fid=>get('SELECT * FROM support_files WHERE id=?',fid));if(files.length>cfg.maxAttachments||new Set(data.attachments).size!==files.length||files.some(f=>!f||f.conversation_id!==id||f.owner_id!==u.id||f.message_id))throw supportError(400,'Invalid attachments.');
              const mid=randomUUID();run('INSERT INTO messages VALUES(?,?,?,?,?)',mid,id,adm?'admin':'customer',data.message,now);s.clients||={};s.clients[mid]=data.clientId;for(const f of files)run('UPDATE support_files SET message_id=? WHERE id=?',mid,f.id);run('UPDATE conversations SET updated_at=? WHERE id=?',now,id);for(const p of Object.values(s.presence||{}))if(p.user_id===u.id)p.typing=0;result={message:msgs(id).at(-1)};
            }
          }
        }else if(action==='update'){
          if(data.stage){if(!['open','waiting','resolved'].includes(data.stage)||!adm&&data.stage!=='open')throw supportError(403,'Administrator access required.');s.stage=data.stage;run('UPDATE conversations SET status=?,updated_at=? WHERE id=?',data.stage==='resolved'?'closed':'open',now,id);}
          for(const key of ['assigned_to','category','priority'])if(key in data){if(!adm)throw supportError(403,'Administrator access required.');if(key==='assigned_to'&&data[key]&&!get("SELECT id FROM users WHERE id=? AND role='admin' AND disabled=0",data[key]))throw supportError(400,'Invalid support agent.');if(key==='category'&&!cfg.categories.includes(data[key])||key==='priority'&&!cfg.priorities.includes(data[key]))throw supportError(400,'Invalid support label.');s[key]=data[key]||null;}
          if('rating'in data){if(adm||s.stage!=='resolved'||!Number.isInteger(data.rating)||data.rating<1||data.rating>5)throw supportError(400,'Rating unavailable.');s.rating=data.rating;}result={ok:true};
        }else if(action==='upload'){if(s.stage==='resolved')throw supportError(409,'Reopen this conversation before uploading.');run('INSERT INTO support_files VALUES(?,?,?,?,?,?,?,?)',data.id,id,u.id,null,data.name,data.mime,data.size,now);result=data;}
        else if(['attachment','remove_attachment'].includes(action)){const f=get('SELECT * FROM support_files WHERE id=? AND conversation_id=?',data.id,id);if(!f||!f.message_id&&f.owner_id!==u.id)throw supportError(404,'Attachment not found.');if(action==='attachment')result=f;else{if(f.owner_id!==u.id||f.message_id)throw supportError(403,'Only your unsent attachment can be removed.');run('DELETE FROM support_files WHERE id=?',data.id);result={ok:true};}}
        else throw supportError(400,'Invalid support operation.');save(id,s);
      }
      db.exec('COMMIT');return result;
    }catch(e){db.exec('ROLLBACK');throw e;}
  };
}
