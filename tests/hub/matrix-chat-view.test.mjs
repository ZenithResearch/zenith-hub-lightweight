import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMatrixChat} from '../../src/lib/hub/matrix-chat-view.mjs';
const now=Date.parse('2026-11-24T21:00:00Z');
function fixture(){
 const account={userId:'@alice:example.org',deviceId:'MATRIX',endpoint:'http://127.0.0.1:8008'};
 return {schema:'zenith.hub-matrix.v1',csrf:'private-csrf',instances:[{instanceId:'matrix-one',label:'Team',enabled:true,endpoint:account.endpoint,account,evidence:'fresh',view:{observedAt:new Date(now).toISOString(),endpoint:account.endpoint,authentication:'authenticated',account:{...account},roomsComplete:true,rooms:[{roomId:'!space:example.org',name:'Studio',kind:'space',membership:'join',encrypted:false,children:['!room:example.org','bad']},{roomId:'!room:example.org',name:'Team room',topic:'Planning',kind:'room',membership:'join',encrypted:true}],invitationState:'verified',invitations:[]}}]};
}
test('projects actual joined rooms, spaces and child references without credentials',()=>{
 const snapshot=fixture(),before=structuredClone(snapshot);
 const result=projectMatrixChat({snapshot,now}),a=result.accounts[0];
 assert.equal(a.spaces[0].name,'Studio');assert.deepEqual(a.spaces[0].children,['!room:example.org']);
 assert.equal(a.rooms[0].encrypted,true);assert.equal(a.rooms[0].name,'Team room');
 assert.doesNotMatch(JSON.stringify(result),/private-csrf/);assert.deepEqual(snapshot,before);
});
test('stale, disabled, failed and wrong-account evidence cannot reveal active rooms/spaces',()=>{
 for(const change of ['stale','disabled','account','error']){
  const snapshot=fixture(),i=snapshot.instances[0];
  if(change==='stale')i.evidence='stale';
  if(change==='disabled')i.enabled=false;
  if(change==='account')i.view.account.userId='@other:example.org';
  const a=projectMatrixChat({snapshot,now,error:change==='error'}).accounts[0];
  assert.deepEqual(a.rooms,[]);assert.deepEqual(a.spaces,[]);assert.equal(a.complete,false);
 }
});
test('different devices and accounts cannot inherit an earlier UI selection identity',()=>{
 const snapshot=fixture(),first=projectMatrixChat({snapshot,now}).accounts[0].key;
 snapshot.instances[0].account.deviceId='NEW';snapshot.instances[0].view.account.deviceId='NEW';
 assert.notEqual(projectMatrixChat({snapshot,now}).accounts[0].key,first);
});

test('malformed or unavailable snapshots remain an unavailable connection, not an empty account',()=>{
 for(const snapshot of [{schema:"wrong",instances:[]},{schema:"zenith.hub-matrix.v1",instances:{}},{schema:"zenith.hub-matrix.v1",instances:[null]}]){
  const model=projectMatrixChat({snapshot,now});assert.ok(model.error);assert.equal(model.accounts[0].state,"unavailable");assert.deepEqual(model.accounts[0].rooms,[]);
 }
});

test('direct messages and invitations are account-native and remain scoped to verified evidence',()=>{
 const snapshot=fixture(),v=snapshot.instances[0].view;v.directState='verified';v.rooms[1].directWith=['@bob:example.org'];v.invitations=[{roomId:'!invite:example.org',name:'Bob',directWith:['@bob:example.org']}];
 const a=projectMatrixChat({snapshot,now}).accounts[0];assert.deepEqual(a.rooms[0].directWith,['@bob:example.org']);assert.equal(a.invitationRooms[0].id,'!invite:example.org');
 v.directState='unverified';assert.deepEqual(projectMatrixChat({snapshot,now}).accounts[0].rooms[0].directWith,[]);
 snapshot.instances[0].enabled=false;const disabled=projectMatrixChat({snapshot,now}).accounts[0];assert.deepEqual(disabled.rooms,[]);assert.deepEqual(disabled.invitationRooms,[]);
});
