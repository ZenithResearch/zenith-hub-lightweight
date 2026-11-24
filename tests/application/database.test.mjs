import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {HubApplication} from '../../src/lib/application/database.mjs';
import {emptySetup,emptyResources} from '../../src/lib/application/model.mjs';
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'hub-app-db-')));const app=await HubApplication.open({dataDir:path.join(root,'objects'),setupRoot:root,resourcesFile:path.join(root,'resources.json')});t.after(async()=>{await app.close();await fs.rm(root,{recursive:true,force:true});});return {root,app};}
test('fresh initialization seeds actual app tables and software catalog once',async t=>{const {app}=await fixture(t);const status=await app.initialize({setup:emptySetup(),resources:emptyResources()});assert.equal(status.ready,true);assert.equal(status.software,6);assert.equal((await app.repository.readSnapshot()).snapshot.catalogEntries.length,6);assert.deepEqual(await app.readSetup(),emptySetup());const g=app.repository.generation();await app.initialize({setup:emptySetup(),resources:emptyResources()});assert.equal(app.repository.generation(),g);});
test('setup compatibility edits write normalized profile/service/connection records atomically',async t=>{const {app}=await fixture(t);const setup={...emptySetup(),revision:40,step:'environment',welcomeTargetId:'guide',welcomeEnteredAt:'2026-11-20T12:00:00Z',instances:[{instanceId:'guide',componentId:'hermes',mode:'install',config:{port:8642,providerId:'openai-codex',modelName:'test-model'},root:'/synthetic/guide',software:{source:'/synthetic/hermes'},profile:{name:'hub-guide',home:'/synthetic/profile'},installed:true,configured:true,running:false},{instanceId:'sai-work',componentId:'devgraph',mode:'connect',config:{endpoint:'http://127.0.0.1:5220',label:'SAI work',secretRef:'opaque-kept'}}],operations:{old:{id:'old',action:'install',state:'complete',instanceIds:['guide'],updatedAt:'2026-11-20T12:00:00Z'}}};await app.initialize({setup,resources:emptyResources()});assert.deepEqual(await app.readSetup(),setup);const snapshot=(await app.repository.readSnapshot()).snapshot;assert.equal(snapshot.installations[0].presence.state,'unknown');assert.equal(snapshot.connections[0].enabled,true);assert.equal(snapshot.profiles.find(p=>p.profileKind==='hermes').modelBinding.modelName,'test-model');await app.writeSetup(s=>{s.instances[1].enabled=false;s.instances[0].config.modelName='new-model';});const after=await app.readSetup();assert.equal(after.revision,41);assert.equal(after.instances[1].config.secretRef,'opaque-kept');assert.equal((await app.repository.readSnapshot()).snapshot.connections[0].enabled,false);assert.equal((await app.repository.readSnapshot()).snapshot.profiles.find(p=>p.profileKind==='hermes').modelBinding.modelName,'new-model');});
test('external credential contents stay outside object storage and connection fields have one owner',async t=>{const {root,app}=await fixture(t),file=path.join(root,'external.read');await fs.writeFile(file,'credential contents never read',{mode:0o600});const resources={schema:'zenith.hub-resources.v1',revision:4,resources:[{id:'sai',kind:'devgraph',label:'SAI',endpoint:'http://127.0.0.1:5220',credentialFile:file,lifecycle:'external',enabled:true}]};await app.initialize({setup:emptySetup(),resources});assert.deepEqual(await app.readResources(),resources);const doc=await app.repository.readApplicationDocument('resources');assert.equal(doc.value.resources[0].credentialFile,undefined);assert.equal(doc.value.resources[0].endpoint,undefined);const exported=JSON.stringify(await app.repository.exportDocument());assert.equal(exported.includes(file),false);assert.equal(exported.includes('credential contents never read'),false);await app.changeResources({operation:'set-enabled',resourceId:'sai',expectedRevision:4,enabled:false});assert.equal((await app.readResources()).resources[0].enabled,false);assert.equal(await fs.readFile(file,'utf8'),'credential contents never read');});

test('review artifacts and private payloads survive reopening; stale generation cannot apply',async t=>{
 const {root,app}=await fixture(t);await app.initialize({setup:emptySetup(),resources:emptyResources()});
 const plan={id:'review-persistent',action:'connect',expiresAt:Date.now()+120000,items:[],privateBinding:'not exported'};
 const generation=await app.saveReview(plan);await app.saveHubReview(plan.id,{kind:'setup',expiresAt:plan.expiresAt});
 const stored=await app.getReview(plan.id);assert.ok(stored.applicationGeneration>generation);assert.equal(stored.privateBinding,'not exported');
 const doc=await app.repository.readApplicationDocument('review:'+plan.id),artifact=await app.repository.getVersion(doc.value.artifactRef.objectId,doc.value.artifactRef.objectRevision);
 assert.equal(artifact.types.includes('https://zenith-research.ca/ontology/terms/Artifact'),true);assert.equal(JSON.stringify(await app.repository.exportDocument()).includes('not exported'),false);
 await app.close();const reopened=await HubApplication.open({dataDir:path.join(root,'objects'),setupRoot:root});t.after(()=>reopened.close());
 assert.equal((await reopened.getReview(plan.id)).privateBinding,'not exported');assert.equal((await reopened.getHubReview(plan.id)).kind,'setup');
 await reopened.writeSetup(s=>{s.step='environment';},{expectedGeneration:stored.applicationGeneration});
 await assert.rejects(reopened.writeSetup(s=>{s.step='welcome';},{expectedGeneration:stored.applicationGeneration}),{code:'setup_plan_changed'});
 assert.equal((await reopened.readSetup()).step,'environment');await reopened.deleteReview(plan.id);assert.equal(await reopened.getReview(plan.id),null);
});
test('a semantic object edit updates the actual setup view rather than a copied database label',async t=>{
 const {app}=await fixture(t),setup={...emptySetup(),instances:[{instanceId:'managed',componentId:'service-management',mode:'install',config:{label:'Before',port:8030}}]};await app.initialize({setup,resources:emptyResources()});
 const read=await app.repository.applicationState(),service=read.snapshot.services[0],old=await app.repository.get(service.id),label='http://www.w3.org/2000/01/rdf-schema#label',document=structuredClone(old.document);document.find(n=>n['@id']===service.id)[label]=[{'@value':'After'}];
 const profiles=structuredClone(old.projections);for(const p of profiles)if(p.value.label==='Before')p.value.label='After';
 await app.repository.importDocument(document,{importKey:'semantic-setup-edit',expectedRevisions:{[service.id]:old.revision},projections:{[service.id]:profiles}});
 assert.equal((await app.readSetup()).instances[0].config.label,'After');
});
test('forget disables the retained connection and preserves its historical credential binding',async t=>{
 const {root,app}=await fixture(t),file=path.join(root,'external.read'),resources={schema:'zenith.hub-resources.v1',revision:1,resources:[{id:'retained',kind:'devgraph',label:'Retained',endpoint:'http://127.0.0.1:5220',credentialFile:file,lifecycle:'external',enabled:true}]};
 await app.initialize({setup:emptySetup(),resources});await app.changeResources({operation:'forget',resourceId:'retained'});assert.equal((await app.readResources()).resources.length,0);const snapshot=(await app.repository.readSnapshot()).snapshot;assert.equal(snapshot.connections[0].enabled,false);assert.ok(snapshot.connections[0].credentialRef);
});
test('failed private document publication cannot create a second setup authority',async t=>{
 const {app}=await fixture(t);await app.initialize({setup:emptySetup(),resources:emptyResources()});
 const {ApplicationCompiler}=await import('../../src/lib/application/compiler.mjs'),read=await app.repository.applicationState(),compiler=new ApplicationCompiler(app.repository,read);
 compiler.document('setup','setup',{...emptySetup(),revision:1});const batch=await compiler.finish();batch.documentWrites[0].expectedRevision=99;
 await assert.rejects(app.repository.commitBatch(batch),{code:'stale_document_revision'});assert.equal((await app.readSetup()).revision,0);
});

test('a private document changed behind the repository is rejected at startup',async t=>{const {root,app}=await fixture(t);await app.initialize({setup:emptySetup(),resources:emptyResources()});await app.close();const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(path.join(root,'objects','objects.sqlite'));db.prepare("UPDATE hub_application_document_versions SET value_json='{}' WHERE document_key='setup'").run();db.close();await assert.rejects(HubApplication.open({dataDir:path.join(root,'objects'),setupRoot:root}),{code:'application_document_integrity'});});

test('existing retryable operations and their full bounded error text are retained',async t=>{const {app}=await fixture(t),setup={...emptySetup(),operations:{retry:{id:'retry',action:'start',state:'retryable',updatedAt:'2026-11-20T12:00:00Z',errorCode:'prior-error',error:'detail '.repeat(100)}}};await app.initialize({setup,resources:emptyResources()});assert.deepEqual(await app.readSetup(),setup);});

test('default Hermes configuration round-trips without manufacturing a native named profile',async t=>{
 const {app}=await fixture(t),setup={...emptySetup(),instances:[{instanceId:'default-hermes',componentId:'hermes',mode:'install',config:{port:18642,providerId:'openai-codex',modelName:'chosen'},configurationHome:'/synthetic/default-home',installed:true,configured:true}]};
 await app.initialize({setup,resources:emptyResources()});assert.deepEqual(await app.readSetup(),setup);
 const record=(await app.repository.readSnapshot()).snapshot.profiles.find(p=>p.profileKind==='hermes');assert.equal(record.nativeHome,'/synthetic/default-home');assert.equal(record.name,'default');
 const document=await app.repository.readApplicationDocument('setup');assert.equal(document.value.instances[0].configurationHome,undefined);assert.equal(document.value.instances[0].profile,undefined);
 await app.writeSetup(s=>{s.instances[0].config.modelName='updated';});const after=await app.readSetup();assert.equal(after.instances[0].configurationHome,'/synthetic/default-home');assert.equal(after.instances[0].profile,undefined);assert.equal(after.instances[0].config.modelName,'updated');
});
