/** Snapshot assembly uses a single SQLite read transaction; files remain immutable after pointers are captured. */
import {readApplicationRows,recordGroups} from './application-rows.mjs';
import {reject} from './registry.mjs';
export function snapshotFrom({objects,units,selectedObjects,selectedUnits,rows,referenceBindings,inspections,generation},definitions,settingsId) {
  const settings=rows.filter(r=>r.kind==='HubSettings');if(settings.length>1)reject('hub_settings_singleton',422);
  const snapshot={schema:definitions.schema.properties.schema.const,snapshotMode:'current',hub:settings[0]?.value||{id:settingsId,revision:1,label:'Hub'},hosts:[],softwareDescriptors:[],catalogEntries:[],sourceSnapshots:[],builds:[],installations:[],profiles:[],services:[],connections:[],operations:[],objectRecords:objects.map(({definitionSetId,...o})=>o),rdfUnits:units,selectedObjects,selectedUnits,referenceBindings,inspectionRecords:inspections};
  const untyped={SoftwareCatalogEntry:'catalogEntries',Connection:'connections',SetupOperation:'operations'};
  for(const {kind,value}of rows){const group=recordGroups[kind]||untyped[kind];if(group)snapshot[group].push(value);}
  return snapshot;
}
export function captureState(db,pins) {
  db.exec('BEGIN');try {
    const state=db.prepare('SELECT * FROM hub_store_state WHERE singleton=1').get(),files=new Map(db.prepare('SELECT * FROM hub_files').all().map(r=>[r.sha256,r]));
    const file=sha=>{const row=files.get(sha);if(!row)reject('repository_integrity_failure',503);return {storageKey:row.storage_key,artifact:{id:'urn:sha256:'+sha,sha256:sha,byteLength:row.byte_length,mediaType:row.media_type}};};
    const objects=db.prepare('SELECT * FROM hub_object_versions ORDER BY object_id,object_revision').all().map(o=>({id:o.object_id,objectRevision:o.object_revision,types:db.prepare('SELECT type_iri FROM hub_object_type_history WHERE object_id=? AND object_revision=? ORDER BY type_iri').all(o.object_id,o.object_revision).map(t=>t.type_iri),atomicUnit:{id:o.unit_id,revision:o.unit_revision},admission:o.admission,...(o.legacy_read_only?{legacyReadOnly:true}:{}),jsonldFile:file(o.jsonld_sha256),bindingsFile:file(o.bindings_sha256),definitions:pins,...(o.mapping_id?{mappingRef:{id:o.mapping_id,sha256:o.mapping_sha256}}:{}),definitionSetId:o.definition_set_id}));
    const units=db.prepare('SELECT * FROM hub_rdf_unit_versions ORDER BY unit_id,unit_revision').all().map(u=>({id:u.unit_id,revision:u.unit_revision,semanticSha256:u.semantic_sha256,jsonldFile:file(u.jsonld_sha256),members:db.prepare('SELECT object_id FROM hub_rdf_unit_members WHERE unit_id=? AND unit_revision=? ORDER BY object_id').all(u.unit_id,u.unit_revision).map(r=>r.object_id)}));
    const documents=db.prepare('SELECT v.* FROM hub_application_documents h JOIN hub_application_document_versions v ON v.document_key=h.document_key AND v.revision=h.revision').all().map(r=>({key:r.document_key,revision:r.revision,kind:r.kind,value:JSON.parse(r.value_json),sha256:r.sha256}));
    const rows=readApplicationRows(db),applicationVersions=new Set(rows.map(r=>r.value.id+'|'+r.value.revision));
    const referenceBindings=db.prepare('SELECT * FROM hub_reference_bindings').all().filter(b=>b.owner_kind==='object'||applicationVersions.has(b.owner_id+'|'+b.owner_revision)).map(b=>({ownerKind:b.owner_kind,ownerRef:b.owner_id,ownerRevision:b.owner_revision,field:b.field,targetRef:b.target_id,mode:b.mode,...(b.target_revision!==null?{objectRevision:b.target_revision}:{})}));
    const associations=new Map(db.prepare('SELECT * FROM hub_inspection_associations').all().map(r=>[r.inspection_id,{objectId:r.installation_id,objectRevision:r.object_revision}]));
    const inspections=db.prepare('SELECT * FROM hub_inspections ORDER BY observed_at,id').all().map(r=>({proof:JSON.parse(r.proof_json),...(associations.has(r.id)?{association:associations.get(r.id)}:{})}));
    const commits=db.prepare('SELECT * FROM hub_commits ORDER BY generation').all().map(r=>({...r,result:JSON.parse(r.result_json)}));
    for(const o of objects){const original=commits.flatMap(c=>c.result.manifest.objects).find(v=>v.id===o.id&&v.objectRevision===o.objectRevision);if(original?.legacyOrigin)o.legacyOrigin=original.legacyOrigin;if(original?.definitions)o.definitions=original.definitions;}
    const result={generation:state.generation,repositoryId:state.repository_id,objects,units,selectedObjects:db.prepare('SELECT object_id AS objectId,object_revision AS objectRevision FROM hub_current_objects ORDER BY object_id').all(),selectedUnits:db.prepare('SELECT unit_id AS id,unit_revision AS revision FROM hub_current_units ORDER BY unit_id').all(),rows,referenceBindings,inspections,commits,documents};
    db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}
}
