import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,chmod,mkdir,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {createSetupController} from '../../src/lib/setup/controller.mjs';import {createHubController} from '../../src/lib/hub/controller.mjs';
import {stateStore} from '../../src/lib/setup/state.mjs';import {loadCatalog} from '../../src/lib/setup/catalog.mjs';
const catalog=await loadCatalog(),origin='http://127.0.0.1:4318';
async function fixture(t) {
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'hub-overview-')));await chmod(root,0o700);
 const objectDir=path.join(root,'objects');await mkdir(objectDir,{mode:0o700});
 // Deliberately not a database: gallery reads must not open or write the general object store.
 const objectFile=path.join(objectDir,'objects.sqlite'),objectBytes=Buffer.from('Unrelated owner data; never opened by the gallery.');await writeFile(objectFile,objectBytes,{mode:0o600});
 const env={ZENITH_LOCAL_OPERATOR:'1',ZENITH_GUIDED_SETUP:'1',ZENITH_OPERATOR_ORIGIN:origin,ZENITH_HUB_SETUP_DIR:root,ZENITH_HUB_DATA_DIR:objectDir};
 const calls=[],state=stateStore(root);
 await state.write(s=>{s.selection=[{instanceId:'retained-draft',componentId:'process-runtime',mode:'install',config:{port:19292}}];s.instances=[{instanceId:'existing',componentId:'devgraph',mode:'connect',config:{endpoint:'http://127.0.0.1:4220',label:'Existing work',secretRef:'retained-credential'}}];});
 const native=createSetupController({env,registry:catalog,projector:async()=>{},adapterFactory:()=>({installations:async()=>[],observe:async()=>({observedAt:new Date().toISOString(),reachable:true,applicationReady:false}),prepare:async()=>({prerequisites:[],artifacts:[],effects:['Register connection only']}),status:async()=>false,start:async()=>calls.push('start'),stop:async()=>calls.push('stop')})});
 let offline=false;
 const setup={get:request=>{if(offline)throw Error('offline');return native.get(request);},post:(...args)=>native.post(...args)};
 t.after(async()=>{assert.deepEqual(await readFile(objectFile),objectBytes);await rm(root,{recursive:true,force:true});});
 const connections={snapshot:async()=>({mode:'disabled',resources:[]})};
 const hub=createHubController({env,setup,connections});
 const request=(csrf,headers={})=>new Request(origin+'/api/hub',{headers:{host:'127.0.0.1:4318',origin,'content-type':'application/json',...(csrf?{'x-zenith-csrf':csrf}:{}),...headers}});
 const initial=await hub.get(request());const post=body=>hub.post(request(initial.csrf),{schema:'zenith.hub-action.v1',...body});
 return {root,state,hub,request,post,initial,calls,env,setup,connections,setOffline:()=>{offline=true;}};
}
test('guided Add reuses review/apply, preserving connections, setup draft and unrelated object-store bytes',async t=>{
 const f=await fixture(t),before=await f.state.read();
 assert.equal(Object.hasOwn(f.initial,'graph'),false);assert.equal(Object.hasOwn(f.initial.resources[0].config,'secretRef'),false);
 const reviewed=await f.post({operation:'plan-add',componentId:'devgraph',instanceId:'sai-work',mode:'connect',config:{label:'SAI work',endpoint:'http://127.0.0.1:5220'},expectedRevision:before.revision});
 assert.equal((await f.state.read()).instances.length,1);
 const result=await f.post({operation:'apply',planId:reviewed.plan.id});
 assert.equal(result.resources.length,2);assert.equal(result.resources.find(r=>r.instanceId==='sai-work').managed,false);
 const after=await f.state.read();assert.deepEqual(after.instances.find(i=>i.instanceId==='existing').config,before.instances[0].config);assert.deepEqual(after.selection,before.selection);assert.deepEqual(f.calls,[]);
});
test('disconnect retains the binding and credential; refresh and restart read saved setup directly',async t=>{
 const f=await fixture(t),reviewed=await f.post({operation:'plan-control',resourceKey:'setup:existing',action:'disconnect'});
 await f.post({operation:'apply',planId:reviewed.plan.id});
 const saved=await readFile(path.join(f.root,'setup.json'));
 const result=await f.post({operation:'refresh'});assert.equal(result.resources[0].status,'Disconnected');
 const restarted=createHubController({env:f.env,setup:f.setup,connections:f.connections});
 assert.equal((await restarted.get(f.request())).resources[0].status,'Disconnected');
 assert.deepEqual(await readFile(path.join(f.root,'setup.json')),saved);
 const state=await f.state.read();assert.equal(state.instances.length,1);assert.equal(state.instances[0].config.secretRef,'retained-credential');assert.deepEqual(f.calls,[]);
});
test('unknown resources, duplicate registration, CSRF and unreviewed applies are rejected',async t=>{
 const f=await fixture(t);
 await assert.rejects(f.post({operation:'apply',planId:'not-reviewed'}),{code:'hub_plan_expired'});
 await assert.rejects(f.post({operation:'plan-add',componentId:'devgraph',instanceId:'duplicate',mode:'connect',config:{endpoint:'http://127.0.0.1:4220'},expectedRevision:f.initial.setupRevision}),{code:'connection_already_registered'});
 await assert.rejects(f.post({operation:'plan-control',resourceKey:'setup:existing',action:'stop'}),{code:'unsupported_resource_action'});
 await assert.rejects(f.hub.post(f.request('wrong'),{schema:'zenith.hub-action.v1',operation:'refresh'}),{code:'cross_site_action'});
 await assert.rejects(f.hub.get(f.request(null,{origin:'https://example.com'})),{code:'wrong_origin'});
});
test('an unavailable owner marks only previously loaded rows unverified without a persistent graph fallback',async t=>{
 const f=await fixture(t);f.setOffline();
 const result=await f.post({operation:'refresh'});assert.equal(result.resources.length,1);assert.equal(result.resources[0].status,'Status unverified');assert.deepEqual(result.resources[0].actions,[]);assert.equal(result.warnings.length,1);assert.equal(result.setupRevision,null);
 const restarted=createHubController({env:f.env,setup:f.setup,connections:f.connections});
 assert.equal((await restarted.get(f.request())).resources.length,0);
});
