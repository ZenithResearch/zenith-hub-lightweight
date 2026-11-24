import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fixture,editJSON,rehash,rows,csv} from './helpers.mjs';
import {readPackage} from '../../src/lib/catalog/package.mjs';
import {stableJSON} from '../../src/lib/objects/bundle.mjs';

const entryHeaders=['entryId','catalogId','softwareId','softwarePath','label','category','position','recipeIds'];
const recipeHeaders=['recipeId','softwareId','path'];
const softwareId='urn:zenith:software:hermes';
const recipeId='urn:zenith:hub:recipe:hermes-install';
const json=(directory,file)=>fs.readFile(path.join(directory,file),'utf8').then(JSON.parse);
async function changeRecipe(directory,file,change){await editJSON(directory,file,d=>{const body=JSON.parse(d['cms:spec']);change(body);d['cms:spec']=stableJSON(body);});}
async function entries(directory,change){const list=await rows(directory,'catalog.csv',entryHeaders);change(list);await fs.writeFile(path.join(directory,'catalog.csv'),csv(list,entryHeaders));}
async function addInstallRecipe(directory,{attach=true,qualification='supported'}={}){
 const original=await json(directory,'recipes/hermes-install.jsonld'),added=structuredClone(original);
 added['@id']='urn:zenith:hub:recipe:hermes-install-entry';added['rdfs:label']='Hermes install entry';
 const body=JSON.parse(added['cms:spec']);body.actions=['install'];body.version='1';body.qualification=qualification;added['cms:spec']=stableJSON(body);
 await fs.writeFile(path.join(directory,'recipes/hermes-install-entry.jsonld'),JSON.stringify(added,null,2)+'\n');
 const list=await rows(directory,'recipes.csv',recipeHeaders);list.push({recipeId:added['@id'],softwareId,path:'recipes/hermes-install-entry.jsonld'});await fs.writeFile(path.join(directory,'recipes.csv'),csv(list,recipeHeaders));
 if(attach)await entries(directory,list=>{const e=list.find(v=>v.softwareId===softwareId);e.recipeIds=JSON.stringify([...JSON.parse(e.recipeIds),added['@id']]);});
 return added['@id'];
}
const collisions=[
 ['recipe/software with matching labels',async directory=>{
  await editJSON(directory,'recipes/hermes-install.jsonld',d=>{d['@id']=softwareId;d['rdfs:label']='Hermes';});
  const list=await rows(directory,'recipes.csv',recipeHeaders);list.find(r=>r.recipeId===recipeId).recipeId=softwareId;await fs.writeFile(path.join(directory,'recipes.csv'),csv(list,recipeHeaders));
  await entries(directory,list=>{const e=list.find(v=>v.softwareId===softwareId);e.recipeIds=JSON.stringify(JSON.parse(e.recipeIds).map(id=>id===recipeId?softwareId:id));});
 }],
 ['package/software with matching labels',directory=>editJSON(directory,'manifest.jsonld',d=>{d['@id']=softwareId;d['rdfs:label']='Hermes';})],
 ['package/recipe with matching labels',async directory=>{const r=await json(directory,'recipes/hermes-install.jsonld');await editJSON(directory,'manifest.jsonld',d=>{d['@id']=r['@id'];d['rdfs:label']=r['rdfs:label'];});}],
];
for(const [name,mutate]of collisions){
 test('fresh package rejects '+name+' before any content publication',async t=>{
  const f=await fixture(t);await mutate(f.cms);await rehash(f.cms);
  await assert.rejects(readPackage(f.app.repository,{directory:f.cms}),{code:'catalog_object_identity_collision'});
  await assert.rejects(f.init(),e=>e.code==='catalog_unavailable'&&e.details.cause==='catalog_object_identity_collision');
  const read=await f.app.repository.applicationState();assert.equal(read.state.generation,0);assert.equal(read.state.objects.length,0);assert.equal(read.state.commits.length,0);assert.equal(read.state.documents.length,0);
 });
 test('update rejects '+name+' and preserves the complete catalog and local data',async t=>{
  const f=await fixture(t);await f.init();await f.app.repository.importDocument({'@id':'urn:local:kept','urn:note':'local data'},{importKey:'local-kept'});
  const before=await f.app.repository.applicationState(),active=await f.app.catalogService.registry();await mutate(f.cms);await rehash(f.cms);
  const result=await f.app.synchronizeCatalog();assert.equal(result.warning,'catalog_object_identity_collision');assert.equal(result.changed,false);
  assert.deepEqual((await f.app.repository.applicationState()).state,before.state);assert.equal((await f.app.catalogService.registry()).package.digest,active.package.digest);assert.equal((await f.app.repository.get('urn:local:kept')).revision,1);
 });
}

test('missing install entry action fails fresh import without publishing content',async t=>{
 const f=await fixture(t);await changeRecipe(f.cms,'recipes/hermes-install.jsonld',b=>{b.version='2';b.actions=b.actions.filter(a=>a!=='install');});await rehash(f.cms);
 await assert.rejects(readPackage(f.app.repository,{directory:f.cms}),e=>e.code==='catalog_entry_action_missing'&&e.details.mode==='install'&&e.details.action==='install');
 await assert.rejects(f.init(),{code:'catalog_unavailable'});assert.equal(f.app.repository.generation(),0);assert.equal((await f.app.repository.applicationState()).state.objects.length,0);
});
test('removing install action cannot leave an advertised mode or alter the previous catalog/local data',async t=>{
 const f=await fixture(t);await f.init();await f.app.repository.importDocument({'@id':'urn:local:preserve','urn:value':'preserved'},{importKey:'local-preserve'});const before=await f.app.repository.applicationState(),reg=await f.app.catalogService.registry();
 await changeRecipe(f.cms,'recipes/hermes-install.jsonld',b=>{b.version='2';b.actions=b.actions.filter(a=>a!=='install');});await rehash(f.cms);const result=await f.app.synchronizeCatalog();assert.equal(result.warning,'catalog_entry_action_missing');assert.equal(result.changed,false);assert.deepEqual((await f.app.repository.applicationState()).state,before.state);
 const retained=await f.app.catalogService.registry();assert.equal(retained.package.digest,reg.package.digest);assert.equal(retained.resolveRecipe('hermes','install','install').id,recipeId);assert.equal((await f.app.repository.getVersion(recipeId,1)).revision,1);
});
test('an unqualified connect recipe alone cannot supply a supported advertised entry mode',async t=>{
 const f=await fixture(t);await changeRecipe(f.cms,'recipes/devgraph-connect.jsonld',b=>{b.qualification='unqualified';b.qualificationReason='fixture';});await rehash(f.cms);await assert.rejects(readPackage(f.app.repository,{directory:f.cms}),e=>e.code==='catalog_entry_action_missing'&&e.details.mode==='connect');
});
test('unattached recipes cannot supply an entry action removed from the attached recipes',async t=>{
 const f=await fixture(t);await addInstallRecipe(f.cms,{attach:false});await changeRecipe(f.cms,'recipes/hermes-install.jsonld',b=>{b.version='2';b.actions=['configure'];});await rehash(f.cms);await assert.rejects(readPackage(f.app.repository,{directory:f.cms}),{code:'catalog_entry_action_missing'});
});
test('configure-only supplementary recipes share software and profiles without broadening their actions',async t=>{
 const f=await fixture(t);await changeRecipe(f.cms,'recipes/hermes-install.jsonld',b=>{b.version='2';b.actions=['configure'];});const entryId=await addInstallRecipe(f.cms);await rehash(f.cms);await f.init();
 const p=await readPackage(f.app.repository,{directory:f.cms}),read=await f.app.repository.applicationState(),reg=await f.app.catalogService.registry(),software=await f.app.repository.get(softwareId);
 assert.equal(p.software.size,6);assert.equal(p.recipes.size,12);assert.equal(read.state.selectedObjects.length,20);assert.equal(read.snapshot.softwareDescriptors.length,6);assert.equal(software.projections.length,2);assert.ok(software.projections.some(v=>v.profile.endsWith('/SoftwareDescriptorProjection')));assert.ok(software.projections.some(v=>v.profile.endsWith('/SoftwareMetadata')));
 assert.equal(reg.resolveRecipe('hermes','install','install').id,entryId);assert.equal(reg.resolveRecipe('hermes','install','configure').id,recipeId);assert.deepEqual(p.recipes.get(recipeId).body.actions,['configure']);assert.deepEqual(reg.byId.get('hermes').modes,['connect','install']);
 for(const row of read.snapshot.catalogEntries){const descriptor=reg.byId.get(row.key);assert.deepEqual(row.supportedModes,descriptor.modes);}
});
test('automatic resolution uses a qualified covering recipe while explicit unqualified selection remains blocked',async t=>{
 const f=await fixture(t);await changeRecipe(f.cms,'recipes/hermes-install.jsonld',b=>{b.version='2';b.qualification='unqualified';b.qualificationReason='fixture-only combination';});const entryId=await addInstallRecipe(f.cms);await rehash(f.cms);await f.init();const reg=await f.app.catalogService.registry();assert.equal(reg.resolveRecipe('hermes','install','install').id,entryId);assert.throws(()=>reg.resolveRecipe('hermes','install','install',recipeId),{code:'catalog_recipe_unqualified'});
});
test('explicitly withdrawing an install mode is accepted and does not recreate the removed permission',async t=>{
 const f=await fixture(t);await f.init();await entries(f.cms,list=>{const e=list.find(v=>v.softwareId===softwareId);e.recipeIds=JSON.stringify(JSON.parse(e.recipeIds).filter(id=>id!==recipeId));});const list=await rows(f.cms,'recipes.csv',recipeHeaders);await fs.writeFile(path.join(f.cms,'recipes.csv'),csv(list.filter(v=>v.recipeId!==recipeId),recipeHeaders));await fs.rm(path.join(f.cms,'recipes/hermes-install.jsonld'));await rehash(f.cms);assert.equal((await f.app.synchronizeCatalog()).changed,true);const reg=await f.app.catalogService.registry();assert.deepEqual(reg.byId.get('hermes').modes,['connect']);assert.deepEqual((await f.app.repository.readSnapshot()).snapshot.catalogEntries.find(e=>e.key==='hermes').supportedModes,['connect']);assert.throws(()=>reg.resolveRecipe('hermes','install','install'),{code:'catalog_recipe_unavailable'});assert.equal((await f.app.repository.getVersion(recipeId,1)).revision,1);
});
test('default package retains all authored RDF/profile values, membership modes, identities and qualification boundaries',async t=>{
 const f=await fixture(t);await f.init();const p=await readPackage(f.app.repository,{directory:f.cms}),read=await f.app.repository.applicationState(),reg=await f.app.catalogService.registry();assert.equal(read.state.selectedObjects.length,19);assert.equal(p.software.size,6);assert.equal(p.recipes.size,11);assert.equal(JSON.parse(p.packageValue.specJson).files.length,19);for(const [id,software]of p.software){const e=read.validation.entries.get(read.validation.selected.get(id));assert.equal(e.views.get('SoftwareDescriptor').value.label,software.label);}
 for(const [role,values]of [['CatalogSoftwareMetadata',[...p.software.values()].map(v=>v.value)],['CatalogRecipe',[...p.recipes.values()].map(v=>v.value)],['CatalogPackage',[p.packageValue]]])for(const value of values){const e=read.validation.entries.get(read.validation.selected.get(value.id));assert.deepEqual(e.views.get(role).value,value);assert.ok(e.object.jsonldFile&&e.object.bindingsFile);}
 assert.deepEqual(p.catalog,JSON.parse(await fs.readFile('profiles/setup/catalog.json')));assert.deepEqual(reg.byId.get('devgraph').modes,['connect']);assert.throws(()=>reg.resolveRecipe('matrix','vps','install'),{code:'catalog_recipe_unqualified'});for(const row of read.snapshot.catalogEntries)assert.deepEqual(row.supportedModes,reg.byId.get(row.key).modes);
 const generation=f.app.repository.generation();assert.equal((await f.app.synchronizeCatalog()).changed,false);assert.equal(f.app.repository.generation(),generation);
});
