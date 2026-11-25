import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {matrixFixture} from './matrix-fixture.mjs';
import {matrixClient} from '../../src/lib/setup/matrix-client.mjs';
import {createMatrixController} from '../../src/lib/setup/matrix-controller.mjs';
import {probe,endpoint,requestJSON} from '../../src/lib/setup/network.mjs';
import {HubApplication} from '../../src/lib/application/database.mjs';
import {emptySetup,emptyResources} from '../../src/lib/application/model.mjs';
import {ApplicationCompiler} from '../../src/lib/application/compiler.mjs';
const origin='http://127.0.0.1:4951';
async function fixture(t,{managed=false}={}){
 const remote=await matrixFixture(t),root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'hub-matrix-'))),app=await HubApplication.open({dataDir:path.join(root,'objects'),setupRoot:root});
 t.after(async()=>{await app.close();await fs.rm(root,{recursive:true,force:true});});
 const other={instanceId:'keep-other',componentId:'devgraph',mode:'connect',config:{label:'Existing work',endpoint:'http://127.0.0.1:5220'},enabled:false};
 const matrix={instanceId:'matrix-test',componentId:'matrix',mode:managed?'install':'connect',config:managed?{port:Number(new URL(remote.base).port),serverName:'fixture.invalid'}:{endpoint:remote.base},root:managed?path.join(root,'instances/matrix-test'):null,configured:true,running:managed?true:null,installed:managed?true:null};
 await app.initialize({setup:{...emptySetup(),instances:[other,matrix]},resources:emptyResources()});
 const store={read:()=>app.readSetup(),write:(fn)=>app.writeSetup(fn),saveReview:(p)=>app.saveReview(p),getReview:id=>app.getReview(id),retireReview:id=>app.deleteReview(id)};
 const env={ZENITH_LOCAL_OPERATOR:'1',ZENITH_GUIDED_SETUP:'1',ZENITH_OPERATOR_ORIGIN:origin,ZENITH_HUB_SETUP_DIR:root};
 const controller=()=>createMatrixController({env,root,store,bootstrapSecret:async()=> 'fixture-bootstrap-secret'});
 let c=controller(),csrf;csrf=(await c.get(req())).csrf;
 function req(){return new Request(origin+'/api/matrix',{headers:{host:'127.0.0.1:4951',origin,'content-type':'application/json','x-zenith-csrf':csrf||''}});}
 const post=body=>c.post(req(),{schema:'zenith.hub-matrix-action.v1',...body});
 const review=(action,args)=>post({operation:'review',instanceId:'matrix-test',action,args});
 const apply=async(action,args,secret)=>{const {plan}=await review(action,args);return post({operation:'apply',planId:plan.id,...(secret?{secret}:{})});};
 const refresh=()=>post({operation:'refresh',instanceId:'matrix-test'});
 return {remote,root,app,post,review,apply,refresh,snapshot:()=>c.get(req()),reopenController:async()=>{c=controller();csrf=(await c.get(req())).csrf;},login:()=>apply('login',{method:'m.login.password',username:'reviewer'},remote.password)};
}
test('root URL normalization keeps path, credential, redirect and private-network restrictions',async t=>{
 assert.equal(endpoint('http://127.0.0.1:8008/').origin,'http://127.0.0.1:8008');
 assert.equal(endpoint('https://example.org/').origin,'https://example.org');
 for(const url of ['http://10.0.0.1:8008/','http://localhost:8008','https://a:b@example.org/','https://example.org/path','https://example.org/?a=1'])assert.throws(()=>endpoint(url));
 await assert.rejects(requestJSON('https://example.org','/x',{resolve:async()=>[{address:'192.168.0.2',family:4}]}),{code:'private_remote_endpoint'});
});
test('API discovery is not account authentication; expired/revoked tokens are distinct',async t=>{
 const {base,state}=await matrixFixture(t);
 assert.equal((await probe('matrix',base)).applicationReady,false);
 assert.equal((await probe('matrix',base)).permission,'login-required');
 const client=matrixClient(base),login=await client.login('m.login.password','reviewer',state.password);
 assert.equal(login.userId,state.userId);
 assert.equal((await probe('matrix',base,{token:login.token})).permission,'authenticated');
 state.tokens.delete(login.token);
 assert.equal((await probe('matrix',base,{token:login.token})).permission,'session-expired');
 await assert.rejects(client.login('m.login.password','reviewer','wrong'),{code:'matrix_permission_denied'});
 await assert.rejects(client.login('m.login.application_service','reviewer','secret'),{code:'matrix_login_method_unsupported'});
});
test('review rejects secret fields, account identity is verified and only opaque bindings enter stored objects',async t=>{
 const f=await fixture(t);await f.refresh();
 await assert.rejects(f.review('login',{method:'access-token',password:'must-not-persist'}),{code:'matrix_invalid_action'});
 const result=await f.login();assert.equal(result.result.state,'complete');
 const instance=result.instances.find(i=>i.instanceId==='matrix-test');assert.equal(instance.view.authentication,'authenticated');
 const setup=await f.app.readSetup();const raw=JSON.stringify(await f.app.repository.applicationState());
 assert.equal(raw.includes(f.remote.password),false);
 const ref=setup.instances[1].matrix.account.credentialRef,credential=await fs.readFile(path.join(f.root,'credentials/matrix',ref+'.json'),'utf8'),token=JSON.parse(credential).token;
 assert.equal(raw.includes(token),false);assert.equal((await fs.stat(path.join(f.root,'credentials/matrix',ref+'.json'))).mode&0o077,0);
 assert.deepEqual(setup.instances[0],{instanceId:'keep-other',componentId:'devgraph',mode:'connect',config:{label:'Existing work',endpoint:'http://127.0.0.1:5220'},enabled:false});
});
test('persisted review, account, selected space/room and objects survive controller/database reopen',async t=>{
 const f=await fixture(t);await f.login();
 await f.apply('select-space',{spaceId:'!space:fixture.invalid'});
 await f.apply('select-room',{roomId:'!lobby:fixture.invalid'});
 const review=await f.review('create-room',{name:'Generic room',visibility:'private',joinRule:'invite',encryption:false});
 await f.reopenController();const resumed=await f.post({operation:'read-review',planId:review.plan.id});assert.equal(resumed.plan.id,review.plan.id);
 const result=await f.post({operation:'apply',planId:review.plan.id});assert.equal(result.result.state,'complete');
 const data=await f.snapshot();assert.equal(data.instances[0].selected.roomId,'!lobby:fixture.invalid');assert.equal(data.instances[0].selected.spaceId,'!space:fixture.invalid');
 await f.app.repository.importDocument({'@id':'urn:matrix-test:ordinary','@type':['https://zenith-research.ca/ontology/terms/Artifact']},{importKey:'matrix-ordinary'});
 await f.app.close();const reopened=await HubApplication.open({dataDir:path.join(f.root,'objects'),setupRoot:f.root});t.after(()=>reopened.close());
 assert.equal((await reopened.readSetup()).instances[1].matrix.account.userId,f.remote.userId);assert.ok(await reopened.repository.get('urn:matrix-test:ordinary'));
});
test('spaces, joins, room state, membership and permissions use Matrix relationships',async t=>{
 const f=await fixture(t);await f.login();
 assert.equal((await f.apply('create-space',{name:'Generic space',visibility:'private',joinRule:'invite',encryption:false})).result.state,'complete');
 assert.equal((await f.apply('join-room',{roomId:'!invited:fixture.invalid'})).result.state,'complete');
 assert.equal((await f.apply('link-room',{spaceId:'!space:fixture.invalid',roomId:'!lobby:fixture.invalid'})).result.state,'complete');
 const space=await matrixClient(f.remote.base,{token:'external-session'}).room('!space:fixture.invalid',f.remote.userId);assert.deepEqual(space.children,['!lobby:fixture.invalid']);
 assert.equal((await f.apply('select-room',{roomId:'!lobby:fixture.invalid',spaceId:'!space:fixture.invalid'})).result.state,'complete');
 assert.equal((await f.apply('configure-room',{roomId:'!lobby:fixture.invalid',name:'Renamed',topic:'Generic description',joinRule:'knock',visibility:'private'})).result.state,'complete');
 assert.equal((await f.apply('membership',{roomId:'!lobby:fixture.invalid',userId:'@guest:fixture.invalid',membership:'invite'})).result.state,'complete');
 assert.equal((await f.apply('permissions',{roomId:'!lobby:fixture.invalid',userId:'@guest:fixture.invalid',level:50})).result.state,'complete');
 const room=await matrixClient(f.remote.base,{token:'external-session'}).room('!lobby:fixture.invalid',f.remote.userId);assert.equal(room.powerLevels.users[f.remote.userId],100);assert.equal(room.powerLevels.users['@guest:fixture.invalid'],50);
});
test('partial link and uncertain creation retain completed facts and cannot replay after restart',async t=>{
 const f=await fixture(t);await f.login();f.remote.state.deniedType='m.space.parent';
 const partial=await f.apply('link-room',{spaceId:'!space:fixture.invalid',roomId:'!lobby:fixture.invalid'});assert.equal(partial.result.state,'partial');assert.deepEqual(partial.result.completed,['space-child-linked']);
 await assert.rejects(f.apply('create-room',{name:'Blocked',visibility:'private',joinRule:'invite',encryption:false}),{code:'matrix_reconciliation_required'});
 const op=partial.instances[0].operations.find(o=>o.state==='partial');
 await f.apply('acknowledge-outcome',{operationId:op.id,acknowledge:true});f.remote.state.deniedType=null;f.remote.state.dropCreation=true;
 const result=await f.apply('create-room',{name:'Uncertain',visibility:'private',joinRule:'invite',encryption:false});assert.equal(result.result.state,'unknown');assert.equal(f.remote.state.creations,1);
 await f.reopenController();await assert.rejects(f.apply('create-room',{name:'Do not replay',visibility:'private',joinRule:'invite',encryption:false}),{code:'matrix_reconciliation_required'});assert.equal(f.remote.state.creations,1);
});
test('encryption is explicit; encrypted rooms never receive plaintext tests; send/read are separate',async t=>{
 const f=await fixture(t);await f.login();await f.apply('select-room',{roomId:'!encrypted:fixture.invalid'});
 const denied=await f.apply('message-test',{roomId:'!encrypted:fixture.invalid',acknowledgeSend:true});assert.equal(denied.result.error,'matrix_encrypted_client_required');assert.equal(f.remote.events.size,0);
 await assert.rejects(f.review('enable-encryption',{roomId:'!lobby:fixture.invalid',acknowledgeEncryption:false}),{code:'matrix_encryption_acknowledgement_required'});
 await f.apply('select-room',{roomId:'!lobby:fixture.invalid'});f.remote.state.denyRead=true;
 const result=await f.apply('message-test',{roomId:'!lobby:fixture.invalid',acknowledgeSend:true});assert.equal(result.result.state,'partial');assert.equal(result.result.result.sendVerified,true);assert.equal(result.result.result.readVerified,false);
});
test('disable connection retains session; explicit imported-session logout requires acknowledgement',async t=>{
 const f=await fixture(t);await f.apply('login',{method:'access-token'},'external-session');
 await f.app.writeSetup(s=>{s.instances[1].enabled=false;});assert.equal(f.remote.tokens.has('external-session'),true);
 await assert.rejects(f.refresh(),{code:'matrix_connection_disabled'});await f.app.writeSetup(s=>{s.instances[1].enabled=true;});
 const rejected=await f.apply('logout',{revokeExternal:false});assert.equal(rejected.result.error,'matrix_external_session_revocation_requires_acknowledgement');assert.equal(f.remote.state.logouts,0);
 assert.equal((await f.apply('logout',{revokeExternal:true})).result.state,'complete');assert.equal(f.remote.state.logouts,1);assert.equal(f.remote.tokens.has('external-session'),false);
});
test('managed local account bootstrap explicitly selects privilege; external endpoint has no bootstrap authority',async t=>{
 const external=await fixture(t);await assert.rejects(external.review('bootstrap',{username:'first',admin:false}),{code:'matrix_local_management_required'});
 const managed=await fixture(t,{managed:true});const result=await managed.apply('bootstrap',{username:'reviewer',admin:false},'a-private-new-password');assert.equal(result.result.state,'complete');assert.equal(managed.remote.state.bootstrapAdmin,false);
});
test('endpoint or credential changes invalidate reviews and old room evidence',async t=>{
 const f=await fixture(t);await f.login();const {plan}=await f.review('create-room',{name:'Stale',visibility:'private',joinRule:'invite',encryption:false});
 await f.app.writeSetup(s=>{s.instances[1].config.endpoint='http://127.0.0.1:1';});
 const state=await f.snapshot();assert.equal(state.instances[0].view,null);assert.equal(state.instances[0].evidence,'stale');
 await assert.rejects(f.post({operation:'apply',planId:plan.id}),{code:'matrix_review_changed'});
 assert.equal(f.remote.state.creations,0);
});
test('Synapse installed copy uses exact wheel build versions, not a fabricated Git snapshot',async t=>{
 const f=await fixture(t,{managed:true});await f.app.writeSetup(s=>{s.instances[1].software={environment:'/synthetic/synapse/venv',launcher:'/synthetic/synapse/controller.py',copyId:'verified-copy',build:{content:{id:'urn:sha256:wheel',sha256:'b'.repeat(64),byteLength:123,mediaType:'application/zip'},platform:'darwin-arm64',version:'1.165.0'}};});
 let read=await f.app.repository.applicationState();const original=read.snapshot.installations[0],build=read.snapshot.builds[0];assert.equal(read.snapshot.sourceSnapshots.length,0);assert.equal(original.buildRef,build.id);assert.equal(original.locations.source,undefined);
 const c=new ApplicationCompiler(f.app.repository,read),{revision,objectVersion,...fields}=build;await c.typed('SoftwareBuild',{...fields,version:'descriptive correction'});await f.app.repository.commitBatch(await c.finish());
 await f.app.writeSetup(s=>{s.step='environment';s.instances[1].software.environment='/synthetic/synapse-moved/venv';});read=await f.app.repository.applicationState();const pin=read.state.referenceBindings.find(b=>b.ownerRef===original.id&&b.field==='/buildRef');assert.equal(pin.objectRevision,1);assert.equal((await f.app.repository.getVersion(build.id,1)).id,build.id);
 await f.app.writeSetup(s=>{s.instances[1].software.build.content.sha256='c'.repeat(64);s.instances[1].software.build.content.id='urn:sha256:new-wheel';});
 read=await f.app.repository.applicationState();assert.equal(read.snapshot.installations.length,2);assert.ok(read.snapshot.installations.some(i=>i.id===original.id&&i.buildRef===build.id));
});

test('OAuth-only discovery is an external-client handoff, never a password assumption',async t=>{
 const remote=await matrixFixture(t);remote.state.oauthOnly=true;const client=matrixClient(remote.base);
 const d=await client.discover();assert.deepEqual(d.loginFlows,[{type:'oauth2.external-client-required'}]);
 await assert.rejects(client.login('m.login.password','reviewer','secret'),{code:'matrix_login_method_unsupported'});
 assert.equal((await client.login('access-token',null,'external-session')).userId,remote.userId);
});
test('room v12 creator permissions are distinguished from numeric power levels',async t=>{
 const remote=await matrixFixture(t),state=remote.rooms.get('!lobby:fixture.invalid');state[0].content={room_version:'12'};state.find(e=>e.type==='m.room.power_levels').content={users:{},state_default:50};
 const client=matrixClient(remote.base,{token:'external-session'}),room=await client.room('!lobby:fixture.invalid',remote.userId);
 assert.equal(room.permissions.level,'creator');assert.equal(room.permissions.canSetPermissions,true);
 const result=await client.execute('permissions',{roomId:room.roomId,userId:remote.userId,level:50},{userId:remote.userId,operationId:'test'});
 assert.equal(result.error,'matrix_creator_power_immutable');
});
test('restricted room listing does not erase a verified account identity',async t=>{
 const f=await fixture(t);await f.login();f.remote.state.denyRooms=true;
 const snapshot=await f.refresh(),view=snapshot.instances[0].view;
 assert.equal(view.authentication,'authenticated');assert.equal(view.roomsComplete,false);assert.equal(view.error,'matrix_permission_denied');
});

test('Synapse receipt mapping verifies retained wheel bytes and installed entrypoint',async t=>{
 const {softwareFromSynapseReceipt}=await import('../../src/lib/setup/synapse-receipt.mjs');
 const {digest}=await import('../../src/lib/setup/catalog.mjs');
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'hub-synapse-copy-')));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const instance=path.join(root,'matrix-copy');await fs.mkdir(path.join(instance,'wheels'),{recursive:true,mode:0o700});const entry=path.join(instance,'venv/lib/python3.12/site-packages/synapse/app/homeserver.py');await fs.mkdir(path.dirname(entry),{recursive:true});await fs.writeFile(entry,'# synthetic installed entrypoint');
 const wheel='matrix_synapse-1.165.0-cp312-cp312-macosx_11_0_arm64.whl',bytes=Buffer.from('synthetic retained wheel bytes');
 await fs.writeFile(path.join(instance,'wheels',wheel),bytes);await fs.writeFile(path.join(instance,'controller.py'),'# owned controller',{mode:0o600});
 const receipt={componentId:'matrix',instanceId:'matrix-copy',root:instance,installed:true,configured:false,copyId:'copy-one',controllerSha256:digest('# owned controller'),artifacts:[{filename:wheel,sha256:digest(bytes)}]};
 const value=await softwareFromSynapseReceipt(instance,receipt);assert.equal(value.build.content.sha256,digest(bytes));assert.equal(value.build.version,'1.165.0');assert.equal(value.source,undefined);
 await fs.writeFile(path.join(instance,'wheels',wheel),'tampered');await assert.rejects(softwareFromSynapseReceipt(instance,receipt),{code:'matrix_installed_artifacts_changed'});
 await fs.writeFile(path.join(instance,'wheels',wheel),bytes);await fs.unlink(entry);await assert.rejects(softwareFromSynapseReceipt(instance,receipt));
});

test('changing a credential file cannot silently reuse prior account or room evidence',async t=>{
 const f=await fixture(t);await f.login();const setup=await f.app.readSetup(),ref=setup.instances[1].matrix.account.credentialRef,file=path.join(f.root,'credentials/matrix',ref+'.json'),stored=JSON.parse(await fs.readFile(file,'utf8'));stored.token='external-session';await fs.writeFile(file,JSON.stringify(stored),{mode:0o600});
 const snapshot=await f.refresh(),view=snapshot.instances[0].view;assert.equal(view.authentication,'unverified');assert.equal(view.error,'matrix_session_binding_invalid');assert.deepEqual(view.rooms,[]);
});

test('an account created without a verified session is a retained partial outcome',async t=>{
 const f=await fixture(t,{managed:true});f.remote.state.bootstrapOmitToken=true;
 const result=await f.apply('bootstrap',{username:'first',admin:false},'private-fixture-password');
 assert.equal(result.result.state,'partial');assert.deepEqual(result.result.completed,['account-created']);assert.equal(result.instances[0].account,null);
 await assert.rejects(f.apply('bootstrap',{username:'first',admin:false},'private-fixture-password'),{code:'matrix_reconciliation_required'});
});

test('removing a space relationship retains rooms and encryption',async t=>{
 const remote=await matrixFixture(t),client=matrixClient(remote.base,{token:'external-session'}),args={spaceId:'!space:fixture.invalid',roomId:'!encrypted:fixture.invalid'},context={userId:remote.userId,operationId:'organization'};
 assert.equal((await client.execute('link-room',args,context)).state,'complete');assert.equal((await client.execute('unlink-room',args,context)).state,'complete');
 assert.deepEqual((await client.room(args.spaceId,remote.userId)).children,[]);assert.equal((await client.room(args.roomId,remote.userId)).encrypted,true);assert.equal(remote.rooms.size,3);
});

test('bootstrap cannot publish an account identity different from the reviewed username',async t=>{
 const f=await fixture(t,{managed:true});const result=await f.apply('bootstrap',{username:'different-user',admin:false},'private-fixture-password');
 assert.equal(result.result.state,'partial');assert.equal(result.result.error,'matrix_account_created_authentication_unverified');assert.equal(result.instances[0].account,null);
});

test('custom Matrix power levels accept safe integers and reject lossy values',async()=>{
 const {validateMatrixAction}=await import('../../src/lib/setup/matrix-contract.mjs');
 for(const level of [150,Number.MIN_SAFE_INTEGER,Number.MAX_SAFE_INTEGER])assert.equal(validateMatrixAction('permissions',{roomId:'!room:fixture.invalid',userId:'@user:fixture.invalid',level}).level,level);
 for(const level of [Number.MAX_SAFE_INTEGER+1,NaN,Infinity,1.5])assert.throws(()=>validateMatrixAction('permissions',{roomId:'!room:fixture.invalid',userId:'@user:fixture.invalid',level}),{code:'matrix_invalid_power_level'});
});

test('reviewed DMs survive restart and recover mapping failures without duplicate rooms or test messages',async t=>{
 const f=await fixture(t);await f.login();f.remote.state.directMap={'@keep:x':['!keep:x']};
 const args={userId:'@bob:fixture.invalid',acknowledgeEncryption:true},review=await f.review('start-dm',args);
 assert.equal(f.remote.state.creations,0);assert.equal(f.remote.events.size,0);
 const sent=await f.post({operation:'apply',planId:review.plan.id});assert.equal(sent.result.state,'complete');const first=sent.result.result.roomId;
 await f.reopenController();assert.equal((await f.apply('start-dm',args)).result.result.roomId,first);assert.equal(f.remote.state.creations,1);
 f.remote.state.denyDirectWrite=true;const next={userId:'@carol:fixture.invalid',acknowledgeEncryption:true},partial=await f.apply('start-dm',next);
 assert.equal(partial.result.state,'partial');assert.ok(partial.result.result.roomId);
 const op=partial.instances.find(i=>i.instanceId==='matrix-test').operations.find(o=>o.action==='start-dm'&&o.state==='partial');
 await assert.rejects(f.apply('start-dm',next),{code:'matrix_reconciliation_required'});
 f.remote.state.denyDirectWrite=false;await f.apply('acknowledge-outcome',{operationId:op.id,acknowledge:true});
 const recovery=await f.review('start-dm',next);assert.equal(recovery.plan.dmRecoveryRoomId,partial.result.result.roomId);
 const done=await f.post({operation:'apply',planId:recovery.plan.id});assert.equal(done.result.state,'complete');assert.equal(f.remote.state.creations,2);
 assert.deepEqual(f.remote.state.directMap['@keep:x'],['!keep:x']);assert.equal(f.remote.events.size,0);
});
