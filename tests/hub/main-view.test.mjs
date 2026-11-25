import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMainHub,settingsIntent} from '../../src/lib/hub/main-view.mjs';
const now=Date.parse('2026-11-24T20:00:00Z'),at=new Date(now).toISOString();
function fixture(){
 const account={userId:'@alice:example.org',deviceId:'HUB',endpoint:'http://127.0.0.1:8008'};
 return {hub:{schema:'zenith.hub-overview.v1',resources:[],catalog:[{id:'matrix'},{id:'devgraph'}]},matrix:{schema:'zenith.hub-matrix.v1',instances:[{instanceId:'matrix-one',label:'Team Matrix',enabled:true,endpoint:account.endpoint,account,evidence:'fresh',view:{endpoint:account.endpoint,observedAt:at,authentication:'authenticated',account:{userId:account.userId,deviceId:account.deviceId},roomsComplete:true,invitationState:'verified',invitations:[],rooms:[{roomId:'!one:example.org',name:'Team room',topic:'Planning',kind:'room',membership:'join',encrypted:true}]}}]},now};
}
test('uses the verified account and joined rooms without leaking source credentials or mutating snapshots',()=>{
 const f=fixture();f.matrix.csrf='private-csrf';f.matrix.instances[0].account.credentialRef='private-reference';f.matrix.instances[0].view.token='private-token';
 const before=structuredClone(f),m=projectMainHub(f);
 assert.equal(m.conversations[0].state,'verified');assert.equal(m.conversations[0].rooms[0].encrypted,true);
 assert.equal(m.conversations[0].rooms[0].openHref,'https://matrix.to/#/!one%3Aexample.org');
 assert.equal(m.conversations[0].settingsHref,'/settings?matrix=matrix-one');
 assert.deepEqual(f,before);assert.doesNotMatch(JSON.stringify(m),/private-(csrf|reference|token)/);
});
for(const change of ['user','device','missing-device','endpoint'])test('does not expose room actions for mismatched '+change,()=>{
 const f=fixture(),i=f.matrix.instances[0];
 if(change==='user')i.view.account.userId='@other:example.org';
 if(change==='device')i.view.account.deviceId='OTHER';
 if(change==='missing-device')delete i.view.account.deviceId;
 if(change==='endpoint')i.view.endpoint='http://127.0.0.1:9000';
 const c=projectMainHub(f).conversations[0];assert.equal(c.state,'unavailable');assert.deepEqual(c.rooms,[]);
});
test('stale, disabled and expired accounts do not retain active room links',()=>{
 for(const state of ['stale','disabled','expired']){
  const f=fixture(),i=f.matrix.instances[0];
  if(state==='stale'){i.evidence='stale';i.view.observedAt=new Date(now-60000).toISOString();}
  if(state==='disabled')i.enabled=false;
  if(state==='expired')i.view.authentication='expired';
  assert.deepEqual(projectMainHub(f).conversations[0].rooms,[]);
 }
});
test('incomplete and malformed room views cannot be represented as a verified empty list',()=>{
 const f=fixture(),i=f.matrix.instances[0];i.view.roomsComplete=false;i.view.rooms=[];
 let c=projectMainHub(f).conversations[0];assert.equal(c.state,'partial');assert.equal(c.roomsComplete,false);
 i.view.roomsComplete=true;i.view.rooms=[{roomId:'bad',kind:'room',membership:'join',encrypted:true}];
 c=projectMainHub(f).conversations[0];assert.equal(c.state,'partial');assert.equal(c.roomsComplete,false);
});
test('a verified empty room list is distinct from missing or unavailable Matrix evidence',()=>{
 const f=fixture();f.matrix.instances[0].view.rooms=[];
 assert.equal(projectMainHub(f).conversations[0].roomsComplete,true);
 const failed=projectMainHub({...f,errors:{matrix:'offline'}});
 assert.equal(failed.conversations[0].state,'unavailable');assert.equal(failed.conversations[0].roomsComplete,false);
 assert.ok(failed.warnings.length);
});
test('unconfigured work sources link directly to the appropriate settings with no invented counts',()=>{
 const m=projectMainHub(fixture());
 assert.equal(m.work[0].settingsHref,'/settings?component=service-management');
 assert.equal(m.work[1].settingsHref,'/settings?component=devgraph');
 assert.ok(m.work.every(s=>s.status==='Not configured'&&s.openHref===null&&!Object.hasOwn(s,'count')));
});
test('only fresh, ready and safe configured work addresses are launchable',()=>{
 for(const endpoint of ['javascript:alert(1)','https://user:secret@example.org','https://example.org/?token=secret']){
  const f=fixture();f.hub.resources=[{key:'setup:work',componentId:'devgraph',enabled:true,status:'Ready',observedAt:at,endpoint}];
  assert.equal(projectMainHub(f).work.find(s=>s.key==='setup:work').openHref,null);
 }
 const f=fixture();f.hub.resources=[{key:'setup:work',componentId:'devgraph',label:'Team work',enabled:true,status:'Ready',observedAt:at,endpoint:'http://127.0.0.1:4220'}];
 let s=projectMainHub(f).work.find(s=>s.key==='setup:work');assert.equal(s.openHref,'http://127.0.0.1:4220');assert.equal(s.settingsHref,'/settings?resource=setup%3Awork');
 f.hub.resources[0].enabled=false;assert.equal(projectMainHub(f).work.find(s=>s.key==='setup:work').openHref,null);
});
test('configuration intents resolve only against actual catalog entries or saved resources',()=>{
 const f=fixture();f.hub.resources=[{key:'setup:matrix-one',componentId:'matrix',instanceId:'matrix-one'}];
 assert.deepEqual(settingsIntent('?matrix=matrix-one',f.hub),{kind:'select',resourceKey:'setup:matrix-one'});
 assert.deepEqual(settingsIntent('?component=matrix',f.hub),{kind:'select',resourceKey:'setup:matrix-one'});
 assert.deepEqual(settingsIntent('?component=devgraph',f.hub),{kind:'add',componentId:'devgraph'});
 assert.equal(settingsIntent('?resource=unregistered',f.hub),null);
 assert.equal(settingsIntent('?component=https://external.example',f.hub),null);
});

test('an unavailable Matrix snapshot cannot look like a verified empty or unconfigured account',()=>{
 const m=projectMainHub({hub:fixture().hub,errors:{matrix:"unavailable"},now});
 assert.equal(m.conversations[0].state,'unavailable');
 assert.equal(m.conversations[0].roomsComplete,false);
 assert.deepEqual(m.conversations[0].rooms,[]);
 assert.match(m.warnings.join(' '),/could not be verified/);
});
