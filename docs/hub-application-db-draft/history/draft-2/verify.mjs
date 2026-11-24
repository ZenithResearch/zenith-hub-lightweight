/** Draft contract checks. Reads/writes synthetic review fixtures only; never opens a live Hub DB. */
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';import addFormats from 'ajv-formats';import jsonld from 'jsonld';
import {loadOntologyRegistry} from '../../src/lib/objects/registry.mjs';
const root=path.resolve('docs/hub-application-db-draft'),storage=await fs.realpath(path.join(root,'object-storage'));
const bytes=p=>fs.readFile(p),read=async p=>JSON.parse(await fs.readFile(p,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const stable=x=>JSON.stringify(x&&typeof x==='object'?Array.isArray(x)?x.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(stable(x[k]))])):x);
const fail=code=>{throw Error(code);},equal=(a,b)=>stable(a)===stable(b),key=(id,revision)=>id+'|'+revision;
const trust=await read(path.join(root,'trusted-fixture-manifest.json'));
for(const [file,pin] of [['schema.json','schemaSha256'],['field-ownership.json','ownershipSha256']])if(hash(await bytes(path.join(root,file)))!==trust[pin])fail('trusted_source_changed');
if(hash(await bytes('profiles/object-store/registry.json'))!==trust.sourceRegistrySha256)fail('trusted_registry_changed');
const schema=await read(path.join(root,'schema.json')),ownership=await read(path.join(root,'field-ownership.json')),registry=await loadOntologyRegistry('profiles/object-store/registry.json');
const ajv=addFormats(new Ajv2020({allErrors:true,strictSchema:true,strictTypes:false,allowUnionTypes:true}));
for(const d of Object.values(registry.documents))if(d.$id&&d.$schema&&!ajv.getSchema(d.$id))ajv.addSchema(d);
ajv.addSchema(schema);const validate=ajv.getSchema(schema.$id),validateBindings=ajv.compile({$ref:schema.$id+'#/$defs/ProfileBindingsFile'});
for(const m of Object.values(ownership.records))registry.profiles.set(m.projection,{id:m.projection,representation:'projection',appliesTo:[m.appliesTo],includeSubclasses:m.includeSubclasses,identityField:'id',typesField:'types',validate:ajv.compile({$ref:m.projection})});
const pins=new Map(trust.definitionPins.map(p=>[p.kind+'|'+p.id,p])),commits=new Map(trust.committedObjectVersions.map(v=>[key(v.id,v.objectRevision),v]));
async function stored(ref){
 const file=path.resolve(storage,ref.storageKey),actual=await fs.realpath(file);if(!actual.startsWith(storage+path.sep))fail('unsafe_storage_key');
 if((await fs.lstat(file)).isSymbolicLink())fail('unsafe_storage_key');
 const data=await bytes(actual),digest=hash(data);if(digest!==ref.artifact.sha256||data.length!==ref.artifact.byteLength)fail('stored_file_integrity_mismatch');
 if(ref.artifact.id!=='urn:sha256:'+digest)fail('representation_identity_mismatch');
 return JSON.parse(data.toString('utf8'));
}
function allNodes(value,result=[]){if(Array.isArray(value))for(const v of value)allNodes(v,result);else if(value&&typeof value==='object'){if(value['@id']&&!value['@id'].startsWith('_:'))result.push(value);for(const [k,v]of Object.entries(value))if(k!=='@context')allNodes(v,result);}return result;}
function subject(nodes,id){const parts=nodes.filter(n=>n['@id']===id),out={'@id':id};for(const n of parts)for(const [k,v]of Object.entries(n))if(k!=='@id'){const values=Array.isArray(v)?v:[v];out[k]=[...new Map([...(out[k]||[]),...values].map(x=>[stable(x),x])).values()];}return out;}
const profilesFor={hosts:'Host',softwareDescriptors:'SoftwareDescriptor',sourceSnapshots:'SoftwareSourceSnapshot',builds:'SoftwareBuild',installations:'SoftwareInstallationRecord',services:'ServiceInstance'};
const definitionKey=d=>d.kind+'|'+d.id;
async function verify(snapshot){
 if(!validate(snapshot))fail('snapshot_schema_invalid');
 const ids=new Set([snapshot.hub.id]),records=new Map();
 for(const [group,rows]of Object.entries(snapshot))if(Array.isArray(rows)&&group!=='objectRecords')for(const row of rows){if(ids.has(row.id))fail('duplicate_record_identity');ids.add(row.id);records.set(row.id,row);}
 const objects=new Map(),loaded=new Map();
 for(const o of snapshot.objectRecords){const k=key(o.id,o.objectRevision);if(objects.has(k))fail('duplicate_object_version');objects.set(k,o);}
 for(const [k,o]of objects){
  const committed=commits.get(k);if(!committed)fail('uncommitted_object_version');
  if(committed.admission!==o.admission||committed.jsonldSha256!==o.jsonldFile.artifact.sha256||committed.bindingsSha256!==o.bindingsFile.artifact.sha256)fail('committed_version_mismatch');
  if(o.jsonldFile.artifact.mediaType!=='application/ld+json'||o.bindingsFile.artifact.mediaType!=='application/json')fail('wrong_media_type');
  const document=await stored(o.jsonldFile),file=await stored(o.bindingsFile);
  if(!validateBindings(file)||file.objectId!==o.id||file.objectRevision!==o.objectRevision)fail('profile_revision_mismatch');
  const loader=async url=>{if(!registry.documents[url])fail('unpinned_context');return {contextUrl:null,documentUrl:url,document:registry.documents[url]};};
  const expanded=await jsonld.expand(document,{documentLoader:loader}),nodes=allNodes(expanded),node=subject(nodes,o.id);
  if(!equal([...(node['@type']||[])].sort(),[...o.types].sort()))fail('jsonld_identity_or_type_mismatch');
  for(const t of o.types)if(!registry.types.has(t))fail('unrecognized_ontology_type');
  registry.validateNode(node,o.admission);registry.validateProjections(o.id,o.types,file.bindings,o.admission);
  const required=new Set(['json-schema|'+schema.$id+'#/$defs/ProfileBindingsFile']);
  for(const type of o.types)for(const id of registry.moduleGraph.closure(registry.moduleGraph.owners.get(type))){required.add('ontology-module|'+id);required.add('package-manifest|'+registry.moduleGraph.modules.get(id).package);}
  for(const p of registry.profiles.values())if(p.representation==='expanded-node'&&registry.matches(p,o.types)&&(!p.admissionOnly||p.admissionOnly===o.admission))required.add('json-schema|'+p.id);
  for(const b of file.bindings)required.add('json-schema|'+b.profile);
  required.add('json-schema|https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/core.schema.json#/$defs/ArtifactRef');
  const seen=new Set();for(const d of o.definitions){const dk=definitionKey(d);if(seen.has(dk))fail('duplicate_definition_reference');seen.add(dk);if(!pins.has(dk)||!equal(d,pins.get(dk)))fail('untrusted_definition_pin');await stored(d.file);}
  for(const requiredKey of required)if(!seen.has(requiredKey))fail('missing_required_definition');
  const canonical=await jsonld.canonize(document,{algorithm:'RDFC-1.0',format:'application/n-quads',documentLoader:loader});
  const restored=await jsonld.fromRDF(canonical,{format:'application/n-quads'});
  if(await jsonld.canonize(restored,{algorithm:'RDFC-1.0',format:'application/n-quads'})!==canonical)fail('rdf_round_trip_failed');
  loaded.set(k,{node,nodes,file,canonical});
 }
 // Every locally asserted typed peer in an atomic export must have a consistent stored version.
 for(const [k,v]of loaded)for(const peer of v.nodes.filter(n=>n['@type']?.length)){
  const peers=[...loaded].filter(([pk])=>objects.get(pk).id===peer['@id']);if(!peers.length)fail('typed_peer_without_storage');
  if(!peers.some(([,p])=>p.canonical===v.canonical))fail('inconsistent_atomic_export');
 }
 for(const [group,rows]of Object.entries(snapshot))if(profilesFor[group]||group==='profiles')for(const row of rows){
  const name=group==='profiles'?(row.profileKind==='hermes'?'HermesConfigurationProfile':'ConfigurationProfile'):profilesFor[group],m=ownership.records[name],v=row.objectVersion;
  if(v.objectId!==row.id||v.profileId!==m.projection)fail('wrong_view_binding');
  const o=objects.get(key(v.objectId,v.objectRevision)),entry=loaded.get(key(v.objectId,v.objectRevision));if(!o)fail('missing_committed_object_version');
  if(!o.types.some(t=>registry.moduleGraph.isSubclassOf(t,m.appliesTo)))fail('record_ontology_type_mismatch');
  const binding=entry.file.bindings.find(b=>b.profile===v.profileId);if(!binding)fail('missing_projection_value');
  const expected={types:o.types};for(const [field,rule]of Object.entries(m.fields))if(rule.owner!=='operational'){
   if(rule.owner==='rdf'){
    let value;if(rule.predicate==='@id')value=entry.node['@id'];else{const facts=entry.node[rule.predicate];if(field==='hostRefs'){if(facts?.length)value=facts.map(x=>x['@id']).sort();}else if(facts?.length===1&&typeof facts[0]['@value']==='string')value=facts[0]['@value'];else if(facts?.length)fail('ambiguous_rdf_projection');}
    if(value!==undefined)expected[field]=value;
   }else if(Object.hasOwn(binding.value,field))expected[field]=binding.value[field];
  }
  if(!equal(binding.value,expected))fail('rdf_profile_drift');
  const actual={types:o.types};for(const [field,rule]of Object.entries(m.fields))if(rule.owner!=='operational'&&Object.hasOwn(row,field))actual[field]=row[field];
  if(!equal(actual,expected))fail('application_projection_drift');
  // Recover the view using both serialized authorities; preserve explicit optional-field removal.
  if(!equal(JSON.parse(stable(expected)),actual))fail('profile_view_round_trip_failed');
 }
 const maps=Object.fromEntries(Object.entries(snapshot).filter(([k,v])=>Array.isArray(v)&&k!=='objectRecords').map(([k,v])=>[k,new Map(v.map(x=>[x.id,x]))]));
 const need=(group,id)=>{const v=maps[group]?.get(id);if(!v)fail('reference_integrity');return v;};
 const software=id=>need('softwareDescriptors',id),agree=(a,b)=>{if(a!==b)fail('software_reference_mismatch');};
 const keys=new Set();for(const s of snapshot.softwareDescriptors){if(keys.has(s.key))fail('duplicate_software_key');keys.add(s.key);}
 const catalogKeys=new Set();for(const e of snapshot.catalogEntries){software(e.softwareRef);const k=e.catalogId+'|'+e.key;if(catalogKeys.has(k))fail('duplicate_catalog_key');catalogKeys.add(k);}
 for(const s of snapshot.sourceSnapshots)software(s.softwareRef);
 for(const b of snapshot.builds){software(b.softwareRef);if(b.sourceSnapshotRef)agree(b.softwareRef,need('sourceSnapshots',b.sourceSnapshotRef).softwareRef);}
 for(const i of snapshot.installations){software(i.softwareRef);need('hosts',i.hostRef);if(i.sourceSnapshotRef)agree(i.softwareRef,need('sourceSnapshots',i.sourceSnapshotRef).softwareRef);if(i.buildRef)agree(i.softwareRef,need('builds',i.buildRef).softwareRef);}
 for(const p of snapshot.profiles){const s=software(p.softwareRef);if(p.installationRef)agree(p.softwareRef,need('installations',p.installationRef).softwareRef);if(p.profileKind==='hermes'&&s.key!=='hermes')fail('hermes_profile_software_mismatch');if(p.modelBinding?.serverConnectionRef)need('connections',p.modelBinding.serverConnectionRef);}
 for(const s of snapshot.services){software(s.softwareRef);if(s.management==='external'&&s.desiredState!=='unmanaged')fail('external_service_requires_unmanaged');if(s.installationRef)agree(s.softwareRef,need('installations',s.installationRef).softwareRef);if(s.profileRef){const p=need('profiles',s.profileRef);agree(s.softwareRef,p.softwareRef);if(p.installationRef&&s.installationRef&&p.installationRef!==s.installationRef)fail('profile_installation_mismatch');}for(const h of s.hostRefs||[])need('hosts',h);}
 if(snapshot.hub.localHostRef)need('hosts',snapshot.hub.localHostRef);
 if(snapshot.hub.selectedGuideProfileRef&&need('profiles',snapshot.hub.selectedGuideProfileRef).profileKind!=='hermes')fail('guide_profile_requires_hermes_schema');
 for(const c of snapshot.connections)if(c.targetScope==='local'&&!records.has(c.targetRef)&&![...objects.values()].some(o=>o.id===c.targetRef))fail('reference_integrity');
 for(const op of snapshot.operations)for(const id of op.targetRefs)if(!records.has(id)&&![...objects.values()].some(o=>o.id===id))fail('reference_integrity');
 return {objectVersions:objects.size,typedViews:Object.keys(profilesFor).reduce((n,k)=>n+snapshot[k].length,0)+snapshot.profiles.length};
}
const base=await read(path.join(root,'example-installed-without-guide.json')),configured=await read(path.join(root,'example-configured.json')),checks=[];
async function passes(name,data){const result=await verify(data);checks.push({name,passed:true});return result;}
async function rejects(name,data,mutate,code){const copy=structuredClone(data);mutate(copy);try{await verify(copy);}catch(e){if(e.message===code){checks.push({name,passed:true});return;}throw Error(name+': expected '+code+', got '+e.message);}fail('accepted_invalid_fixture: '+name);}
const counts=await passes('software installation without any guide or running service',base);await passes('generic named profile without AI fields',await read(path.join(root,'example-generic-profile.json')));await passes('Hermes profile composition, build and stopped external service',configured);
await rejects('database Host label drift is rejected',base,s=>{s.hosts[0].label='Changed in DB only';},'application_projection_drift');
await rejects('stale or missing object revision is rejected',base,s=>{s.hosts[0].objectVersion.objectRevision=2;},'missing_committed_object_version');
await rejects('duplicate application rows are rejected',base,s=>{s.hosts.push(structuredClone(s.hosts[0]));},'duplicate_record_identity');
await rejects('a Host cannot use an Artifact stored version',base,s=>{const d=s.softwareDescriptors[0];s.hosts=[{...s.hosts[0],id:d.id,objectVersion:d.objectVersion}];s.softwareDescriptors=[];s.hosts[0].objectVersion.profileId=ownership.records.Host.projection;},'record_ontology_type_mismatch');
await rejects('applicable observed schema reference is mandatory',base,s=>{s.objectRecords[0].definitions=s.objectRecords[0].definitions.filter(d=>!d.id.endsWith('/MachineObserved'));},'missing_required_definition');
await rejects('trusted definition pins cannot be substituted',base,s=>{s.objectRecords[0].definitions[0].file.artifact.sha256='0'.repeat(64);},'untrusted_definition_pin');
await rejects('missing versioned projection value file is rejected',base,s=>{delete s.objectRecords[0].bindingsFile;},'snapshot_schema_invalid');
await rejects('mutable source branches are rejected',base,s=>{s.sourceSnapshots[0].commit='main';},'snapshot_schema_invalid');
await rejects('unknown host references are rejected',base,s=>{s.hub.localHostRef='urn:example:missing-host';},'reference_integrity');
await rejects('raw model fields are not accepted on generic profiles',configured,s=>{s.profiles[0].profileKind='generic';},'snapshot_schema_invalid');
await rejects('empty Hermes model configuration is rejected',configured,s=>{s.profiles[0].modelBinding={};},'snapshot_schema_invalid');
await rejects('external service lifecycle remains unmanaged',configured,s=>{s.services[0].desiredState='running';},'external_service_requires_unmanaged');
await rejects('representation IRI is distinct and content addressed',base,s=>{s.objectRecords[0].jsonldFile.artifact.id=s.objectRecords[0].id;},'representation_identity_mismatch');
await rejects('runtime state is not software presence',base,s=>{s.installations[0].presence.state='stopped';},'snapshot_schema_invalid');
const secondCatalog=structuredClone(base);secondCatalog.catalogEntries.push({...secondCatalog.catalogEntries[0],id:'urn:example:catalog-entry:second',catalogId:'urn:example:catalog:second',key:'alternative-name'});await passes('two catalogs reference one stable software descriptor',secondCatalog);
const remote=structuredClone(base);remote.connections.push({id:'urn:example:connection:remote',revision:1,label:'Synthetic external service',targetRef:'urn:example:external-service',targetScope:'external-unresolved',adapterRef:'hermes',endpoint:'http://127.0.0.1:65221',enabled:false});await passes('explicit external reference does not invent a local service or installation',remote);
await rejects('unresolved local connection targets are rejected',remote,s=>{s.connections[0].targetScope='local';},'reference_integrity');
const operational=structuredClone(base);operational.installations[0].presence.state='unknown';operational.installations[0].presence.reason='Inspection failed';operational.installations[0].revision++;await passes('inspection-owned operational state changes without changing semantic object version',operational);
const report={status:'draft-2-contract-fixture-checks',...counts,checks,limitations:['Only synthetic observation-mode objects are qualified; no admitted Entity/runtime behavior is demonstrated.','Structured application attributes round-trip through pinned profile values; only declared RDF fields are RDF-queryable.','The trusted fixture manifest simulates committed immutable object versions; this is not a production commit/recovery implementation.','No live migration or application integration has been performed.'],liveDataTouched:false};
await fs.writeFile(path.join(root,'validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
