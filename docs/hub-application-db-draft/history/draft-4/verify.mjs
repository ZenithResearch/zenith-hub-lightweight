/** Draft contract checks. Reads/writes synthetic review fixtures only; never opens a live Hub DB. */
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';import addFormats from 'ajv-formats';
import {inspectUnit,unitKey,projectedValue} from './rdf-contract.mjs';
import {probePublisher} from './probe-helpers.mjs';
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
const relations=await read(path.join(root,'application-relations.jsonld'));
const declaredPredicates=new Set(relations['@graph'].filter(n=>n['@type']==='owl:ObjectProperty').map(n=>n['@id'].replace('app:',relations['@context'].app)));
for(const m of Object.values(ownership.records))for(const rule of Object.values(m.fields))if(rule.owner==='rdf'&&rule.predicate?.startsWith(relations['@context'].app)&&!declaredPredicates.has(rule.predicate))fail('undeclared_application_predicate');
const referencePolicy=await read(path.join(root,'reference-policy.json'));if(hash(await bytes(path.join(root,'reference-policy.json')))!==trust.referencePolicySha256)fail('trusted_reference_policy_changed');
const pins=new Map(trust.definitionPins.map(p=>[p.kind+'|'+p.id,p])),commits=new Map(trust.committedObjectVersions.map(v=>[key(v.id,v.objectRevision),v]));
const unitCommits=new Map(trust.committedAtomicUnits.map(v=>[unitKey(v),v]));
async function stored(ref){
 const file=path.resolve(storage,ref.storageKey),actual=await fs.realpath(file);if(!actual.startsWith(storage+path.sep))fail('unsafe_storage_key');
 if((await fs.lstat(file)).isSymbolicLink())fail('unsafe_storage_key');
 const data=await bytes(actual),digest=hash(data);if(digest!==ref.artifact.sha256||data.length!==ref.artifact.byteLength)fail('stored_file_integrity_mismatch');
 if(ref.artifact.id!=='urn:sha256:'+digest)fail('representation_identity_mismatch');
 return JSON.parse(data.toString('utf8'));
}
const mappingSets=new Map(),profileMappings=new Map();
for(const pin of pins.values())if(pin.kind==='field-mapping'){const map=await stored(pin.file);mappingSets.set(pin.id,{sha256:pin.file.artifact.sha256,records:Object.entries(map.records)});for(const [name,m]of Object.entries(map.records))profileMappings.set(m.projection,{name,m});}
const profilesFor={hosts:'Host',softwareDescriptors:'SoftwareDescriptor',sourceSnapshots:'SoftwareSourceSnapshot',builds:'SoftwareBuild',installations:'SoftwareInstallationRecord',services:'ServiceInstance'};
const definitionKey=d=>d.kind+'|'+d.id;
async function verify(snapshot,{readObject=stored,committedVersions=commits,committedAtomicUnits=unitCommits}={}) {
 if(snapshot?.objectRecords?.some(o=>o?.admission==='infrastructure'))fail('draft_admission_not_supported');
 if(!validate(snapshot))fail('snapshot_schema_invalid');
 const metadataGroups=new Set(['objectRecords','selectedObjects','referenceBindings','rdfUnits','selectedUnits']);
 const records=new Map([[snapshot.hub.id,snapshot.hub]]),ids=new Set(records.keys());
 for(const [group,rows]of Object.entries(snapshot))if(Array.isArray(rows)&&!metadataGroups.has(group))for(const row of rows){if(ids.has(row.id))fail('duplicate_record_identity');ids.add(row.id);records.set(row.id,row);}
 const objects=new Map(),loaded=new Map(),units=new Map();
 for(const u of snapshot.rdfUnits){const k=unitKey(u);if(units.has(k))fail('duplicate_rdf_unit');const committed=committedAtomicUnits.get(k);if(!committed||!equal(u,committed))fail('untrusted_unit_commit');
  if(u.jsonldFile.artifact.mediaType!=='application/ld+json')fail('wrong_media_type');
  const interpreted=await inspectUnit(await readObject(u.jsonldFile),registry);
  if(!equal([...u.members].sort(),interpreted.members)||u.semanticSha256!==interpreted.semanticSha256)fail('rdf_unit_commit_integrity');for(const node of interpreted.nodes){for(const type of node['@type']||[])if(!registry.types.has(type))fail('unrecognized_ontology_type');registry.validateNode(node,'observation');}units.set(k,{...u,...interpreted});
 }
 const membershipByLineage=new Map();for(const u of units.values()){const prior=membershipByLineage.get(u.id);if(prior&&!equal(prior,u.members))fail('unit_membership_change_requires_new_identity');membershipByLineage.set(u.id,u.members);}
 for(const o of snapshot.objectRecords){const k=key(o.id,o.objectRevision);if(objects.has(k))fail('duplicate_object_version');objects.set(k,o);}
 for(const [k,o]of objects){
  const committed=committedVersions.get(k);if(!committed)fail('uncommitted_object_version');
  if(!equal(committed.atomicUnit,o.atomicUnit))fail('atomic_commit_mismatch');
  if(!equal(committed.mappingRef,o.mappingRef)||committed.admission!==o.admission||committed.jsonldSha256!==o.jsonldFile.artifact.sha256||committed.bindingsSha256!==o.bindingsFile.artifact.sha256)fail('committed_version_mismatch');
  if(o.jsonldFile.artifact.mediaType!=='application/ld+json'||o.bindingsFile.artifact.mediaType!=='application/json')fail('wrong_media_type');
  const file=await readObject(o.bindingsFile);if(!validateBindings(file)||file.objectId!==o.id||file.objectRevision!==o.objectRevision||!equal(file.atomicUnit,o.atomicUnit))fail('profile_revision_mismatch');
  const entry=await inspectUnit(await readObject(o.jsonldFile),registry),unit=units.get(unitKey(o.atomicUnit));
  if(!unit||!unit.members.includes(o.id)||unit.semanticSha256!==entry.semanticSha256||!equal(unit.members,entry.members))fail('object_unit_integrity');
  const node=entry.nodes.find(n=>n['@id']===o.id);if(!node||!equal([...(node['@type']||[])].sort(),[...o.types].sort()))fail('jsonld_identity_or_type_mismatch');
  for(const t of o.types)if(!registry.types.has(t))fail('unrecognized_ontology_type');
  registry.validateNode(node,o.admission);registry.validateProjections(o.id,o.types,file.bindings,o.admission);
  const required=new Set(['json-schema|'+schema.$id+'#/$defs/ProfileBindingsFile']);
  for(const type of o.types)for(const id of registry.moduleGraph.closure(registry.moduleGraph.owners.get(type))){required.add('ontology-module|'+id);required.add('package-manifest|'+registry.moduleGraph.modules.get(id).package);}
  for(const p of registry.profiles.values())if(p.representation==='expanded-node'&&registry.matches(p,o.types)&&(!p.admissionOnly||p.admissionOnly===o.admission))required.add('json-schema|'+p.id);
  for(const b of file.bindings)required.add('json-schema|'+b.profile);
  if(file.bindings.length)required.add('json-schema|https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/core.schema.json#/$defs/ArtifactRef');
  const mapping=o.mappingRef&&mappingSets.get(o.mappingRef.id);
  if(o.mappingRef&&(!mapping||o.mappingRef.sha256!==mapping.sha256))fail('untrusted_field_mapping');
  const views=new Map();
  for(const binding of file.bindings){
   const recognized=profileMappings.get(binding.profile);if(!recognized)continue; // Other registered profiles retain their own schema/identity validation.
   if(!mapping||!mapping.records.some(([name,m])=>m.projection===binding.profile))fail('missing_versioned_field_mapping');
   const [name,m]=mapping.records.find(([name,m])=>m.projection===binding.profile);
   required.add('field-mapping|'+o.mappingRef.id);required.add('ontology-module|urn:zenith:hub:application-relations:draft:4');
   const expected=projectedValue(entry,m,binding,o.types,o.id);
   if(!equal(binding.value,expected))fail('rdf_profile_drift');
   views.set(name,{value:expected,mapping:m,profile:binding.profile});
  }
  const seen=new Set();for(const d of o.definitions){const dk=definitionKey(d);if(seen.has(dk))fail('duplicate_definition_reference');seen.add(dk);if(!pins.has(dk)||!equal(d,pins.get(dk)))fail('untrusted_definition_pin');await readObject(d.file);}
  for(const requiredKey of required)if(!seen.has(requiredKey))fail('missing_required_definition');
  loaded.set(k,{...entry,file,views,node,object:o});
 }
 // Completeness includes every named subject, not just typed subjects; referenced-only IRIs are not members.
 for(const unit of units.values())for(const id of unit.members)if(![...objects.values()].some(o=>o.id===id&&equal(o.atomicUnit,{id:unit.id,revision:unit.revision})))fail('incomplete_unit_members');
 const selected=new Map(),selectedUnits=new Map();
 for(const u of snapshot.selectedUnits){if(selectedUnits.has(u.id))fail(selectedUnits.get(u.id)===u.revision?'duplicate_current_unit':'mixed_atomic_unit_versions');if(!units.has(unitKey(u)))fail('missing_selected_unit');selectedUnits.set(u.id,u.revision);}
 for(const v of snapshot.selectedObjects){if(selected.has(v.objectId))fail('duplicate_current_selection');const k=key(v.objectId,v.objectRevision),o=objects.get(k);if(!o)fail('missing_selected_object_version');selected.set(v.objectId,k);
  if(selectedUnits.get(o.atomicUnit.id)!==o.atomicUnit.revision)fail('mixed_atomic_unit_versions');
 }
 for(const [id,revision]of selectedUnits)for(const member of units.get(unitKey({id,revision})).members){const current=objects.get(selected.get(member));if(!current||!equal(current.atomicUnit,{id,revision}))fail('incomplete_current_unit');}
 for(const [group,rows]of Object.entries(snapshot))if(profilesFor[group]||group==='profiles')for(const row of rows){
  const name=group==='profiles'?(row.profileKind==='hermes'?'HermesConfigurationProfile':'ConfigurationProfile'):profilesFor[group],m=ownership.records[name],v=row.objectVersion;
  if(v.objectId!==row.id||v.profileId!==m.projection)fail('wrong_view_binding');const entry=loaded.get(key(v.objectId,v.objectRevision));if(!entry)fail('missing_committed_object_version');
  if(!entry.object.types.some(t=>registry.moduleGraph.isSubclassOf(t,m.appliesTo)))fail('record_ontology_type_mismatch');
  if(selected.get(row.id)!==key(v.objectId,v.objectRevision))fail('view_snapshot_revision_mismatch');
  const view=entry.views.get(name);if(!view)fail('missing_projection_value');const actual={types:entry.object.types};
  for(const [field,rule]of Object.entries(m.fields))if(rule.owner!=='operational'&&Object.hasOwn(row,field))actual[field]=row[field];
  if(!equal(actual,view.value))fail('application_projection_drift');if(!equal(JSON.parse(stable(view.value)),actual))fail('profile_view_round_trip_failed');
 }
 const declarations=new Map(),used=new Set(),refKey=(kind,id,revision,field,target)=>stable([kind,id,revision,field,target]);
 for(const b of snapshot.referenceBindings){const k=refKey(b.ownerKind,b.ownerRef,b.ownerRevision,b.field,b.targetRef);if(declarations.has(k))fail('duplicate_reference_binding');
  if(b.ownerKind==='object'?!objects.has(key(b.ownerRef,b.ownerRevision)):records.get(b.ownerRef)?.revision!==b.ownerRevision)fail('reference_binding_owner_missing');declarations.set(k,b);
 }
 const Z='https://zenith-research.ca/ontology/terms/';
 const subclass=(o,type)=>!type||o.types.some(t=>registry.moduleGraph.isSubclassOf(t,type));
 function resolve(kind,owner,revision,field,id,type,{distinct=false,profile,defaultMode='current'}={}){
  if(distinct&&owner===id)fail('self_configuration_reference');const dk=refKey(kind,owner,revision,field,id),binding=declarations.get(dk);if(binding)used.add(dk);const mode=binding?.mode||defaultMode;
  const current=loaded.get(selected.get(id)),known=current||[...loaded.values()].filter(v=>v.object.id===id).sort((a,b)=>b.object.objectRevision-a.object.objectRevision)[0];
  if(mode==='external') {if(known&&!subclass(known.object,type))fail('typed_reference_type_mismatch');return {mode,unresolved:true};}
  const target=mode==='object-version'?loaded.get(key(id,binding.objectRevision)):current;
  if(!target){if(mode==='object-version')fail('reference_version_missing');if(mode==='current'&&records.has(id)&&!type&&!profile)return {mode,value:records.get(id)};if(known)fail('typed_reference_not_current');fail('unresolved_typed_reference');}
  if(!subclass(target.object,type))fail('typed_reference_type_mismatch');
  const view=profile&&target.views.get(profile);if(profile&&!view)fail('reference_profile_mismatch');return {mode,value:view?.value||target.node,target};
 }
 function objectReference(entry,field,id,type,options={}) {
  const current=selected.get(entry.object.id)===key(entry.object.id,entry.object.objectRevision),dk=refKey('object',entry.object.id,entry.object.objectRevision,field,id);
  // An archived object's unpinned outgoing cross-object link is unresolved; it never acquires today's target implicitly.
  if(!current&&!declarations.has(dk))return {unresolved:true,historical:true};
  if(!current&&declarations.get(dk)?.mode==='current')fail('historical_reference_requires_version');
  return resolve('object',entry.object.id,entry.object.objectRevision,field,id,type,options);
 }
 const sameSoftware=(v,target)=>{if(target.value?.softwareRef&&v.softwareRef!==target.value.softwareRef)fail('software_reference_mismatch');};
 for(const entry of loaded.values())for(const [name,{value:v}]of entry.views){
  const ref=(field,type,opts)=>v[field]&&objectReference(entry,'/'+field,v[field],type,opts);
  if(v.softwareRef)ref('softwareRef',Z+'Artifact',{profile:'SoftwareDescriptor'});
  if(v.sourceSnapshotRef)sameSoftware(v,ref('sourceSnapshotRef',Z+'Artifact',{profile:'SoftwareSourceSnapshot'}));
  if(v.buildRef){const b=ref('buildRef',Z+'Artifact',{profile:'SoftwareBuild'});sameSoftware(v,b);if(v.sourceSnapshotRef&&b.value&&b.value.sourceSnapshotRef!==v.sourceSnapshotRef)fail('installation_provenance_mismatch');}
  if(v.hostRef)ref('hostRef',ownership.records.Host.appliesTo,{profile:'Host'});
  if(v.installationRef)sameSoftware(v,ref('installationRef',Z+'Artifact',{profile:'SoftwareInstallationRecord'}));
  if(v.profileRef){const p=objectReference(entry,'/profileRef',v.profileRef,Z+'Artifact');if(p.target){const pv=p.target.views.get('HermesConfigurationProfile')||p.target.views.get('ConfigurationProfile');if(!pv)fail('reference_profile_mismatch');sameSoftware(v,{value:pv.value});if(v.installationRef&&pv.value.installationRef&&v.installationRef!==pv.value.installationRef)fail('profile_installation_mismatch');}}
  if(v.configArtifactRef)ref('configArtifactRef',Z+'Artifact',{distinct:true});
  for(const id of v.hostRefs||[])objectReference(entry,'/hostRefs',id,ownership.records.Host.appliesTo);
  if(v.content)objectReference(entry,'/content',v.content.id,Z+'Artifact');
  if(name==='HermesConfigurationProfile'){const s=ref('softwareRef',Z+'Artifact',{profile:'SoftwareDescriptor'});if(s.value&&s.value.key!=='hermes')fail('hermes_profile_software_mismatch');if(v.modelBinding?.serverConnectionRef&&selected.get(v.id)===key(v.id,entry.object.objectRevision)&&!snapshot.connections.some(c=>c.id===v.modelBinding.serverConnectionRef))fail('reference_integrity');}
 }
 // Application-owned bookkeeping references have purpose-specific selectors; no any-loaded-history fallback.
 for(const i of snapshot.installations)for(const id of i.receiptRefs||[])resolve('application',i.id,i.revision,'/receiptRefs',id,Z+'Receipt');
 for(const op of snapshot.operations){for(const id of op.targetRefs)resolve('application',op.id,op.revision,'/targetRefs',id);if(op.planArtifactRef)resolve('application',op.id,op.revision,'/planArtifactRef',op.planArtifactRef,Z+'Artifact');for(const id of op.receiptRefs||[])resolve('application',op.id,op.revision,'/receiptRefs',id,Z+'Receipt');}
 for(const [group,rows]of Object.entries(snapshot))if(Array.isArray(rows)&&!metadataGroups.has(group))for(const row of rows)for(const facet of ['presence','compatibility','runtime'])for(const id of row[facet]?.evidenceRefs||[])resolve('application',row.id,row.revision,'/'+facet+'/evidenceRefs',id,Z+'Artifact');
 for(const c of snapshot.connections){const contract=referencePolicy.adapters[c.adapterRef];if(c.enabled&&!contract)fail('unsupported_connection_adapter');const r=resolve('application',c.id,c.revision,'/targetRef',c.targetRef,contract?.targetType,{defaultMode:c.targetScope==='external-unresolved'?'external':'current'});if(c.enabled&&c.targetScope==='local'&&r.mode!=='current')fail('active_connection_requires_current');}
 const currentView=(id,name)=>{const e=loaded.get(selected.get(id)),v=e?.views.get(name);if(!v)fail('reference_integrity');return v.value;};
 if(snapshot.hub.localHostRef)currentView(snapshot.hub.localHostRef,'Host');if(snapshot.hub.selectedGuideProfileRef)currentView(snapshot.hub.selectedGuideProfileRef,'HermesConfigurationProfile');
 const softwareKeys=new Set();for(const s of [...selected.values()].map(k=>loaded.get(k).views.get('SoftwareDescriptor')?.value).filter(Boolean)){if(softwareKeys.has(s.key))fail('duplicate_software_key');softwareKeys.add(s.key);}
 const catalogKeys=new Set();for(const e of snapshot.catalogEntries){currentView(e.softwareRef,'SoftwareDescriptor');const k=e.catalogId+'|'+e.key;if(catalogKeys.has(k))fail('duplicate_catalog_key');catalogKeys.add(k);}
 for(const s of snapshot.services)if(s.management==='external'&&s.desiredState!=='unmanaged')fail('external_service_requires_unmanaged');
 for(const k of declarations.keys())if(!used.has(k))fail('unused_reference_binding');
 return {objectVersions:objects.size,rdfUnits:units.size,typedViews:Object.keys(profilesFor).reduce((n,k)=>n+snapshot[k].length,0)+snapshot.profiles.length};
}
function actionPreconditions(snapshot,operation) {
 const reasons=[];if(operation.state!=='reviewed')reasons.push('operation_not_reviewed');
 for(const id of operation.targetRefs){const expected=operation.expectedTargets?.find(v=>v.id===id),selected=snapshot.selectedObjects.find(v=>v.objectId===id),app=[snapshot.hub,...Object.entries(snapshot).filter(([k,v])=>Array.isArray(v)&&!['objectRecords','selectedObjects','rdfUnits','selectedUnits','referenceBindings'].includes(k)).flatMap(([,v])=>v)].find(v=>v.id===id);
  if(!expected)reasons.push('expected_revision_required');else if(expected.kind==='object'?selected?.objectRevision!==expected.revision:app?.revision!==expected.revision)reasons.push('operation_precondition_stale');
  if(snapshot.referenceBindings.some(b=>b.ownerKind==='application'&&b.ownerRef===operation.id&&b.ownerRevision===operation.revision&&b.field==='/targetRefs'&&b.targetRef===id&&b.mode!=='current'))reasons.push('operation_target_not_current');
 }
 return {eligible:!reasons.length,reasons:[...new Set(reasons)]};
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
await rejects('unresolved local connection targets are rejected',remote,s=>{s.connections[0].targetScope='local';},'unresolved_typed_reference');
const operational=structuredClone(base);operational.installations[0].presence.state='unknown';operational.installations[0].presence.reason='Inspection failed';operational.installations[0].revision++;await passes('inspection-owned operational state changes without changing semantic object version',operational);
// Independent probes commit consistent synthetic versions in RAM, so projection mismatch cannot mask reference failures.
async function probe(name,fixture,mutate,expected){
 const snapshot=structuredClone(fixture),publisher=probePublisher({snapshot,commits,unitCommits,ownership,stored,registry});await mutate(snapshot,publisher);
 try{await verify(snapshot,publisher);}catch(e){if(expected===e.message){checks.push({name,passed:true});return;}throw Error(name+': expected '+expected+', got '+e.message);}
 if(expected)fail('accepted_invalid_fixture: '+name);checks.push({name,passed:true});
}
const Z='https://zenith-research.ca/ontology/terms/';
await rejects('infrastructure admission is explicitly unsupported',base,s=>{s.objectRecords[0].admission='infrastructure';},'draft_admission_not_supported');
await probe('profile cannot identify itself as separate configuration content',configured,async(s,p)=>{s.profiles[0].configArtifactRef=s.profiles[0].id;await p.publish(s.profiles[0],'HermesConfigurationProfile');},'self_configuration_reference');
await probe('configuration content cannot resolve to a Machine',configured,async(s,p)=>{s.profiles[0].configArtifactRef=s.hosts[0].id;await p.publish(s.profiles[0],'HermesConfigurationProfile');},'typed_reference_type_mismatch');
await probe('missing local configuration content is rejected',configured,async(s,p)=>{s.profiles[0].configArtifactRef='urn:example:missing-config';await p.publish(s.profiles[0],'HermesConfigurationProfile');},'unresolved_typed_reference');
await probe('explicit external configuration content remains unresolved without invented type',configured,async(s,p)=>{s.profiles[0].configArtifactRef='urn:example:external-config';await p.publish(s.profiles[0],'HermesConfigurationProfile');p.reference(s.profiles[0],'/configArtifactRef',s.profiles[0].configArtifactRef,{mode:'external'});});
await probe('general stored Artifact can supply separate configuration content',configured,async(s,p)=>{const id='urn:example:config-content';await p.extra(id,Z+'Artifact');s.profiles[0].configArtifactRef=id;await p.publish(s.profiles[0],'HermesConfigurationProfile');});
const operation=s=>({id:'urn:example:operation:review',revision:1,action:'review',targetRefs:[s.installations[0].id],state:'complete',createdAt:'2026-11-22T19:00:00Z',updatedAt:'2026-11-22T19:00:00Z'});
await probe('missing operation plan is rejected',base,async s=>{s.operations.push({...operation(s),planArtifactRef:'urn:example:missing-plan'});},'unresolved_typed_reference');
await probe('Machine cannot be used as an operation receipt',base,async s=>{s.operations.push({...operation(s),receiptRefs:[s.hosts[0].id]});},'typed_reference_type_mismatch');
await probe('missing installation receipts are rejected',base,async s=>{s.installations[0].receiptRefs=['urn:example:missing-receipt'];},'unresolved_typed_reference');
await probe('missing observation evidence is rejected',base,async s=>{s.installations[0].presence.evidenceRefs=['urn:example:missing-evidence'];},'unresolved_typed_reference');
await probe('known Machine cannot escape type checks through an external declaration',base,async s=>{s.installations[0].presence.evidenceRefs=[s.hosts[0].id];s.referenceBindings.push({ownerKind:'application',ownerRef:s.installations[0].id,ownerRevision:s.installations[0].revision,field:'/presence/evidenceRefs',targetRef:s.hosts[0].id,mode:'external'});},'typed_reference_type_mismatch');
await probe('general stored Receipt can acknowledge an installation',base,async(s,p)=>{const id='urn:example:receipt:installed';await p.extra(id,Z+'Receipt');s.installations[0].receiptRefs=[id];});
await probe('stored source Artifact can support inspection evidence',base,async s=>{s.installations[0].presence.evidenceRefs=[s.sourceSnapshots[0].id];});
await probe('external evidence requires an exact field declaration',base,async s=>{const id='urn:example:external-evidence';s.installations[0].presence.evidenceRefs=[id];s.referenceBindings.push({ownerKind:'application',ownerRef:s.installations[0].id,ownerRevision:s.installations[0].revision,field:'/presence/evidenceRefs',targetRef:id,mode:'external'});});
await probe('incompatible source and build cannot describe one installed version',configured,async(s,p)=>{const other={...s.sourceSnapshots[0],id:'urn:example:source:other',commit:'b'.repeat(40)};delete other.objectVersion;s.sourceSnapshots.push(other);await p.publish(other,'SoftwareSourceSnapshot');s.builds[0].sourceSnapshotRef=other.id;await p.publish(s.builds[0],'SoftwareBuild');s.installations[0].buildRef=s.builds[0].id;await p.publish(s.installations[0],'SoftwareInstallationRecord');},'installation_provenance_mismatch');
await probe('matching source and build describe one installed version',configured,async(s,p)=>{s.installations[0].buildRef=s.builds[0].id;await p.publish(s.installations[0],'SoftwareInstallationRecord');});
async function sharedUnit(s,p){
 const host=s.hosts[0],descriptor=s.softwareDescriptors[0],unitId='urn:example:unit:shared-host-descriptor';
 for(const [revision,suffix]of [[2,'old'],[3,'new']]){
  host.label='Host '+suffix;descriptor.label='Software '+suffix;
  const graph={'@graph':[{'@id':host.id,'@type':[ownership.records.Host.appliesTo],'http://www.w3.org/2000/01/rdf-schema#label':[{'@value':host.label}],'urn:example:shared-detail':[{'@id':'_:detail'}]},{'@id':descriptor.id,'@type':[ownership.records.SoftwareDescriptor.appliesTo],'http://www.w3.org/2000/01/rdf-schema#label':[{'@value':descriptor.label}],'urn:example:shared-detail':[{'@id':'_:detail'}]},{'@id':'_:detail','urn:example:detail':[{'@value':suffix}]}]};
  const atomicUnit={id:unitId,revision:revision-1};await p.publish(host,'Host',{revision,atomicUnit,document:graph});await p.publish(descriptor,'SoftwareDescriptor',{revision,atomicUnit,document:graph});
 }
}
await probe('complete shared atomic-unit version is a valid current snapshot',base,sharedUnit);
await probe('historical peer cannot justify mixed current atomic-unit versions',base,async(s,p)=>{await sharedUnit(s,p);const d=s.softwareDescriptors[0];d.label='Software old';d.objectVersion.objectRevision=2;p.select(d.id,2);},'mixed_atomic_unit_versions');
await probe('an application row cannot silently select a historical peer',base,async(s,p)=>{await sharedUnit(s,p);s.softwareDescriptors[0].label='Software old';s.softwareDescriptors[0].objectVersion.objectRevision=2;},'view_snapshot_revision_mismatch');
// Draft-4 independent counterexamples and positive controls.
await probe('valid selected object does not require a dedicated app row',base,async s=>{s.hosts=[];});
async function driftStoredHost(s,p,{withoutRow=false,historical=false}={}) {
 const row=s.hosts[0],old=s.objectRecords.find(o=>o.id===row.id);
 if(historical){row.label='New current host';await p.publish(row,'Host');}
 const bindings=await p.readObject(old.bindingsFile);bindings.bindings[0].value.label='Disagrees with RDF';await p.rewrite(old,{bindings});if(withoutRow)s.hosts=[];
}
await probe('stored profile/RDF disagreement fails with an app row',base,(s,p)=>driftStoredHost(s,p),'rdf_profile_drift');
await probe('stored profile/RDF disagreement fails without an app row',base,(s,p)=>driftStoredHost(s,p,{withoutRow:true}),'rdf_profile_drift');
await probe('historical object profile/RDF disagreement also fails',base,(s,p)=>driftStoredHost(s,p,{historical:true}),'rdf_profile_drift');
await probe('generic Artifact without any Hub profile remains valid',base,async(s,p)=>{await p.extra('urn:example:generic',Z+'Artifact');});
await probe('untyped stored subject without a Hub profile remains valid',base,async(s,p)=>{await p.extra('urn:example:untyped');});
await probe('anonymous RDF unit has storage without an invented object identity',base,async(s,p)=>{await p.anonymous({'@id':'_:only','urn:example:value':[{'@value':'anonymous'}]});});
await probe('contradictory RDF documents cannot claim one trusted unit version',base,async(s,p)=>{const o=s.objectRecords[0],document=await p.readObject(o.jsonldFile);document['http://www.w3.org/2000/01/rdf-schema#label'][0]['@value']='Contradictory unit contents';await p.rewrite(o,{document});},'object_unit_integrity');
await probe('incomplete shared unit membership fails even if peers have no app rows',base,async(s,p)=>{await sharedUnit(s,p);const d=s.softwareDescriptors[0];s.softwareDescriptors=[];s.objectRecords=s.objectRecords.filter(o=>o.id!==d.id);s.selectedObjects=s.selectedObjects.filter(o=>o.objectId!==d.id);},'incomplete_unit_members');
await probe('equivalent JSON-LD serialization is accepted by RDF digest',base,async(s,p)=>{const o=s.objectRecords[0],document={'@context':{label:'http://www.w3.org/2000/01/rdf-schema#label'},'@type':o.types[0],'@id':o.id,label:s.hosts[0].label};await p.rewrite(o,{document});});
await probe('binding-only change advances object version but preserves RDF unit',base,async(s,p)=>{const row=s.hosts[0],before=s.objectRecords[0].atomicUnit;row.kind='virtual';const after=await p.publish(row,'Host');if(!equal(before,after.atomicUnit))throw Error('binding_only_changed_unit');});
function retireSelection(s,id){s.selectedObjects=s.selectedObjects.filter(v=>v.objectId!==id);const active=new Set(s.selectedObjects.map(v=>unitKey(s.objectRecords.find(o=>o.id===v.objectId&&o.objectRevision===v.objectRevision).atomicUnit)));s.selectedUnits=s.selectedUnits.filter(u=>active.has(unitKey(u)));}
await probe('retained receipt can resolve an exact unselected historical version',base,async(s,p)=>{const receipt=await p.extra('urn:example:receipt:history',Z+'Receipt');retireSelection(s,receipt.id);const op={...operation(s),receiptRefs:[receipt.id]};s.operations.push(op);p.reference(op,'/receiptRefs',receipt.id,{revision:1});});
await probe('missing exact historical version has an explicit version error',base,async(s,p)=>{const receipt=await p.extra('urn:example:receipt:missing-version',Z+'Receipt'),op={...operation(s),receiptRefs:[receipt.id]};s.operations.push(op);p.reference(op,'/receiptRefs',receipt.id,{revision:2});},'reference_version_missing');
await probe('completed journal can retain an exact historical target',base,async(s,p)=>{const target=await p.extra('urn:example:old-target',Z+'Artifact');retireSelection(s,target.id);const op={...operation(s),targetRefs:[target.id]};s.operations.push(op);p.reference(op,'/targetRefs',target.id,{revision:1});});
await probe('journal does not implicitly resolve any loaded historical object',base,async(s,p)=>{const target=await p.extra('urn:example:old-target',Z+'Artifact');retireSelection(s,target.id);s.operations.push({...operation(s),targetRefs:[target.id]});},'typed_reference_not_current');
await probe('enabled local connection cannot resolve unselected history',configured,async(s,p)=>{const id=s.services[0].id;retireSelection(s,id);s.services=[];s.connections.push({id:'urn:example:stale-connection',revision:1,label:'Retained',targetRef:id,targetScope:'local',adapterRef:'hermes',endpoint:'http://127.0.0.1:65221',enabled:true});},'typed_reference_not_current');
await probe('disabled connection may retain an exact historical service',configured,async(s,p)=>{const id=s.services[0].id;retireSelection(s,id);s.services=[];const c={id:'urn:example:stale-connection',revision:1,label:'Retained',targetRef:id,targetScope:'local',adapterRef:'hermes',endpoint:'http://127.0.0.1:65221',enabled:false};s.connections.push(c);p.reference(c,'/targetRef',id,{revision:1});});
await probe('enabling a historical connection requires fresh current binding',configured,async(s,p)=>{const id=s.services[0].id,c={id:'urn:example:stale-connection',revision:1,label:'Retained',targetRef:id,targetScope:'local',adapterRef:'hermes',endpoint:'http://127.0.0.1:65221',enabled:true};s.connections.push(c);p.reference(c,'/targetRef',id,{revision:1});},'active_connection_requires_current');
await probe('retained reviewed plan with stale expected revision is not eligible to apply',base,async s=>{const op={...operation(s),state:'reviewed',expectedTargets:[{id:s.installations[0].id,kind:'object',revision:0}]};s.operations.push(op);if(actionPreconditions(s,op).eligible)throw Error('stale_apply_accepted');});
await probe('current reviewed target with matching revision is eligible for later action guards',base,async s=>{const op={...operation(s),state:'reviewed',expectedTargets:[{id:s.installations[0].id,kind:'object',revision:1}]};s.operations.push(op);if(!actionPreconditions(s,op).eligible)throw Error('matching_apply_rejected');});
await probe('untyped named peers sharing a blank node require stored membership',base,async(s,p)=>{
 const host=s.hosts[0],id='urn:example:untyped-peer',atomicUnit={id:'urn:example:unit:typed-untyped',revision:1},document={'@graph':[{'@id':host.id,'@type':[ownership.records.Host.appliesTo],'http://www.w3.org/2000/01/rdf-schema#label':[{'@value':host.label}],'urn:example:detail':[{'@id':'_:shared'}]},{'@id':id,'urn:example:detail':[{'@id':'_:shared'}]},{'@id':'_:shared','urn:example:value':[{'@value':'retained'}]}]};
 await p.publish(host,'Host',{atomicUnit,document});await p.extra(id,undefined,{atomicUnit,document});
});
await probe('referenced-only IRI is not an atomic unit member',base,async(s,p)=>{const host=s.hosts[0],document={'@id':host.id,'@type':[ownership.records.Host.appliesTo],'http://www.w3.org/2000/01/rdf-schema#label':[{'@value':host.label}],'urn:example:unresolved-link':[{'@id':'urn:example:referenced-only'}]};await p.publish(host,'Host',{document});});
await probe('unknown ontology type on a blank subject is rejected',base,async(s,p)=>{await p.anonymous({'@id':'_:only','@type':'urn:example:unknown-class','urn:example:value':[{'@value':'anonymous'}]});},'unrecognized_ontology_type');
const installationObject=base.objectRecords.find(o=>o.id===base.installations[0].id),installationLD=await stored(installationObject.jsonldFile),APP='https://zenith-research.ca/ontology/hub/application-draft/terms/';
if(installationLD[APP+'describesSoftware']?.[0]?.['@id']!==base.installations[0].softwareRef||installationLD[APP+'installationHost']?.[0]?.['@id']!==base.installations[0].hostRef||installationLD[APP+'sourceSnapshot']?.[0]?.['@id']!==base.installations[0].sourceSnapshotRef)fail('semantic_links_missing_from_rdf');
checks.push({name:'installation software, host and source links exist in RDF, not only sidecars',passed:true});
const report={status:'draft-4-contract-fixture-checks',...counts,checks,limitations:['Infrastructure admission is explicitly unsupported and rejected; existing production registry validation is unchanged.','Declared semantic relationships are RDF-queryable; implementation and structured profile fields remain separate versioned bindings.','The trusted fixture manifest simulates committed immutable object versions; this is not a production commit/recovery implementation.','No live migration or application integration has been performed.'],liveDataTouched:false};
await fs.writeFile(path.join(root,'validation.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
