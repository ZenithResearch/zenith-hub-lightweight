import {createServer} from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {stateStore,atomic,privateDirectory} from '../../src/lib/setup/state.mjs';
import {saveMatrixSession} from '../../src/lib/setup/matrix-session.mjs';
import {digest} from '../../src/lib/setup/catalog.mjs';
import {createConversationController} from '../../src/lib/matrix/conversations.mjs';
import {operatorCsrf} from '../../src/lib/operator-session.mjs';
export async function fixture(t,{encrypted=false,engineFactory}={}){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'hub-chat-'))),userId='@alice:fixture.invalid',deviceId='HUBCHAT',roomId='!room:fixture.invalid',token='fixture-chat-token';
 const state={encrypted,member:true,canSend:true,whoUser:userId,deviceId,deny:false,dropAfterCommit:false,sends:[],events:[],deviceKeys:null,syncs:0,uploads:0,queries:0};
 const event=(type,content,state_key='')=>({type,content,state_key,sender:userId,event_id:'$state-'+type,origin_server_ts:1});
 const server=createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{},u=new URL(req.url,'http://localhost'),parts=u.pathname.split('/').map(decodeURIComponent),route=parts.join('/');
  const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.headers.authorization!=='Bearer '+token||state.deny)return send(401,{errcode:'M_UNKNOWN_TOKEN',error:'fixture'});
  if(route==='/_matrix/client/v3/account/whoami')return send(200,{user_id:state.whoUser,device_id:state.deviceId});
  if(route==='/_matrix/client/v3/keys/query'){state.queries++;return send(200,{device_keys:{[userId]:state.deviceKeys?{[deviceId]:state.deviceKeys}:{}},master_keys:{},self_signing_keys:{},user_signing_keys:{},failures:{}});}
  if(route==='/_matrix/client/v3/keys/upload'){state.uploads++;if(body.device_keys)state.deviceKeys=body.device_keys;return send(200,{one_time_key_counts:{signed_curve25519:100}});}
  if(route==='/_matrix/client/v3/keys/claim')return send(200,{one_time_keys:{},failures:{}});
  if(route.startsWith('/_matrix/client/v3/sendToDevice/'))return send(200,{});
  const members=[event('m.room.member',{membership:state.member?'join':'leave'},userId)];
  const roomState=[event('m.room.create',{creator:userId,room_version:'11'}),event('m.room.name',{name:'Fixture room'}),...members,event('m.room.power_levels',{users:{[userId]:state.canSend?100:0},events_default:50}),event('m.room.history_visibility',{history_visibility:'joined'}),...(state.encrypted?[event('m.room.encryption',{algorithm:'m.megolm.v1.aes-sha2'})]:[])];
  if(route==='/_matrix/client/v3/sync')return send(200,{next_batch:'sync-'+(++state.syncs),to_device:{events:[]},device_one_time_keys_count:{signed_curve25519:100},device_lists:{changed:[userId],left:[]},rooms:{join:{[roomId]:{state:{events:roomState}}}}});
  if(parts[4]==='rooms'&&parts[5]===roomId){
   if(parts[6]==='state'){if(parts.length===7)return send(200,roomState);const e=roomState.find(e=>e.type===parts[7]&&e.state_key===(parts[8]||''));return e?send(200,e.content):send(404,{errcode:'M_NOT_FOUND',error:'fixture'});}
   if(parts[6]==='members')return send(200,{chunk:u.searchParams.get('membership')==='invite'?[]:members});
   if(parts[6]==='messages')return send(200,{chunk:[...state.events].reverse(),start:'now',end:'before'});
   if(parts[6]==='send'){
    if(!state.canSend)return send(403,{errcode:'M_FORBIDDEN',error:'fixture'});
    state.sends.push({type:parts[7],transactionId:parts[8],content:body});let e=state.events.find(e=>e.unsigned?.transaction_id===parts[8]);
    if(!e){e={event_id:'$'+parts[8],sender:userId,origin_server_ts:Date.now(),type:parts[7],content:body,unsigned:{transaction_id:parts[8]},room_id:roomId};state.events.push(e);}
    if(state.dropAfterCommit){state.dropAfterCommit=false;req.socket.destroy();return;}
    return send(200,{event_id:e.event_id});
   }
  }
  return send(404,{errcode:'M_NOT_FOUND',error:'fixture'});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 await privateDirectory(root);const session={token,userId,deviceId,endpoint:base},ref=await saveMatrixSession(root,session);
 await atomic(path.join(root,'setup.json'),{schema:'zenith.hub-setup-state.v1',revision:0,instances:[{instanceId:'matrix-test',componentId:'matrix',mode:'connect',config:{endpoint:base},enabled:true,matrix:{account:{...session,token:undefined,credentialRef:ref,credentialDigest:digest(session),externalSession:false}}}],selection:[],operations:{}});
 const env={ZENITH_LOCAL_OPERATOR:'1',ZENITH_GUIDED_SETUP:'1',ZENITH_OPERATOR_ORIGIN:'http://127.0.0.1:4951',ZENITH_HUB_SETUP_DIR:root},store=stateStore(root);
 const controller=createConversationController({root,env,store,...(engineFactory?{engineFactory}:{})});
 const req=(overrides={})=>new Request(env.ZENITH_OPERATOR_ORIGIN+'/api/matrix/conversation',{headers:{host:'127.0.0.1:4951',origin:env.ZENITH_OPERATOR_ORIGIN,'content-type':'application/json','x-zenith-csrf':operatorCsrf('matrix',env),...overrides}});
 const action=body=>controller.post(req(),{schema:'zenith.hub-matrix-conversation-action.v1',instanceId:'matrix-test',roomId,...body});
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
 return {root,session,base,roomId,userId,state,store,controller,req,action,timeline:()=>action({operation:'timeline'})};
}
