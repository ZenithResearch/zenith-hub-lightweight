/** User-approved chat is distinct from reviewed homeserver administration. */
import path from 'node:path';
import {createChatEngine} from './engine.mjs';
import {stateStore,privateDirectory,readPrivate,atomic} from '../setup/state.mjs';
import {readMatrixSession} from '../setup/matrix-session.mjs';
import {serviceEndpoint} from '../setup/connections.mjs';
import {matrixClient} from '../setup/matrix-client.mjs';
import {requestJSON,endpoint} from '../setup/network.mjs';
import {check,digest} from '../setup/catalog.mjs';
import {operatorCsrf} from '../operator-session.mjs';
const roomValid=v=>typeof v==='string'&&/^![^\s:]+:[^\s]+$/.test(v)&&v.length<=512;
const closed=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(v,k));
const registryKey=Symbol.for('zenith.hub.matrix.conversation-engines.v1'),engines=globalThis[registryKey] ||= new Map(),serial=new Map();
async function lock(key,action){const before=serial.get(key)||Promise.resolve();let release;const after=new Promise(r=>release=r);serial.set(key,after);await before.catch(()=>{});try{return await action();}finally{release();if(serial.get(key)===after)serial.delete(key);}}
function publicError(e){
 if(e?.code?.startsWith('matrix_chat_'))return e;
 const code=e?.statusCode===401||e?.code==='matrix_session_expired'?'matrix_chat_session_expired':e?.statusCode===403||e?.code==='matrix_permission_denied'?'matrix_chat_permission_denied':e?.statusCode===429?'matrix_chat_rate_limited':'matrix_chat_unavailable';return Object.assign(Error(code),{code,status:409});
}
export function projectMessages(events,userId){
 const originalSenders=new Map(events.filter(e=>e?.event_id&&e.sender).map(e=>[e.event_id,e.sender]));
 const removed=new Set(events.filter(e=>e?.type==='m.room.redaction').map(e=>e.redacts||e.content?.redacts)),edits=new Map();
 for(const e of events){const r=e?.content?.['m.relates_to'];if(r?.rel_type==='m.replace'&&originalSenders.get(r.event_id)===e.sender&&Number.isFinite(e.origin_server_ts)&&typeof e.content?.['m.new_content']?.body==='string'&&(!edits.has(r.event_id)||edits.get(r.event_id).origin_server_ts<e.origin_server_ts))edits.set(r.event_id,e);}
 return events.filter(e=>e&&typeof e.event_id==='string'&&typeof e.sender==='string'&&Number.isFinite(e.origin_server_ts)&&e.origin_server_ts>=0&&e.origin_server_ts<=8640000000000000&&['m.room.message','m.room.encrypted'].includes(e.type)&&e.content?.['m.relates_to']?.rel_type!=='m.replace').slice(0,50).map(e=>{
  const redacted=removed.has(e.event_id)||!!e.unsigned?.redacted_because,edit=edits.get(e.event_id),content=edit?.sender===e.sender?edit.content['m.new_content']:e.content;
  let kind='text',body=typeof content?.body==='string'?content.body.slice(0,16000):'Attachment';
  if(e.type==='m.room.encrypted'){kind='encrypted';body='Encrypted message — this device is waiting for the room key.';}
  if(redacted){kind='notice';body='Message removed';}
  return {id:e.event_id,sender:e.sender,mine:e.sender===userId,at:e.origin_server_ts,body,kind};
 }).sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
}
export function createConversationController({env=process.env,root=env.ZENITH_HUB_SETUP_DIR,store=stateStore(root),request=requestJSON,engineFactory=createChatEngine}={}){
 const origin=env.ZENITH_OPERATOR_ORIGIN||'http://127.0.0.1:4208',u=endpoint(origin),csrf=operatorCsrf('matrix',env),allowPrivateHosts=(env.ZENITH_SETUP_PRIVATE_HOSTS||'').split(',').filter(Boolean);
 function admit(r){check(r,env.ZENITH_LOCAL_OPERATOR==='1'&&env.ZENITH_GUIDED_SETUP==='1'&&new URL(r.url).origin===origin&&r.headers.get('host')===u.host&&r.headers.get('origin')===origin&&r.headers.get('content-type')==='application/json'&&r.headers.get('x-zenith-csrf')===csrf&&(!r.headers.get('sec-fetch-site')||['same-origin','none'].includes(r.headers.get('sec-fetch-site'))),'matrix_chat_wrong_origin',403);}
 async function context(id,roomId){
  const s=await store.read(),i=s.instances.find(i=>i.componentId==='matrix'&&i.instanceId===id);check(i,!!i&&i.enabled!==false,'matrix_chat_connection_unavailable');
  const session=await readMatrixSession(root,i);check(session,session&&typeof session.deviceId==='string'&&!!session.deviceId&&session.userId===i.matrix?.account?.userId&&session.deviceId===i.matrix?.account?.deviceId,'matrix_chat_session_unavailable');
  const base=serviceEndpoint(i),client=matrixClient(base,{token:session.token,request,allowPrivateHosts}),who=await client.whoami();check(who,who.userId===session.userId&&who.deviceId===session.deviceId,'matrix_chat_account_changed');
  const room=await client.room(roomId,session.userId);check(room,room.membership==='join'&&room.kind==='room','matrix_chat_not_joined');
  const binding=digest({endpoint:base,userId:session.userId,deviceId:session.deviceId,credentialDigest:i.matrix.account.credentialDigest,enabled:i.enabled!==false}),identity=digest({endpoint:base,userId:session.userId,deviceId:session.deviceId});
  return {i,session,room,base,binding,identity};
 }
 async function engine(c){
  check(c.i,!c.i.matrix.account.externalSession,'matrix_chat_external_device');
  const key=root+'/'+c.identity,existing=engines.get(key);
  if(existing){const old=await existing.promise.catch(()=>null);if(old&&!old.closed&&existing.binding===c.binding)return old;await old?.close();engines.delete(key);}
  const directory=path.join(root,'credentials','matrix-clients',c.identity);await privateDirectory(directory);
  const promise=engineFactory({directory,endpoint:c.base,session:c.session,request,allowPrivateHosts});engines.set(key,{binding:c.binding,promise});try{return await promise;}catch(e){engines.delete(key);throw e;}
 }
 async function call(c,route,method='GET',body){
  const response=await request(c.base,route,{method,body,token:c.session.token,timeout:8000,allowPrivateHosts});check(response,response.status>=200&&response.status<300,response.status===401?'matrix_chat_session_expired':response.status===403?'matrix_chat_permission_denied':response.status===429?'matrix_chat_rate_limited':'matrix_chat_unavailable');return response.value;
 }
 const enc=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
 async function timeline(c,roomId){
  let crypto=null,cryptoError=null;if(c.room.encrypted){try{crypto=await engine(c);await crypto.sync();}catch(e){cryptoError=publicError(e).code;}}
  const page=await call(c,'/_matrix/client/v3/rooms/'+enc(roomId)+'/messages?dir=b&limit=50');check(page,Array.isArray(page.chunk),'matrix_chat_timeline_invalid');const events=[];
  for(const event of page.chunk.slice(0,100)){if(event.room_id&&event.room_id!==roomId)continue;if(event.type==='m.room.encrypted'&&crypto&&!cryptoError){try{events.push(await crypto.decrypt(event,roomId));continue;}catch{}}events.push(event);}
  const latest=(await store.read()).instances.find(i=>i.componentId==='matrix'&&i.instanceId===c.i.instanceId);
  check(latest,latest&&latest.enabled!==false&&digest({endpoint:serviceEndpoint(latest),userId:latest.matrix?.account?.userId,deviceId:latest.matrix?.account?.deviceId,credentialDigest:latest.matrix?.account?.credentialDigest,enabled:latest.enabled!==false})===c.binding,'matrix_chat_account_changed');
  return {schema:'zenith.hub-matrix-conversation.v1',instanceId:c.i.instanceId,roomId,binding:c.binding,userId:c.session.userId,deviceId:c.session.deviceId,encrypted:c.room.encrypted,canSend:c.room.permissions.canSend&&(!c.room.encrypted||!!crypto)&&!cryptoError,cryptoError,messages:projectMessages(events,c.session.userId),observedAt:new Date().toISOString()};
 }
 return {admit,async post(r,body){
  admit(r);check(body,body?.schema==='zenith.hub-matrix-conversation-action.v1'&&['timeline','send'].includes(body.operation),'matrix_chat_invalid_action',400);
  const keys=body.operation==='send'?['schema','operation','instanceId','roomId','binding','message','transactionId']:['schema','operation','instanceId','roomId'];check(body,closed(body,keys)&&typeof body.instanceId==='string'&&roomValid(body.roomId),'matrix_chat_invalid_action',400);
  if(body.operation==='send')check(body,typeof body.binding==='string'&&typeof body.message==='string'&&body.message.trim().length>0&&body.message.length<=4000&&!body.message.includes('\0')&&/^hub_[a-f0-9-]{36}$/.test(body.transactionId),'matrix_chat_invalid_message',400);
  try{return await lock(root+'/'+body.instanceId,async()=>{
   const c=await context(body.instanceId,body.roomId);if(body.operation==='timeline')return timeline(c,body.roomId);
   check(c,c.binding===body.binding,'matrix_chat_account_changed');check(c,c.room.permissions.canSend,'matrix_chat_permission_denied');
   const journalRoot=path.join(root,'credentials','matrix-send-journal',c.identity);await privateDirectory(journalRoot);
   const file=path.join(journalRoot,body.transactionId+'.json'),hash=digest({roomId:body.roomId,message:body.message,binding:c.binding});let entry;
   try{entry=JSON.parse(await readPrivate(file));check(entry,entry.hash===hash,'matrix_chat_transaction_changed');if(entry.eventId)return {schema:'zenith.hub-matrix-send.v1',eventId:entry.eventId,transactionId:body.transactionId};}catch(e){if(e.code!=='ENOENT')throw e;}
   if(!entry){let type='m.room.message',content={msgtype:'m.text',body:body.message};if(c.room.encrypted){const crypto=await engine(c);await crypto.sync();content=await crypto.encrypt(body.roomId,body.message);type='m.room.encrypted';check(content,content.algorithm==='m.megolm.v1.aes-sha2'&&typeof content.ciphertext==='string','matrix_chat_encryption_failed');}entry={hash,type,content};await atomic(file,entry);}
   const fresh=await context(body.instanceId,body.roomId);check(fresh,fresh.binding===c.binding,'matrix_chat_account_changed');check(fresh,!fresh.room.encrypted||entry.type==='m.room.encrypted','matrix_chat_encryption_changed');check(fresh,fresh.room.permissions.canSend,'matrix_chat_permission_denied');
   try{const sent=await call(fresh,'/_matrix/client/v3/rooms/'+enc(body.roomId)+'/send/'+entry.type+'/'+enc(body.transactionId),'PUT',entry.content);check(sent,typeof sent.event_id==='string','matrix_chat_send_unknown');await atomic(file,{hash,eventId:sent.event_id});return {schema:'zenith.hub-matrix-send.v1',eventId:sent.event_id,transactionId:body.transactionId};}
   catch(e){if(['matrix_chat_session_expired','matrix_chat_permission_denied','matrix_chat_rate_limited'].includes(e.code))throw e;throw Object.assign(Error('matrix_chat_send_unknown'),{code:'matrix_chat_send_unknown',status:409});}
  });}catch(e){throw publicError(e);}
 }};
}
