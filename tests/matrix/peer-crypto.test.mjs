/** Real native crypto between two devices; this protocol fixture never contacts live Matrix. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createChatEngine} from '../../src/lib/matrix/engine.mjs';
test('two distinct Matrix users exchange encrypted room/DM messages with real persisted device keys',async t=>{
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'matrix-peers-'))),roomId='!dm:fixture.invalid';
 const users=[{userId:'@alice:fixture.invalid',deviceId:'ALICE',token:'fixture-alice'},{userId:'@bob:fixture.invalid',deviceId:'BOB',token:'fixture-bob'}].map(u=>({...u,keys:null,oneTime:{},queue:[]})),transactions=new Set();let count=0;
 const server=createServer(async(req,res)=>{
  const me=users.find(u=>'Bearer '+u.token===req.headers.authorization),parts=new URL(req.url,'http://localhost').pathname.split('/').map(decodeURIComponent),route=parts.join('/');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};
  const reply=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(!me)return reply(401,{errcode:'M_UNKNOWN_TOKEN'});
  if(route==='/_matrix/client/v3/account/whoami')return reply(200,{user_id:me.userId,device_id:me.deviceId});
  if(route==='/_matrix/client/v3/keys/upload'){if(body.device_keys)me.keys=body.device_keys;Object.assign(me.oneTime,body.one_time_keys||{});return reply(200,{one_time_key_counts:{signed_curve25519:Object.keys(me.oneTime).length}});}
  if(route==='/_matrix/client/v3/keys/query'){const keys={};for(const id of Object.keys(body.device_keys||{})){const peer=users.find(u=>u.userId===id);keys[id]=peer?.keys?{[peer.deviceId]:peer.keys}:{};}return reply(200,{device_keys:keys,master_keys:{},self_signing_keys:{},user_signing_keys:{},failures:{}});}
  if(route==='/_matrix/client/v3/keys/claim'){const keys={};for(const [id,devices] of Object.entries(body.one_time_keys||{})){const peer=users.find(u=>u.userId===id);keys[id]={};for(const device of Object.keys(devices)){if(peer?.deviceId!==device)continue;const key=Object.keys(peer.oneTime)[0];if(key){keys[id][device]={[key]:peer.oneTime[key]};delete peer.oneTime[key];}}}return reply(200,{one_time_keys:keys,failures:{}});}
  if(parts[4]==='sendToDevice'){const tx=me.userId+'/'+parts[6];if(!transactions.has(tx)){transactions.add(tx);for(const [id,devices] of Object.entries(body.messages||{})){const peer=users.find(u=>u.userId===id);if(peer)for(const [device,content] of Object.entries(devices))if(device==='*'||device===peer.deviceId)peer.queue.push({type:parts[5],sender:me.userId,content});}}return reply(200,{});}
  const event=(type,content,state_key='')=>({type,content,state_key,sender:users[0].userId,event_id:'$'+type+state_key,origin_server_ts:1});
  const members=users.map(u=>event('m.room.member',{membership:'join'},u.userId)),state=[event('m.room.create',{room_version:'11',creator:users[0].userId}),event('m.room.encryption',{algorithm:'m.megolm.v1.aes-sha2'}),event('m.room.history_visibility',{history_visibility:'invited'}),...members];
  if(route==='/_matrix/client/v3/sync')return reply(200,{next_batch:'batch-'+(++count),to_device:{events:me.queue.splice(0)},device_one_time_keys_count:{signed_curve25519:Object.keys(me.oneTime).length},device_unused_fallback_key_types:[],device_lists:{changed:users.map(u=>u.userId),left:[]},rooms:{join:{[roomId]:{state:{events:state}}}}});
  if(parts[4]==='rooms'&&parts[5]===roomId){
   if(parts[6]==='members')return reply(200,{chunk:members});
   if(parts[6]==='state'){const e=state.find(e=>e.type===parts[7]&&e.state_key===(parts[8]||''));return e?reply(200,e.content):reply(404,{errcode:'M_NOT_FOUND'});}
  }
  return reply(404,{errcode:'M_NOT_FOUND'});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const endpoint='http://127.0.0.1:'+server.address().port;let alice,bob;
 try{
  alice=await createChatEngine({directory:path.join(root,'alice'),endpoint,session:{...users[0],endpoint}});
  bob=await createChatEngine({directory:path.join(root,'bob'),endpoint,session:{...users[1],endpoint}});
  await alice.sync();await bob.sync();
  const body='Private fixture hello from Alice',content=await alice.encrypt(roomId,body);assert.doesNotMatch(JSON.stringify(content),/Private fixture hello/);
  await bob.sync();const envelope={type:'m.room.encrypted',event_id:'$alice',room_id:roomId,sender:users[0].userId,origin_server_ts:Date.now(),content};assert.equal((await bob.decrypt(envelope,roomId)).content.body,body);
  const reply='Private fixture reply from Bob',sealed=await bob.encrypt(roomId,reply);await alice.sync();assert.equal((await alice.decrypt({...envelope,event_id:'$bob',sender:users[1].userId,content:sealed},roomId)).content.body,reply);
  assert.ok(transactions.size>=2);
 }finally{await alice?.close();await bob?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await fs.rm(root,{recursive:true,force:true});}
});
