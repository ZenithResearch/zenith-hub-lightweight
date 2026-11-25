/** Matrix-native account data, never inferred from room size or application context. */
import {check} from './catalog.mjs';
export const matrixUser=v=>typeof v==='string'&&v.length<=512&&!/[\x00-\x1f\x7f]/.test(v)&&/^@[^\s:]+:[^\s]+$/.test(v);
export const matrixRoom=v=>typeof v==='string'&&v.length<=512&&!/[\x00-\x1f\x7f]/.test(v)&&/^![^\s:]+:[^\s]+$/.test(v);
const enc=s=>encodeURIComponent(s).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
const directPath=userId=>'/_matrix/client/v3/user/'+enc(userId)+'/account_data/m.direct';
export async function readDirectMap(call,userId){const value=await call(directPath(userId),{optional:[404]});check(value,value===null||value&&typeof value==='object'&&!Array.isArray(value),'matrix_direct_data_invalid');return value||{};}
export async function recordDirectRoom(call,userId,peer,roomId){
 check(peer,matrixUser(peer)&&matrixRoom(roomId),'matrix_direct_data_invalid');
 // Read again immediately before writing, retaining every unrelated user's mapping.
 const current=await readDirectMap(call,userId),previous=current[peer];check(previous,previous===undefined||Array.isArray(previous)&&previous.every(matrixRoom),'matrix_direct_data_invalid');
 if(previous?.includes(roomId))return;
 await call(directPath(userId),{method:'PUT',body:{...current,[peer]:[...new Set([...(previous||[]),roomId])]}});
}
export function directPeers(map,roomId,userId){return Object.entries(map).filter(([peer,ids])=>matrixUser(peer)&&peer!==userId&&Array.isArray(ids)&&ids.includes(roomId)).map(([peer])=>peer).slice(0,50);}
export function decorateDirectRooms(rooms,map,userId){return rooms.map(r=>{
 const directWith=r.kind==='room'?directPeers(map,r.roomId,userId):[];
 const name=r.name===r.roomId&&directWith.length?directWith.map(peer=>r.members.find(m=>m.userId===peer)?.displayName||peer).join(', ').slice(0,200):r.name;
 return {...r,name,directWith};
});}
export function invitationRows(sync,userId){return Object.entries(sync.rooms?.invite||{}).slice(0,100).map(([roomId,v])=>{
 const events=v.invite_state?.events||[],member=events.find(e=>e.type==='m.room.member'&&e.state_key===userId&&e.content?.membership==='invite'),peer=member?.content?.is_direct===true&&matrixUser(member.sender)?member.sender:null;
 return {roomId,name:events.find(e=>e.type==='m.room.name')?.content?.name||peer||roomId,...(peer?{directWith:[peer]}:{})};
});}
