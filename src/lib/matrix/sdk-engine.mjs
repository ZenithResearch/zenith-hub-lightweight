/** Private persistent E2EE worker implementation. Never imported by browser code. */
import path from 'node:path';
import {open,lstat,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {privateDirectory,readPrivate,atomic} from '../setup/state.mjs';
import {check} from '../setup/catalog.mjs';
import {verifyNativeCrypto} from './native-runtime.mjs';
const sha=v=>createHash('sha256').update(v).digest('hex');
const enc=v=>encodeURIComponent(v).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
export function sdkRoute(route,query){
 check(route,typeof route==='string'&&/^\/_matrix\/client\/(?:v3|r0|v1)\//.test(route)&&!/[?#]/.test(route),'matrix_chat_invalid_route');
 const pathname=route.split('/').map(p=>enc(decodeURIComponent(p))).join('/'),qs=new URLSearchParams();
 for(const [k,v] of Object.entries(query||{})){if(v===undefined||v===null)continue;check(v,['string','number','boolean'].includes(typeof v),'matrix_chat_invalid_query');qs.set(k,String(v));}
 return pathname+(qs.size?'?'+qs:'');
}
export function allowedSdkRequest(method,route){
 const plain=route.split('?')[0];
 const read=/^\/_matrix\/client\/(?:v3|r0|v1)\/(?:account\/whoami|sync|rooms\/[^/]+\/(?:state(?:\/.*)?|members|joined_members|messages))$/.test(plain);
 const keys=/^\/_matrix\/client\/(?:v3|r0)\/(?:keys\/(?:query|upload|claim)|sendToDevice\/[^/]+\/[^/]+)$/.test(plain);
 return method==='GET'&&read||['POST','PUT'].includes(method)&&keys;
}
export async function createSdkEngine({directory,endpoint,session,request}){
 await verifyNativeCrypto();
 const imported=await import('@vector-im/matrix-bot-sdk'),sdk=imported.default||imported,native=await import('@matrix-org/matrix-sdk-crypto-nodejs');
 sdk.LogService.setLogger({trace(){},debug(){},info(){},warn(){},error(){}});
 let encryptionMembers=null;
 class BoundClient extends sdk.MatrixClient{
  async getRoomMembersByMembership(roomId,membership,atToken){
   if(encryptionMembers?.roomId===roomId)return encryptionMembers.members.filter(m=>m.effectiveMembership===membership);
   return super.getRoomMembersByMembership(roomId,membership,atToken);
  }
  async doRequest(method,route,query=null,body=null,_timeout,raw,contentType='application/json',noEncoding){
   check(route,!raw&&!noEncoding&&contentType==='application/json'&&allowedSdkRequest(method,route),'matrix_chat_sdk_action_denied');
   const response=await request(endpoint,sdkRoute(route,query),{method,body:body===null?undefined:body});
   if(response.status<200||response.status>=300)throw new sdk.MatrixError({errcode:response.value?.errcode||'M_UNKNOWN',error:'Matrix request failed'},response.status,{});
   return response.value;
  }
 }
 await privateDirectory(directory);await privateDirectory(path.join(directory,'crypto'));await privateDirectory(path.join(directory,'crypto',sha(session.deviceId)));
 const binding={endpoint,userId:session.userId,deviceId:session.deviceId},metadataFile=path.join(directory,'identity.json');let metadata;
 try{metadata=JSON.parse(await readPrivate(metadataFile));check(metadata,JSON.stringify(metadata.binding)===JSON.stringify(binding),'matrix_chat_crypto_binding_changed');}catch(e){if(e.code!=='ENOENT')throw e;}
 const probe=new BoundClient(endpoint,session.token),keys=await probe.doRequest('POST','/_matrix/client/v3/keys/query',null,{device_keys:{[session.userId]:[session.deviceId]}}),remote=keys.device_keys?.[session.userId]?.[session.deviceId]?.keys||{};
 let storeExists=false;try{const s=await lstat(path.join(directory,'crypto',sha(session.deviceId),'matrix-sdk-crypto.sqlite3'));check(s,s.isFile()&&!s.isSymbolicLink(),'matrix_chat_crypto_store_unsafe');storeExists=true;}catch(e){if(e.code!=='ENOENT')throw e;}
 check(remote,(!storeExists||metadata)&&(storeExists||(!metadata?.ready&&!Object.keys(remote).length)),'matrix_chat_crypto_store_missing');
 if(metadata?.ed25519&&remote['ed25519:'+session.deviceId])check(remote,metadata.ed25519===remote['ed25519:'+session.deviceId],'matrix_chat_crypto_identity_changed');
 const ownerFile=path.join(directory,'owner.json');let owner;
 try{owner=await open(ownerFile,'wx',0o600);}catch(e){
  if(e.code!=='EEXIST')throw e;const previous=JSON.parse(await readPrivate(ownerFile));let alive=true;
  try{process.kill(previous.pid,0);}catch(err){if(err.code==='ESRCH')alive=false;}
  check(previous,!alive,'matrix_chat_crypto_in_use');await unlink(ownerFile);owner=await open(ownerFile,'wx',0o600);
 }
 await owner.writeFile(JSON.stringify({pid:process.pid}));await owner.close();
 // On any initialization failure this worker exits. Its stale owner is reclaimed only after it is dead.
 await atomic(metadataFile,{binding,ready:metadata?.ready||false,...(metadata?.ed25519?{ed25519:metadata.ed25519}:{})});
 const syncFile=path.join(directory,'sync.json');try{await readPrivate(syncFile);}catch(e){if(e.code!=='ENOENT')throw e;await atomic(syncFile,{});}
 const cryptoStore=new sdk.RustSdkCryptoStorageProvider(path.join(directory,'crypto'),native.StoreType.Sqlite),storage=new sdk.SimpleFsStorageProvider(syncFile),client=new BoundClient(endpoint,session.token,storage,cryptoStore);
 await client.crypto.prepare();
 if(remote['ed25519:'+session.deviceId])check(remote,client.crypto.clientDeviceEd25519===remote['ed25519:'+session.deviceId],'matrix_chat_crypto_identity_changed');
 await atomic(metadataFile,{binding,ready:true,ed25519:client.crypto.clientDeviceEd25519});
 return {
  async sync(){
   const filter=JSON.stringify({presence:{types:[]},account_data:{types:[]},room:{timeline:{limit:0},state:{types:['m.room.encryption','m.room.member','m.room.history_visibility'],lazy_load_members:true},ephemeral:{types:[]},account_data:{types:[]}}});
   const data=await client.doRequest('GET','/_matrix/client/v3/sync',{timeout:0,filter,...(storage.getSyncToken()?{since:storage.getSyncToken()}:{})});
   check(data,typeof data.next_batch==='string','matrix_chat_sync_incomplete');
   await client.crypto.updateSyncData(data.to_device?.events||[],data.device_one_time_keys_count||{},data.device_unused_fallback_key_types||[],data.device_lists?.changed||[],data.device_lists?.left||[]);
   for(const [roomId,room] of Object.entries(data.rooms?.join||{}))for(const event of room.state?.events||[])await client.crypto.onRoomEvent(roomId,event);
   // Room keys are committed before their delivery cursor is acknowledged.
   storage.setSyncToken(data.next_batch);
  },
  async decrypt(event,roomId){return (await client.crypto.decryptRoomEvent(new sdk.EncryptedRoomEvent(event),roomId)).raw;},
  async encrypt(roomId,body){
   const config=await client.getRoomStateEventContent(roomId,'m.room.encryption','');check(config,config.algorithm==='m.megolm.v1.aes-sha2','matrix_chat_encryption_unsupported');
   let historyVisibility='joined';try{historyVisibility=(await client.getRoomStateEventContent(roomId,'m.room.history_visibility','')).history_visibility||'joined';}catch(e){if(e.errcode!=='M_NOT_FOUND')throw e;}
   await cryptoStore.storeRoom(roomId,{...config,historyVisibility});
   const members=await client.getAllRoomMembers(roomId);check(members,members.some(m=>m.membershipFor===session.userId&&m.effectiveMembership==='join'),'matrix_chat_not_joined');
   encryptionMembers={roomId,members};
   try{return await client.crypto.encryptRoomEvent(roomId,'m.room.message',{msgtype:'m.text',body});}finally{encryptionMembers=null;}
  }
 };
}
