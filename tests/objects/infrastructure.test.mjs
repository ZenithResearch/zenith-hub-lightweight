import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,rm,cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import jsonld from 'jsonld';
import {loadOntologyRegistry,sha256} from '../../src/lib/objects/registry.mjs';
import {ObjectStore} from '../../src/lib/objects/store.mjs';
import {exportBundle,importBundle,sealBundle} from '../../src/lib/objects/bundle.mjs';
import {createObjectController} from '../../src/lib/objects/controller.mjs';
const Z='https://zenith-research.ca/ontology/terms/',M='https://zenith-research.ca/ontology/hub/infrastructure',I=M+'/terms/',V=M+'/v0.1.0/';
const CP='https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/core.schema.json#/$defs/EntityProjection';
const exampleRoot='profiles/object-store/ontology/infrastructure';
const example=JSON.parse(await readFile(exampleRoot+'/examples/connected.jsonld','utf8'));
const exampleProjections=JSON.parse(await readFile(exampleRoot+'/examples/projections.json','utf8'));
const registry=await loadOntologyRegistry('profiles/object-store/registry.json');
const id=name=>'urn:hub:infrastructure:example:'+name;
const machine=(name='machine')=>({'@id':id(name),'@type':I+'Machine'});
const bindings=(name='machine',type=I+'Machine')=>[{profile:CP,value:{id:id(name),types:[type],invocationContract:structuredClone(exampleProjections[id('machine')][0].value.invocationContract)}}];
const canon=doc=>jsonld.canonize(doc,{algorithm:'RDFC-1.0',safe:true});
async function fixture(t) {
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'hub-infrastructure-'))),stores=[];
 t.after(async()=>{for(const store of stores)try{store.close();}catch{}await rm(root,{recursive:true,force:true});});
 const open=(name='data',reg=registry)=>{const s=new ObjectStore({dataDir:path.join(root,name),registry:reg});stores.push(s);return s;};
 return {root,open,s:open()};
}
async function moduleFixture(t) {
 const {root}=await fixture(t);await cp('profiles/object-store',path.join(root,'catalog'),{recursive:true});
 const file=path.join(root,'catalog/registry.json'),base=path.join(root,'catalog/ontology/infrastructure');
 const rehash=async()=>{
  const manifest=JSON.parse(await readFile(path.join(base,'manifest.json'),'utf8'));
  for(const row of manifest.files){const bytes=await readFile(path.join(base,row.path));row.sha256=sha256(bytes);row.bytes=bytes.length;}
  await writeFile(path.join(base,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const config=JSON.parse(await readFile(file,'utf8'));config.packages.find(p=>p.directory==='ontology/infrastructure').manifestSha256=sha256(await readFile(path.join(base,'manifest.json')));
  await writeFile(file,JSON.stringify(config));
 };
 return {root,file,base,rehash};
}
test('module identity, import pins and every referenced parent are verified; resources alone cannot satisfy imports',async t=>{
 assert.equal(registry.moduleGraph.modules.size,8);assert.equal(registry.types.size,42);
 assert.ok(registry.moduleGraph.isSubclassOf(I+'Machine',Z+'Entity'));
 for(const kind of ['missing-import','cached-schema','wrong-identity','wrong-version','missing-parent','unimported-parent','wrong-dependency']) {
  const f=await moduleFixture(t),doc=JSON.parse(await readFile(path.join(f.base,'ontology.jsonld'),'utf8'));
  const ontology=doc['@graph'].find(n=>n['@type']==='owl:Ontology');
  if(kind==='missing-import')ontology.imports=['https://unavailable.invalid/ontology'];
  if(kind==='cached-schema')ontology.imports=['https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/core.schema.json'];
  if(kind==='wrong-identity')ontology['@id']='urn:wrong:ontology';
  if(kind==='wrong-version')ontology.versionInfo='9.9.9';
  if(kind==='missing-parent')doc['@graph'].find(n=>n['@id']==='infra:Machine').subClassOf='urn:missing:Class';
  if(kind==='unimported-parent')doc['@graph'].find(n=>n['@id']==='infra:Machine').subClassOf='zn:Task';
  if(kind==='wrong-dependency'){
   const manifest=JSON.parse(await readFile(path.join(f.base,'manifest.json'),'utf8'));manifest.dependencies[0].sha256='0'.repeat(64);await writeFile(path.join(f.base,'manifest.json'),JSON.stringify(manifest));
  }
  await writeFile(path.join(f.base,'ontology.jsonld'),JSON.stringify(doc));await f.rehash();
  const code={'missing-import':'missing_module_import','cached-schema':'missing_module_import','wrong-identity':'module_identity_or_version_mismatch','wrong-version':'module_identity_or_version_mismatch','missing-parent':'missing_superclass','unimported-parent':'unimported_superclass','wrong-dependency':'module_dependency_mismatch'}[kind];
  await assert.rejects(loadOntologyRegistry(f.file),{code});
 }
});
test('subclass closure is cycle-safe without persisting invented ancestor types',async t=>{
 const f=await moduleFixture(t),doc=JSON.parse(await readFile(path.join(f.base,'ontology.jsonld'),'utf8'));
 doc['@graph'].find(n=>n['@id']==='infra:Machine').subClassOf='infra:ServiceInstance';
 doc['@graph'].find(n=>n['@id']==='infra:ServiceInstance').subClassOf='infra:Machine';
 await writeFile(path.join(f.base,'ontology.jsonld'),JSON.stringify(doc));await f.rehash();
 const r=await loadOntologyRegistry(f.file);assert.equal(r.moduleGraph.isSubclassOf(I+'Machine',I+'ServiceInstance'),true);
 assert.equal(r.moduleGraph.isSubclassOf(I+'Machine',Z+'Entity'),false);
});
test('observation imports remain partial; inherited infrastructure admission requires the exact Core projection',async t=>{
 const {s}=await fixture(t);await s.importDocument(machine(),{importKey:'observed'});
 assert.equal((await s.get(id('machine'))).admission,'observation');
 await assert.rejects(s.importDocument(machine(),{importKey:'missing',admission:'infrastructure',expectedRevisions:{[id('machine')]:1}}),{code:'required_projection_missing'});
 const value=await s.importDocument(machine(),{importKey:'admitted',admission:'infrastructure',expectedRevisions:{[id('machine')]:1},projections:{[id('machine')]:bindings()}});
 assert.equal(value.revisions[id('machine')],2);
 const record=await s.get(id('machine'));assert.equal(record.admission,'infrastructure');
 assert.equal(record.invocation.content,'pinned-and-schema-validated');assert.equal(record.invocation.reachability,'not-tested');assert.equal(record.invocation.authorization,'not-tested');
 assert.deepEqual(record.document[0]['@type'],[I+'Machine']);
});
test('closed Core projection rejects infrastructure attributes, mismatched identity/types and missing contract fields',async t=>{
 for(const change of ['extra','identity','type','contract']) {
  const {s}=await fixture(t),projections=bindings();
  if(change==='extra')projections[0].value.addresses=['192.0.2.1'];
  if(change==='identity')projections[0].value.id='urn:wrong';
  if(change==='type')projections[0].value.types=[Z+'Entity'];
  if(change==='contract')delete projections[0].value.invocationContract.sha256;
  await assert.rejects(s.importDocument(machine(),{importKey:change,admission:'infrastructure',projections:{[id('machine')]:projections}}));
  assert.equal(s.list().items.length,0);
 }
});
test('admitted service/deployment/attachment shapes and known relationship ranges are checked atomically',async t=>{
 const {s}=await fixture(t),service=id('application');
 await assert.rejects(s.importDocument({'@id':service,'@type':I+'ServiceInstance'},{importKey:'no-host',admission:'infrastructure',projections:{[service]:exampleProjections[service]}}),{code:'schema_validation_failed'});
 const bad=structuredClone(example);bad['@graph'].find(n=>n['@id']===service)['infra:hostedBy']={'@id':id('network')};
 await assert.rejects(s.importDocument(bad,{importKey:'bad-host',admission:'infrastructure',projections:exampleProjections}),{code:'relationship_type_mismatch'});
 assert.equal(s.list().items.length,0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM admissions').get().n,0);
 const wrong=structuredClone(exampleProjections);wrong[id('machine')][1].value.manager=id('machine');
 await assert.rejects(s.importDocument(example,{importKey:'conflation',admission:'infrastructure',projections:wrong}),{code:'binding_identity_conflation'});
});
test('asserted-only queries remain default; optional subclass expansion covers Machine, ServiceInstance and Request',async t=>{
 const {s}=await fixture(t);await s.importDocument(example,{importKey:'example',admission:'infrastructure',projections:exampleProjections});
 await s.importDocument({'@id':'urn:request','@type':Z+'Request'},{importKey:'request'});
 assert.equal(s.list({type:Z+'Entity'}).items.length,0);
 assert.equal(s.list({type:Z+'Entity',includeSubclasses:true}).items.length,6);
 assert.equal(s.list({type:Z+'Agent',includeSubclasses:true}).items.length,5);
 assert.ok(s.list({type:Z+'Artifact',includeSubclasses:true}).items.some(v=>v.id==='urn:request'));
 assert.ok(!s.list({type:Z+'Artifact'}).items.some(v=>v.id==='urn:request'));
 assert.equal((await s.get(id('file-store'))).invocation.content,'unresolved');
});
test('portable bindings and required contract references survive restart and a fresh store, without copying source revisions',async t=>{
 const {s,open}=await fixture(t);await s.importDocument(example,{importKey:'example',admission:'infrastructure',projections:exampleProjections});
 const changed=structuredClone(example);changed['@graph'][0]['http://www.w3.org/2000/01/rdf-schema#label']='Updated machine description';
 await s.importDocument(changed,{importKey:'update',expectedRevisions:{[id('machine')]:1}});s.close();
 const reopened=open(),bundle=await exportBundle(reopened);assert.equal((await reopened.get(id('machine'))).revision,2);
 assert.deepEqual(Object.keys(bundle).sort(),['admissions','dataset','datasetDigest','integrity','projections','requirements','schema'].sort());
 const fresh=open('fresh');await importBundle(fresh,JSON.parse(JSON.stringify(bundle)),{importKey:'portable',expectedBundleSha256:bundle.integrity.sha256});fresh.close();
 const destination=open('fresh'),again=await exportBundle(destination);
 assert.equal((await destination.get(id('machine'))).revision,1);
 assert.equal((await destination.get(id('machine'))).admission,'infrastructure');
 assert.deepEqual(again.projections,bundle.projections);assert.deepEqual(again.admissions,bundle.admissions);
 assert.equal(await canon(bundle.dataset),await canon(again.dataset));
 assert.equal((await destination.get(id('file-store'))).invocation.content,'unresolved');
 const plain=await reopened.exportDocument(),observation=open('plain');await observation.importDocument(plain,{importKey:'plain'});
 assert.equal((await observation.get(id('machine'))).admission,'observation');assert.deepEqual((await observation.get(id('machine'))).projections,[]);
});
test('bundle checksum, graph/binding identity, required bindings and exact dependency pins reject tampering before writes',async t=>{
 const {s,open}=await fixture(t);await s.importDocument(example,{importKey:'example',admission:'infrastructure',projections:exampleProjections});
 const original=await exportBundle(s);
 for(const kind of ['checksum','missing-projection','missing-map-entry','missing-module','wrong-module','wrong-type','wrong-contract','unknown-property']) {
  let bundle=structuredClone(original);
  if(kind==='checksum')bundle.projections[id('machine')][0].value.id='urn:tampered';
  if(kind==='missing-projection')bundle.projections[id('machine')]=[];
  if(kind==='missing-map-entry')delete bundle.admissions[id('machine')];
  if(kind==='missing-module')bundle.requirements.modules=bundle.requirements.modules.filter(v=>!v.versionIri.includes('/normalized/'));
  if(kind==='wrong-module')bundle.requirements.modules[0].version='9.9.9';
  if(kind==='wrong-type'){
   bundle.dataset.find(n=>n['@id']===id('machine'))['@type']=[Z+'Artifact'];bundle.datasetDigest.sha256=sha256(await canon(bundle.dataset));
  }
  if(kind==='wrong-contract')bundle.projections[id('machine')][0].value.invocationContract.sha256='0'.repeat(64);
  if(kind==='unknown-property')bundle.sourceRevision=99;
  if(!['checksum','unknown-property'].includes(kind))bundle=sealBundle(bundle);
  const fresh=open('invalid-'+kind);await assert.rejects(importBundle(fresh,bundle,{importKey:'invalid'}));
  assert.equal(fresh.list().items.length,0);assert.equal(fresh.db.prepare('SELECT COUNT(*) n FROM imports').get().n,0);
 }
 const modified=structuredClone(original);modified.projections[id('file-store')][0].value.invocationContract.id='urn:another:external-contract';
 await assert.rejects(importBundle(open('trusted-hash'),sealBundle(modified),{importKey:'hash',expectedBundleSha256:original.integrity.sha256}),{code:'bundle_integrity_mismatch'});
});
test('portable imports retain CAS/idempotency and rollback all admitted records after injected failure',async t=>{
 const {s,open}=await fixture(t);await s.importDocument(example,{importKey:'example',admission:'infrastructure',projections:exampleProjections});const bundle=await exportBundle(s),fresh=open('fresh');
 await importBundle(fresh,bundle,{importKey:'one'});assert.equal((await importBundle(fresh,bundle,{importKey:'one'})).replayed,true);
 await assert.rejects(importBundle(fresh,bundle,{importKey:'stale',expectedRevisions:{[id('machine')]:0}}),{code:'stale_revision'});
 const failed=open('failed'),originalIndex=failed.index.bind(failed);let writes=0;
 failed.index=unit=>{originalIndex(unit);if(++writes===3)throw Error('injected rollback');};
 await assert.rejects(importBundle(failed,bundle,{importKey:'failed'}),/injected rollback/);
 for(const table of ['objects','units','admissions','imports','object_types','object_links'])assert.equal(failed.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
});
test('Core release assets stay byte-identical and Infrastructure is a Domain instance',async()=>{
 const manifest=JSON.parse(await readFile('profiles/object-store/ontology/zenith-0.1.0/manifest.json','utf8'));
 for(const asset of manifest.files)assert.equal(sha256(await readFile('profiles/object-store/ontology/zenith-0.1.0/'+asset.path)),asset.sha256);
 assert.equal(sha256(await readFile('profiles/object-store/ontology/zenith-0.1.0/manifest.json')),'d73a66b7f780b8ebc1ec1ac1f7d3791eec91a0259dca90faf37927636ad08a4a');
 const domain=JSON.parse(await readFile(exampleRoot+'/domain.json','utf8'));registry.validateDefinition('https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/domain.schema.json',domain);
 assert.equal(domain.sourceModuleRef,V+'ontology.jsonld');
});

test('an owner-private subclass inherits profiles and portable dependencies without public vendoring',async t=>{
 const f=await moduleFixture(t),privateBase=path.join(f.root,'catalog/ontology/private');await mkdir(privateBase);
 const privateId='urn:private:infrastructure',versionIri=privateId+':v1',type='urn:private:ManagedMachine';
 const doc={'@context':{owl:'http://www.w3.org/2002/07/owl#',rdfs:'http://www.w3.org/2000/01/rdf-schema#'},'@graph':[
  {'@id':privateId,'@type':'owl:Ontology','owl:versionIRI':{'@id':versionIri},'owl:versionInfo':'1','owl:imports':{'@id':V+'ontology.jsonld'}},
  {'@id':type,'@type':'owl:Class','rdfs:subClassOf':{'@id':I+'Machine'}}]};
 const bytes=JSON.stringify(doc);await writeFile(path.join(privateBase,'ontology.jsonld'),bytes);
 const manifest={ontologyId:privateId,version:'1',versionIri,ontologyDocuments:[{path:'ontology.jsonld',ontologyId:privateId,versionIri}],files:[{path:'ontology.jsonld',sha256:sha256(bytes),bytes:Buffer.byteLength(bytes)}]};
 await writeFile(path.join(privateBase,'manifest.json'),JSON.stringify(manifest));
 const config=JSON.parse(await readFile(f.file,'utf8'));config.packages.push({directory:'ontology/private',manifestSha256:sha256(await readFile(path.join(privateBase,'manifest.json'))),source:{kind:'owner-private-fixture'}});await writeFile(f.file,JSON.stringify(config));
 const reg=await loadOntologyRegistry(f.file),s=new ObjectStore({memory:true,registry:reg}),fresh=new ObjectStore({memory:true,registry:reg}),missing=new ObjectStore({memory:true,registry});t.after(()=>{s.close();fresh.close();missing.close();});
 await s.importDocument({'@id':id('private'),'@type':type},{importKey:'private',admission:'infrastructure',projections:{[id('private')]:bindings('private',type)}});
 assert.equal(s.list({type:Z+'Entity',includeSubclasses:true}).items.length,1);
 const bundle=await exportBundle(s);await importBundle(fresh,bundle,{importKey:'fresh'});
 assert.equal((await fresh.get(id('private'))).admission,'infrastructure');
 await assert.rejects(importBundle(missing,bundle,{importKey:'missing'}),{code:'bundle_module_mismatch'});
});

test('API and CLI expose subclass queries and portable admission consistently',async t=>{
 const {s,root}=await fixture(t),origin='http://127.0.0.1:4208';
 const c=createObjectController({env:{ZENITH_LOCAL_OPERATOR:'1',ZENITH_HUB_DATA_DIR:'/unused'},storeFactory:()=>s});
 const request=(query,csrf)=>new Request(origin+'/api/objects?'+query,{headers:{host:'127.0.0.1:4208',origin,'content-type':'application/json','x-zenith-csrf':csrf||''}});
 const session=await c.get(request('operation=session'));
 await c.post(request('',session.csrf),{schema:'zenith.hub-object-action.v1',operation:'import',importKey:'api',document:example,admission:'infrastructure',projections:exampleProjections});
 const query='operation=list&type='+encodeURIComponent(Z+'Entity');assert.equal((await c.get(request(query))).items.length,0);
 assert.equal((await c.get(request(query+'&includeSubclasses=true'))).items.length,6);
 const exported=await c.get(request('operation=export-bundle'));assert.equal(exported.bundle,true);assert.equal(exported.document.schema,'zenith.hub-object-bundle.v1');
 const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');const exec=promisify(execFile),input=path.join(root,'bundle.json'),directory=path.join(root,'cli');await writeFile(input,JSON.stringify(exported.document));
 await exec(process.execPath,['scripts/objects.mjs','import-bundle','--data-dir',directory,'--input',input,'--import-key','cli','--expected-bundle-sha256',exported.document.integrity.sha256]);
 const queried=JSON.parse((await exec(process.execPath,['scripts/objects.mjs','list','--data-dir',directory,'--type',Z+'Entity','--include-subclasses','true'])).stdout);assert.equal(queried.items.length,6);
 const bundle=JSON.parse((await exec(process.execPath,['scripts/objects.mjs','export-bundle','--data-dir',directory])).stdout);assert.deepEqual(bundle.projections,exported.document.projections);
});

test('the optional Hub schema upgrade preserves v1 records as observations and their retry receipts',async t=>{
 const {s,open}=await fixture(t);await s.importDocument(machine(),{importKey:'legacy-retry'});
 const oldAssertions=s.db.prepare('SELECT nquads FROM units').get().nquads;
 s.db.exec('DROP TABLE admissions; PRAGMA user_version=1');s.close();
 const upgraded=open();assert.equal(upgraded.admission(id('machine')),'observation');
 assert.equal(upgraded.db.prepare('SELECT nquads FROM units').get().nquads,oldAssertions);
 assert.equal((await upgraded.importDocument(machine(),{importKey:'legacy-retry'})).replayed,true);
});

test('module verification reads RDF facts rather than assuming one JSON node per declaration',async t=>{
 const f=await moduleFixture(t),doc=JSON.parse(await readFile(path.join(f.base,'ontology.jsonld'),'utf8'));
 const machine=doc['@graph'].find(n=>n['@id']==='infra:Machine'),parent=machine.subClassOf;delete machine.subClassOf;
 doc['@graph'].push({'@id':'infra:Machine',subClassOf:parent});
 const ontology=doc['@graph'].find(n=>n['@type']==='owl:Ontology'),imports=ontology.imports;delete ontology.imports;
 doc['@graph'].push({'@id':ontology['@id'],imports});
 await writeFile(path.join(f.base,'ontology.jsonld'),JSON.stringify(doc));await f.rehash();
 const r=await loadOntologyRegistry(f.file);assert.equal(r.moduleGraph.isSubclassOf(I+'Machine',Z+'Entity'),true);
});
