import {projectMainHub} from './main-view.mjs';
const id=v=>typeof v==='string'&&/^![^\s:]+:[^\s]+$/.test(v)&&v.length<=512;
const label=(v,fallback,limit=200)=>typeof v==='string'&&v.trim()?v.trim().slice(0,limit):fallback;
/** Project the same verified account boundary into a credential-free rooms/spaces view. */
export function projectMatrixChat({snapshot=null,loading=false,error=false,now=Date.now()}={}){
 const malformed=snapshot!==null&&(snapshot?.schema!=='zenith.hub-matrix.v1'||!Array.isArray(snapshot.instances)||snapshot.instances.some(i=>!i||typeof i.instanceId!=='string'));
 if(malformed){snapshot=null;error=true;}
 const overview=projectMainHub({hub:{schema:'zenith.hub-overview.v1',resources:[]},matrix:snapshot,loading,errors:error?{matrix:'unavailable'}:{},now});
 return {loading,error:error?'Matrix could not be checked. Your saved connection is retained.':'',accounts:overview.conversations.map(connection=>{
  const raw=snapshot?.instances?.find(i=>i.instanceId===connection.key);
  const verified=['verified','partial'].includes(connection.state);
  const spaces=verified?(Array.isArray(raw?.view?.rooms)?raw.view.rooms:[]).filter(r=>r?.kind==='space'&&r.membership==='join'&&id(r.roomId)&&typeof r.encrypted==='boolean').slice(0,100).map(space=>({id:space.roomId,name:label(space.name,space.roomId),children:Array.isArray(space.children)?space.children.filter(id).slice(0,100):[]})):[];
  const directState=raw?.view?.directState==='verified'?'verified':'unverified';
  return {directState,reviewId:typeof raw?.reviewId==='string'?raw.reviewId:null,invitationRooms:verified&&raw?.view?.invitationState==='verified'?(raw.view.invitations||[]).filter(r=>id(r?.roomId)).slice(0,100).map(r=>({id:r.roomId,name:label(r.name,r.roomId),directWith:Array.isArray(r.directWith)?r.directWith.filter(u=>typeof u==='string'&&/^@[^\s:]+:[^\s]+$/.test(u)).slice(0,50):[]})):[],instanceId:connection.key,key:connection.key+'/'+(connection.userId||'unsigned')+'/'+(raw?.account?.deviceId||''),label:connection.label,userId:connection.userId,state:connection.state,message:connection.message,settingsHref:connection.settingsHref,complete:connection.roomsComplete,spaces,rooms:connection.rooms.map(r=>({id:r.roomId,name:r.name,topic:r.topic,encrypted:r.encrypted,openHref:r.openHref,directWith:directState==='verified'&&Array.isArray(raw?.view?.rooms?.find(v=>v.roomId===r.roomId)?.directWith)?raw.view.rooms.find(v=>v.roomId===r.roomId).directWith.filter(u=>typeof u==='string'&&/^@[^\s:]+:[^\s]+$/.test(u)&&u!==connection.userId).slice(0,50):[]})),invitations:connection.invitations};
 })};
}
