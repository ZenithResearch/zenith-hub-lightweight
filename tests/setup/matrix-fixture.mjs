import {createServer} from 'node:http';
import {randomBytes,createHmac} from 'node:crypto';
export async function matrixFixture(t){
 const userId='@reviewer:fixture.invalid',password='fixture-password-never-persist',tokens=new Set(['external-session']),rooms=new Map(),events=new Map(),requests=[];
 const state={userId,password,tokens,rooms,events,requests,deniedType:null,denyRead:false,denyRooms:false,dropCreation:false,oauthOnly:false,loginFlows:[{type:'m.login.password'},{type:'m.login.token'}],creations:0,logouts:0,bootstrapAdmin:null,deviceKeys:null};
 const event=(type,content,state_key='')=>({type,content,state_key,sender:userId});
 function makeRoom(id,name,kind='room',encrypted=false){
  const data=[event('m.room.create',{creator:userId,room_version:'11',...(kind==='space'?{type:'m.space'}:{})}),event('m.room.name',{name}),event('m.room.member',{membership:'join'},userId),event('m.room.power_levels',{users:{[userId]:100},state_default:50}),event('m.room.join_rules',{join_rule:'invite'})];
  if(encrypted)data.push(event('m.room.encryption',{algorithm:'m.megolm.v1.aes-sha2'}));rooms.set(id,data);return id;
 }
 state.makeRoom=makeRoom;
 makeRoom('!lobby:fixture.invalid','Lobby');makeRoom('!space:fixture.invalid','Shared space','space');makeRoom('!encrypted:fixture.invalid','Encrypted room','room',true);
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost'),route=url.pathname.split('/').map(s=>decodeURIComponent(s)),p=route.join('/');let raw='';
  for await(const chunk of req)raw+=chunk;
  const body=raw?JSON.parse(raw):{};requests.push({method:req.method,path:p}); // Deliberately never record credentials or authorization values.
  const send=(status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(p==='/_matrix/client/versions')return send(200,{versions:['v1.19']});
  if(p==='/_matrix/client/v1/auth_metadata')return state.oauthOnly?send(200,{issuer:'https://auth.example.org',authorization_endpoint:'https://auth.example.org/authorize',token_endpoint:'https://auth.example.org/token'}):send(404,{errcode:'M_UNRECOGNIZED'});
  if(p==='/_matrix/client/v3/login'&&req.method==='GET')return state.oauthOnly?send(404,{errcode:'M_UNRECOGNIZED'}):send(200,{flows:state.loginFlows});
  if(p==='/_matrix/client/v3/login'&&req.method==='POST'){
   if(body.password!==password&&body.token!=='one-use-valid')return send(403,{errcode:'M_FORBIDDEN'});
   const token='fixture-token-'+randomBytes(8).toString('hex');tokens.add(token);return send(200,{access_token:token,user_id:userId,device_id:'HUBFIXTURE'});
  }
  if(p==='/_synapse/admin/v1/register'){
   if(req.method==='GET')return send(200,{nonce:'fixture-nonce'});
   const expected=createHmac('sha1','fixture-bootstrap-secret').update(['fixture-nonce',body.username,body.password,body.admin?'admin':'notadmin'].join('\0')).digest('hex');
   if(body.mac!==expected)return send(403,{errcode:'M_FORBIDDEN'});
   state.bootstrapAdmin=body.admin;if(state.bootstrapOmitToken)return send(200,{user_id:userId});const token='bootstrap-token';tokens.add(token);return send(200,{access_token:token,user_id:userId,device_id:'BOOTSTRAP'});
  }
  const token=req.headers.authorization?.replace(/^Bearer /,'');
  if(!tokens.has(token))return send(401,{errcode:'M_UNKNOWN_TOKEN'});
  if(p==='/_matrix/client/v3/account/whoami')return send(200,{user_id:userId,device_id:'HUBFIXTURE'});
  if(p==='/_matrix/client/v3/capabilities')return send(200,{capabilities:{'m.room_versions':{available:{'11':'stable','12':'stable'},default:'11'}}});
  if(p==='/_matrix/client/v3/joined_rooms')return state.denyRooms?send(403,{errcode:'M_FORBIDDEN'}):send(200,{joined_rooms:[...rooms.keys()]});
  if(p==='/_matrix/client/v3/keys/query')return send(200,{device_keys:{[userId]:state.deviceKeys?{HUBFIXTURE:state.deviceKeys}:{}},master_keys:{},self_signing_keys:{},user_signing_keys:{},failures:{}});
  if(p==='/_matrix/client/v3/keys/upload'){if(body.device_keys)state.deviceKeys=body.device_keys;return send(200,{one_time_key_counts:{signed_curve25519:100}});}
  if(p==='/_matrix/client/v3/keys/claim')return send(200,{one_time_keys:{},failures:{}});
  if(p.startsWith('/_matrix/client/v3/sendToDevice/'))return send(200,{});
  if(p==='/_matrix/client/v3/sync')return send(200,{next_batch:'fixture',to_device:{events:[]},device_one_time_keys_count:{signed_curve25519:100},device_lists:{changed:[userId],left:[]},rooms:{join:Object.fromEntries([...rooms].map(([id,data])=>[id,{state:{events:data}}])),invite:{'!invited:fixture.invalid':{invite_state:{events:[event('m.room.name',{name:'Invitation'})]}}}}});
  if(p==='/_matrix/client/v3/createRoom'){
   state.creations++;const id=makeRoom('!new'+state.creations+':fixture.invalid',body.name,body.creation_content?.type==='m.space'?'space':'room');
   rooms.get(id).push(...(body.initial_state||[]));
   if(state.dropCreation){req.socket.destroy();return;}
   return send(200,{room_id:id});
  }
  if(p.startsWith('/_matrix/client/v3/join/')){const id=route[5];if(!rooms.has(id))makeRoom(id,'Joined by identifier');return send(200,{room_id:id});}
  if(p==='/_matrix/client/v3/logout'){state.logouts++;tokens.delete(token);return send(200,{});}
  if(route[4]==='rooms'){
   const id=route[5],data=rooms.get(id);if(!data)return send(404,{errcode:'M_NOT_FOUND'});
   if(route[6]==='state'&&req.method==='GET'){if(route.length===7)return send(200,data);const e=data.find(e=>e.type===route[7]&&e.state_key===(route[8]||''));return e?send(200,e.content):send(404,{errcode:'M_NOT_FOUND'});}
   if(route[6]==='members')return send(200,{chunk:data.filter(e=>e.type==='m.room.member'&&(!url.searchParams.get('membership')||e.content.membership===url.searchParams.get('membership')))});
   if(route[6]==='messages')return send(200,{chunk:[...events.values()].filter(e=>e.room_id===id).reverse(),start:'fixture'});
   if(route[6]==='state'&&req.method==='PUT'){
    const type=route[7],key=route[8]||'';if(type===state.deniedType)return send(403,{errcode:'M_FORBIDDEN'});
    const at=data.findIndex(e=>e.type===type&&e.state_key===key),next=event(type,body,key);if(at>=0)data[at]=next;else data.push(next);return send(200,{event_id:'$state'});
   }
   if(['invite','kick','ban','unban'].includes(route[6])){data.push(event('m.room.member',{membership:route[6]==='invite'?'invite':'leave'},body.user_id));return send(200,{});}
   if(route[6]==='send'){const event_id='$'+route[8];events.set(event_id,{event_id,room_id:id,origin_server_ts:Date.now(),type:route[7],sender:userId,content:body});return send(200,{event_id});}
   if(route[6]==='event')return state.denyRead?send(403,{errcode:'M_FORBIDDEN'}):send(200,events.get(route[7]));
  }
  if(p.startsWith('/_matrix/client/v3/directory/list/room/'))return send(200,{visibility:body.visibility||'private'});
  return send(404,{errcode:'M_UNRECOGNIZED'});
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 return {base:'http://127.0.0.1:'+server.address().port,...state,state};
}
