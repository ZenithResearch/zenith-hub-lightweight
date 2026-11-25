import test from 'node:test';
import assert from 'node:assert/strict';
import {matrixFixture} from '../setup/matrix-fixture.mjs';
import {matrixClient} from '../../src/lib/setup/matrix-client.mjs';
import {completedRoomView} from '../../src/lib/setup/matrix-controller.mjs';
import {validateMatrixAction} from '../../src/lib/setup/matrix-contract.mjs';
import {decorateDirectRooms,invitationRows} from '../../src/lib/setup/matrix-direct.mjs';
async function client(t){const remote=await matrixFixture(t);return {remote,c:matrixClient(remote.base,{token:'external-session'}),userId:remote.userId};}
const peer='@bob:fixture.invalid';
test('DM classification comes from the signed-in account m.direct data, never member count',()=>{
 const rows=[{roomId:'!a:x',name:'!a:x',kind:'room',members:[{userId:peer,displayName:'Bob'}]},{roomId:'!b:x',name:'Two people',kind:'room',members:[{userId:peer}]}];
 const result=decorateDirectRooms(rows,{[peer]:['!a:x']},'@me:x');assert.deepEqual(result[0].directWith,[peer]);assert.equal(result[0].name,'Bob');assert.deepEqual(result[1].directWith,[]);
 assert.equal(rows[0].directWith,undefined);
});
test('new encrypted DMs preserve all existing mappings and reuse a verified existing chat',async t=>{
 const {remote,c,userId}=await client(t);remote.state.directMap={'@keep:x':['!old:x']};
 const args={userId:peer,acknowledgeEncryption:true};validateMatrixAction('start-dm',args);
 const result=await c.execute('start-dm',args,{userId});assert.equal(result.state,'complete');const id=result.result.roomId;
 assert.deepEqual(remote.state.directMap,{'@keep:x':['!old:x'],[peer]:[id]});const body=remote.state.createBodies[0];
 assert.equal(body.is_direct,true);assert.deepEqual(body.invite,[peer]);assert.equal(body.visibility,'private');assert.ok(body.initial_state.some(e=>e.type==='m.room.encryption'&&e.content.algorithm==='m.megolm.v1.aes-sha2'));
 assert.equal((await c.rooms(userId)).rooms.find(r=>r.roomId===id).directWith[0],peer);
 const again=await c.execute('start-dm',args,{userId});assert.equal(again.result.roomId,id);assert.equal(again.result.reused,true);assert.equal(remote.state.creations,1);assert.equal(remote.events.size,0);
});
test('an unknown DM map cannot cause duplicate creation; partial mapping preserves the created room',async t=>{
 const {remote,c,userId}=await client(t);remote.state.denyDirectRead=true;const args={userId:peer,acknowledgeEncryption:true};
 const blocked=await c.execute('start-dm',args,{userId});assert.equal(blocked.state,'failed');assert.equal(remote.state.creations,0);
 remote.state.denyDirectRead=false;remote.state.denyDirectWrite=true;
 const partial=await c.execute('start-dm',args,{userId});assert.equal(partial.state,'partial');assert.ok(partial.result.roomId);assert.equal(remote.state.creations,1);
 remote.state.denyDirectWrite=false;const recovered=await c.execute('start-dm',args,{userId,recoveryRoomId:partial.result.roomId});assert.equal(recovered.state,'complete');assert.equal(remote.state.creations,1);assert.deepEqual(remote.state.directMap[peer],[partial.result.roomId]);
});
test('accepting a direct invitation records its actual sender and joining aliases returns a room ID',async t=>{
 const {remote,c,userId}=await client(t),roomId=remote.makeRoom('!incoming:fixture.invalid','Bob','room',true);
 const member={type:'m.room.member',state_key:userId,sender:peer,content:{membership:'invite',is_direct:true}};
 remote.rooms.get(roomId).push({type:'m.room.member',state_key:peer,sender:peer,content:{membership:'join'}});
 remote.state.invitations={[roomId]:{invite_state:{events:[member]}}};
 const result=await c.execute('join-room',{roomId},{userId});assert.equal(result.state,'complete');assert.deepEqual(remote.state.directMap[peer],[roomId]);
 assert.equal((await c.execute('join-room',{roomId:'#general:fixture.invalid'},{userId})).result.roomId,'!joined-alias:fixture.invalid');assert.equal(remote.events.size,0);
});
test('group room invitees and DM actions are closed, bounded and encryption acknowledged',()=>{
 for(const args of [{userId:peer},{userId:'not a user',acknowledgeEncryption:true},{userId:'@bad\0:x',acknowledgeEncryption:true},{userId:peer,acknowledgeEncryption:true,roomId:'!fabricated:x'}])assert.throws(()=>validateMatrixAction('start-dm',args));
 const room={name:'Team',visibility:'private',joinRule:'invite',encryption:true,acknowledgeEncryption:true,invite:[peer]};assert.doesNotThrow(()=>validateMatrixAction('create-room',room));assert.throws(()=>validateMatrixAction('create-room',{...room,invite:['bad']}));assert.throws(()=>validateMatrixAction('create-room',{...room,invite:Array(21).fill(peer)}));
 assert.deepEqual(invitationRows({rooms:{invite:{'!r:x':{invite_state:{events:[{type:'m.room.member',state_key:'@other:x',sender:peer,content:{membership:'invite',is_direct:true}}]}}}}},'@me:x')[0].directWith,undefined);
});

test('encrypted conversations honor the encrypted event power level',async t=>{
 const {remote,c,userId}=await client(t),events=remote.rooms.get('!encrypted:fixture.invalid'),power=events.find(e=>e.type==='m.room.power_levels');
 power.content={users:{[userId]:0},events:{'m.room.message':0,'m.room.encrypted':50},events_default:0};
 assert.equal((await c.room('!encrypted:fixture.invalid',userId)).permissions.canSend,false);
 assert.equal((await c.room('!lobby:fixture.invalid',userId)).permissions.canSend,true);
});

test('late composite snapshots never rebrand old room, DM or invitation evidence as fresh',()=>{
 const now=Date.now(),old=new Date(now-31000).toISOString(),fresh=new Date(now-1000).toISOString();
 const view=completedRoomView({rooms:[{roomId:'!old:x',observedAt:old},{roomId:'!new:x',observedAt:fresh,directWith:[peer]}],roomsComplete:true,directState:'verified',directObservedAt:old,invitationState:'verified',invitationObservedAt:old,invitations:[{roomId:'!invite:x'}]},now);
 assert.deepEqual(view.rooms.map(r=>r.roomId),['!new:x']);assert.equal(view.roomsComplete,false);assert.equal(view.directState,'unverified');assert.deepEqual(view.rooms[0].directWith,[]);assert.deepEqual(view.invitations,[]);assert.equal(view.observedAt,new Date(now).toISOString());
});
