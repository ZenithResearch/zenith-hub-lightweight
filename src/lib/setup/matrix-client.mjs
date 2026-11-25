/** Matrix Client-Server adapter over the existing DNS-pinned, redirect-free transport.
 * Device keys and encrypted messages belong to the separate conversation client.
 */
import {createHmac} from 'node:crypto';
import {requestJSON,endpoint} from './network.mjs';
import {check} from './catalog.mjs';
import {readDirectMap,recordDirectRoom,decorateDirectRooms,invitationRows,matrixRoom} from './matrix-direct.mjs';
const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const roomPath=id=>'/_matrix/client/v3/rooms/'+enc(id);
export function matrixClient(base,{token,request=requestJSON,allowPrivateHosts=[]}={}) {
 base=endpoint(base).origin;
 async function call(route,{method='GET',body,auth=token,optional=false}={}){
  const r=await request(base,route,{method,body,token:auth,allowPrivateHosts});
  if(optional&&(Array.isArray(optional)?optional:[404,405]).includes(r.status))return null;
  const codes={401:'matrix_session_expired',403:'matrix_permission_denied',404:'matrix_not_found',429:'matrix_rate_limited'};
  check(r,r.status>=200&&r.status<300,codes[r.status]||(r.status>=500?'matrix_outcome_unknown':'matrix_request_rejected'),r.status===401?401:409);
  return r.value;
 }
 async function discover(){
  const [versions,login,oauth,caps]=await Promise.all([
   call('/_matrix/client/versions',{auth:null}),
   call('/_matrix/client/v3/login',{auth:null,optional:true}),
   call('/_matrix/client/v1/auth_metadata',{auth:null,optional:true}),
   call('/_matrix/client/v3/capabilities',{optional:true}).catch(e=>e.code==='matrix_session_expired'||e.code==='matrix_permission_denied'?null:Promise.reject(e))
  ]);
  check(login,Array.isArray(versions.versions)&&(!login||Array.isArray(login.flows)),'matrix_discovery_incompatible');
  return {versions:versions.versions,loginFlows:(oauth?[{type:'oauth2.external-client-required'}]:(login?.flows||[])).map(f=>({type:f.type,...(Array.isArray(f.identity_providers)?{identityProviders:f.identity_providers.map(p=>({id:p.id,name:p.name}))}:{})})),capabilities:caps?.capabilities||{},encryptedMessaging:'external-client-required'};
 }
 async function whoami(auth=token){const who=await call('/_matrix/client/v3/account/whoami',{auth});check(who,typeof who.user_id==='string'&&/^@[^:]+:.+/.test(who.user_id),'matrix_identity_unverified');return {userId:who.user_id,deviceId:who.device_id||null};}
 async function login(method,username,secret){
  const d=await discover();
  check(d,method==='access-token'||d.loginFlows.some(f=>f.type===method),'matrix_login_method_unsupported');
  let result;
  if(method==='access-token')result={access_token:secret};
  else result=await call('/_matrix/client/v3/login',{method:'POST',auth:null,body:method==='m.login.password'?{type:method,identifier:{type:'m.id.user',user:username},password:secret,initial_device_display_name:'Zenith Hub'}:{type:'m.login.token',token:secret,initial_device_display_name:'Zenith Hub'}});
  check(result,typeof result.access_token==='string','matrix_session_missing');
  const identity=await whoami(result.access_token);
  check(result,!result.user_id||result.user_id===identity.userId,'matrix_login_identity_mismatch');
  return {...identity,token:result.access_token,expiresInMs:result.expires_in_ms||null};
 }
 async function bootstrap({username,password,admin,sharedSecret}){
  check(null,!username.includes('\0')&&!password.includes('\0'),'matrix_invalid_registration');
  const {nonce}=await call('/_synapse/admin/v1/register',{auth:null});
  check(nonce,typeof nonce==='string'&&!nonce.includes('\0'),'matrix_bootstrap_unavailable');
  const mac=createHmac('sha1',sharedSecret).update([nonce,username,password,admin?'admin':'notadmin'].join('\0')).digest('hex');
  const created=await call('/_synapse/admin/v1/register',{method:'POST',auth:null,body:{nonce,username,password,admin,mac}});
  try {
   check(created,typeof created.access_token==='string','matrix_account_created_sign_in_required');
   const identity=await whoami(created.access_token);
   check(identity,identity.userId===created.user_id&&identity.userId.startsWith('@'+username+':'),'matrix_created_identity_mismatch');
   return {...identity,token:created.access_token};
  } catch {throw Object.assign(Error('matrix_account_created_authentication_unverified'),{code:'matrix_account_created_authentication_unverified',partial:true});}
 }
 async function room(id,userId){
  const state=await call(roomPath(id)+'/state');
  check(state,Array.isArray(state),'matrix_room_state_incompatible');
  const get=(type,key='')=>state.find(e=>e.type===type&&e.state_key===key)?.content;
  const powerEvent=get('m.room.power_levels'),power=powerEvent||{},createEvent=state.find(e=>e.type==='m.room.create'&&e.state_key===''),create=createEvent?.content||{},creators=[createEvent?.sender||create.creator,...(create.additional_creators||[])].filter(Boolean),creatorPrivilege=Number(create.room_version)>=12&&creators.includes(userId),numericLevel=power.users?.[userId]??(!powerEvent&&creators.includes(userId)?100:power.users_default??0),level=creatorPrivilege?'creator':numericLevel;
  const meets=required=>creatorPrivilege||numericLevel>=required;
  const needed=t=>power.events?.[t]??power.state_default??50;
  const membership=get('m.room.member',userId)?.membership||'unknown',joined=membership==='join';
  return {roomId:id,roomVersion:create.room_version||'1',creators,kind:create.type==='m.space'?'space':'room',name:get('m.room.name')?.name||id,topic:get('m.room.topic')?.topic||'',membership,joinRule:get('m.room.join_rules')?.join_rule||'invite',encrypted:!!get('m.room.encryption'),children:state.filter(e=>e.type==='m.space.child'&&Array.isArray(e.content?.via)&&e.content.via.length).map(e=>e.state_key),parents:state.filter(e=>e.type==='m.space.parent'&&Array.isArray(e.content?.via)&&e.content.via.length).map(e=>e.state_key),powerLevels:power,members:state.filter(e=>e.type==='m.room.member').slice(0,200).map(e=>({userId:e.state_key,membership:e.content.membership,displayName:typeof e.content.displayname==='string'?e.content.displayname.slice(0,200):null})),permissions:{level,canConfigure:joined&&meets(needed('m.room.name')),canSetJoinRule:joined&&meets(needed('m.room.join_rules')),canLink:joined&&meets(needed('m.space.child')),canSetPermissions:joined&&meets(needed('m.room.power_levels')),canInvite:joined&&meets(power.invite??0),canKick:joined&&meets(power.kick??50),canBan:joined&&meets(power.ban??50),canEncrypt:joined&&meets(needed('m.room.encryption')),canSend:joined&&meets(power.events?.[get('m.room.encryption')?'m.room.encrypted':'m.room.message']??power.events_default??0)},observedAt:new Date().toISOString()};
 }
 async function invitationsFor(userId){
  const filter=enc(JSON.stringify({presence:{types:[]},account_data:{types:[]},room:{timeline:{limit:0},state:{types:['m.room.name','m.room.create','m.room.member']},ephemeral:{types:[]},account_data:{types:[]}}}));
  return invitationRows(await call('/_matrix/client/v3/sync?timeout=0&filter='+filter),userId);
 }
 async function rooms(userId){
  // These account-scoped reads are independent of the joined-room state traversal.
  const directRead=readDirectMap(call,userId).then(value=>({value,state:'verified',at:new Date().toISOString()}),()=>({value:{},state:'unverified',at:new Date().toISOString()}));
  const inviteRead=invitationsFor(userId).then(value=>({value,state:'verified',at:new Date().toISOString()}),()=>({value:[],state:'unverified',at:new Date().toISOString()}));
  const joined=await call('/_matrix/client/v3/joined_rooms');check(joined,Array.isArray(joined.joined_rooms),'matrix_rooms_incompatible');
  const rows=[],failures=[];let cursor=0,rowsBytes=0;
  await Promise.all(Array.from({length:4},async()=>{while(cursor<Math.min(joined.joined_rooms.length,100)){const id=joined.joined_rooms[cursor++];try{const value=await room(id,userId),bytes=JSON.stringify(value).length;check(value,rowsBytes+bytes<=524288,'matrix_room_view_limit');rowsBytes+=bytes;rows.push(value);}catch(e){failures.push({roomId:id,error:e.code||'matrix_room_unverified'});}}}));
  const [direct,invited]=await Promise.all([directRead,inviteRead]);
  const directMap=direct.value,directState=direct.state,invitations=invited.value,invitationState=invited.state;
  return {rooms:decorateDirectRooms(rows,directMap,userId).sort((a,b)=>a.name.localeCompare(b.name)),directState,directObservedAt:direct.at,failures,invitations,invitationState,invitationObservedAt:invited.at,complete:joined.joined_rooms.length<=100&&!failures.length,limit:100};
 }
 async function execute(action,args,{userId,operationId,recoveryRoomId,checkpoint=async()=>{}}={}){
  const completed=[];let result={};
  async function step(name,fn){const value=await fn();completed.push(name);await checkpoint({completed:[...completed],result:{...result}});return value;}
  const state=(id,type,content,key='')=>call(roomPath(id)+'/state/'+enc(type)+'/'+enc(key),{method:'PUT',body:content});
  try{
   if(action==='start-dm'){
    check(args,args.userId!==userId,'matrix_direct_self_unsupported');
    const map=await readDirectMap(call,userId);
    const candidates=recoveryRoomId?[recoveryRoomId]:Array.isArray(map[args.userId])?map[args.userId].filter(matrixRoom).slice(0,50):[];
    for(const id of candidates){
     let existing;try{existing=await room(id,userId);}catch(e){if(['matrix_not_found','matrix_permission_denied'].includes(e.code)&&!recoveryRoomId)continue;throw e;}
     const eligible=existing.kind==='room'&&existing.membership==='join'&&existing.encrypted&&existing.members.some(m=>m.userId===args.userId&&['join','invite'].includes(m.membership));
     if(recoveryRoomId)check(existing,eligible,'matrix_direct_recovery_changed');
     if(eligible){result={roomId:id,reused:true};await checkpoint({completed:[...completed],result});if(recoveryRoomId)await step('direct-mapping-saved',()=>recordDirectRoom(call,userId,args.userId,id));return {state:'complete',completed:[...completed,'direct-chat-opened'],result};}
    }
    check(recoveryRoomId,!recoveryRoomId,'matrix_direct_recovery_changed');
    const created=await step('created',()=>call('/_matrix/client/v3/createRoom',{method:'POST',body:{is_direct:true,invite:[args.userId],visibility:'private',preset:'private_chat',initial_state:[{type:'m.room.join_rules',state_key:'',content:{join_rule:'invite'}},{type:'m.room.encryption',state_key:'',content:{algorithm:'m.megolm.v1.aes-sha2'}},{type:'m.room.history_visibility',state_key:'',content:{history_visibility:'invited'}}]}}));
    check(created,matrixRoom(created.room_id),'matrix_room_creation_unverified');result={roomId:created.room_id,reused:false};await checkpoint({completed:[...completed],result});
    await step('direct-mapping-saved',()=>recordDirectRoom(call,userId,args.userId,result.roomId));
   }else if(action==='create-room'||action==='create-space'){
    const value=await step('created',()=>call('/_matrix/client/v3/createRoom',{method:'POST',body:{name:args.name,topic:args.topic||'',...(args.invite?.length?{invite:[...new Set(args.invite)].filter(id=>id!==userId)}:{}),visibility:args.visibility||'private',preset:args.joinRule==='public'?'public_chat':'private_chat',...(action==='create-space'?{creation_content:{type:'m.space'}}:{}),initial_state:[{type:'m.room.join_rules',state_key:'',content:{join_rule:args.joinRule||'invite'}},...(args.encryption?[{type:'m.room.encryption',state_key:'',content:{algorithm:'m.megolm.v1.aes-sha2'}}]:[])]}}));
    result.roomId=value.room_id;check(value,typeof value.room_id==='string','matrix_room_creation_unverified');await checkpoint({completed:[...completed],result});
   }else if(action==='join-room'){
    let directInvite=null;if(args.roomId.startsWith('!'))try{directInvite=(await invitationsFor(userId)).find(i=>i.roomId===args.roomId&&i.directWith?.length===1);}catch{}
    const value=await step('joined',()=>call('/_matrix/client/v3/join/'+enc(args.roomId),{method:'POST',body:{}}));result.roomId=value.room_id;check(value,matrixRoom(result.roomId),'matrix_room_join_unverified');await checkpoint({completed:[...completed],result});
    if(directInvite){const joined=await room(result.roomId,userId);check(joined,joined.kind==='room'&&joined.membership==='join'&&joined.members.some(m=>m.userId===directInvite.directWith[0]&&['join','invite'].includes(m.membership)),'matrix_direct_invitation_changed');await step('direct-mapping-saved',()=>recordDirectRoom(call,userId,directInvite.directWith[0],result.roomId));}
   }else if(action==='configure-room'){
    await room(args.roomId,userId); // Re-read actual state; the server remains the permission authority.
    if(args.name!==undefined)await step('name-updated',()=>state(args.roomId,'m.room.name',{name:args.name}));
    if(args.topic!==undefined)await step('topic-updated',()=>state(args.roomId,'m.room.topic',{topic:args.topic}));
    if(args.joinRule!==undefined)await step('join-rule-updated',()=>state(args.roomId,'m.room.join_rules',{join_rule:args.joinRule}));
    if(args.visibility!==undefined)await step('directory-visibility-updated',()=>call('/_matrix/client/v3/directory/list/room/'+enc(args.roomId),{method:'PUT',body:{visibility:args.visibility}}));
   }else if(action==='link-room'||action==='unlink-room'){
    const parent=await room(args.spaceId,userId);check(parent,parent.kind==='space','matrix_parent_is_not_space');
    await room(args.roomId,userId);check(args,args.roomId!==args.spaceId,'matrix_space_self_link');
    const via=[userId.slice(userId.indexOf(':')+1)];
    await step(action==='unlink-room'?'space-child-removed':'space-child-linked',()=>state(args.spaceId,'m.space.child',action==='unlink-room'?{}:{via},args.roomId));
    await step(action==='unlink-room'?'room-parent-removed':'room-parent-linked',()=>state(args.roomId,'m.space.parent',action==='unlink-room'?{}:{via,canonical:false},args.spaceId));
   }else if(action==='membership'){
    await step(args.membership,()=>call(roomPath(args.roomId)+'/'+args.membership,{method:'POST',body:{user_id:args.userId,reason:args.reason||'Membership configured in Zenith Hub'}}));
   }else if(action==='permissions'){
    const current=await room(args.roomId,userId);check(current,current.permissions.canSetPermissions,'matrix_permission_denied');
    check(current,!(Number(current.roomVersion)>=12&&current.creators.includes(args.userId)),'matrix_creator_power_immutable');
    await step('power-level-updated',()=>state(args.roomId,'m.room.power_levels',{...current.powerLevels,users:{...current.powerLevels.users,[args.userId]:args.level}}));
   }else if(action==='enable-encryption'){
    const current=await room(args.roomId,userId);
    if(!current.encrypted)await step('encryption-enabled',()=>state(args.roomId,'m.room.encryption',{algorithm:'m.megolm.v1.aes-sha2'}));
    result.encryptedMessaging='external-client-required';
   }else if(action==='message-test'){
    const current=await room(args.roomId,userId);check(current,!current.encrypted,'matrix_encrypted_client_required');
    const body='Zenith Hub connection verification.';
    const sent=await step('send-verified',async()=>{const value=await call(roomPath(args.roomId)+'/send/m.room.message/'+enc(operationId),{method:'PUT',body:{msgtype:'m.text',body}});check(value,typeof value.event_id==='string'&&value.event_id.length>0,'matrix_message_send_unverified');return value;});
    result={eventId:sent.event_id,roomId:args.roomId,sendVerified:true,readVerified:false};await checkpoint({completed:[...completed],result});
    await step('read-verified',async()=>{const event=await call(roomPath(args.roomId)+'/event/'+enc(sent.event_id));check(event,event.event_id===sent.event_id&&event.sender===userId&&event.type==='m.room.message'&&event.content?.body===body,'matrix_message_read_unverified');return event;});result.readVerified=true;
   }else check(null,false,'matrix_action_unsupported');
   return {state:'complete',completed,result};
  }catch(e){return {state:completed.length?'partial':e.code?.startsWith('matrix_')&&e.code!=='matrix_outcome_unknown'?'failed':'unknown',error:e.code||'matrix_outcome_unknown',completed,result};}
 }
 return {discover,whoami,login,bootstrap,room,rooms,execute,logout:()=>call('/_matrix/client/v3/logout',{method:'POST',body:{}})};
}
