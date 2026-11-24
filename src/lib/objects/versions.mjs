/** Validate stored versions independently of application projections. No path/definition choice comes from data. */
import {inspectUnit,unitKey,projectedValue,stable} from './rdf-unit.mjs';
import {validateInspectionRecords,validatePresenceOverlays} from './inspections.mjs';
import {validateProvenance} from './provenance.mjs';
import {reject} from './registry.mjs';
export function createVersionValidator(definitions,pinReferences) {
 const {registry,schema,ownership,referencePolicy,validateSnapshot:validate,validateBindings}=definitions;
 const relationsId=JSON.parse(definitions.assets.get('application-relations.jsonld'))['@graph'].find(n=>n['@type']==='owl:Ontology')['@id'];
 const fail=code=>reject(code,422),equal=(a,b)=>stable(a)===stable(b),key=(id,revision)=>id+'|'+revision;
 const pins=new Map(pinReferences.map(p=>[p.kind+'|'+p.id,p]));
 const mappingSets=new Map([[ownership.id,{sha256:pins.get('field-mapping|'+ownership.id).file.artifact.sha256,records:Object.entries(ownership.records)}]]);
 const ext=definitions.extensions;if(ext)mappingSets.set(ext.ownership.id,{sha256:pins.get('field-mapping|'+ext.ownership.id).file.artifact.sha256,records:Object.entries(ext.ownership.records)});
 const profileMappings=new Map(Object.entries(ownership.records).map(([name,m])=>[m.projection,{name,m}]));
 if(ext)for(const name of ext.ownership.extensionRoles){const m=ext.ownership.records[name];profileMappings.set(m.projection,{name,m});}
 const profilesFor={hosts:'Host',softwareDescriptors:'SoftwareDescriptor',sourceSnapshots:'SoftwareSourceSnapshot',builds:'SoftwareBuild',installations:'SoftwareInstallationRecord',services:'ServiceInstance'};
 const definitionKey=d=>d.kind+'|'+d.id;
return async function verify(snapshot,{readObject,committedVersions,committedAtomicUnits}) {
 if(snapshot?.objectRecords?.some(o=>o?.admission!=='observation'&&(!o?.legacyReadOnly||!o?.legacyOrigin)))fail('draft_admission_not_supported');
 if(!validate(snapshot))fail('snapshot_schema_invalid');
 const metadataGroups=new Set(['objectRecords','selectedObjects','referenceBindings','rdfUnits','selectedUnits','inspectionRecords']);
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
  if(!equal(committed.legacyOrigin,o.legacyOrigin)||!!committed.legacyReadOnly!==!!o.legacyReadOnly)fail('committed_version_mismatch');
  if(!equal(committed.definitions,o.definitions))fail('committed_definition_mismatch');
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
   required.add('field-mapping|'+o.mappingRef.id);required.add('ontology-module|'+(ext?.ownership.extensionRoles.includes(name)?ext.ownership.relationsId:relationsId));if(ext?.ownership.extensionRoles.includes(name))for(const resource of ext.resources.values())if(resource.kind==='package-manifest')required.add('package-manifest|'+resource.id);
   const expected=projectedValue(entry,m,binding,o.types,o.id);
   if(!equal({...binding.value,types:[...binding.value.types].sort()},{...expected,types:[...expected.types].sort()}))fail('rdf_profile_drift');
   views.set(name,{value:expected,mapping:m,profile:binding.profile});
  }
  const seen=new Set();for(const d of o.definitions){const dk=definitionKey(d);if(seen.has(dk))fail('duplicate_definition_reference');seen.add(dk);if(!pins.has(dk)||!equal(d,pins.get(dk)))fail('untrusted_definition_pin');await readObject(d.file);}
  for(const requiredKey of required)if(!seen.has(requiredKey))fail('missing_required_definition');
  if(views.has('CatalogSoftwareMetadata')){const meta=views.get('CatalogSoftwareMetadata').value,descriptor=views.get('SoftwareDescriptor')?.value;if(!descriptor||['key','publisher','repository'].some(f=>meta[f]!==descriptor[f]))fail('catalog_descriptor_drift');}
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
  if(!current&&declarations.get(dk)?.mode==='current'){used.add(dk);return {unresolved:true,historical:true};}
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
 validateProvenance([...loaded.values()].map(e=>({id:e.object.id,objectRevision:e.object.objectRevision,views:e.views})),snapshot.referenceBindings,fail);
 validateInspectionRecords(snapshot.inspectionRecords,[...loaded.values()].map(e=>({id:e.object.id,objectRevision:e.object.objectRevision,views:e.views})),fail,snapshot.referenceBindings);
 validatePresenceOverlays(snapshot,fail);
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
 return {entries:loaded,selected,unitCanonical:new Map([...units].map(([k,u])=>[k,u.canonical])),objectVersions:objects.size,rdfUnits:units.size,typedViews:Object.keys(profilesFor).reduce((n,k)=>n+snapshot[k].length,0)+snapshot.profiles.length};
};
}
