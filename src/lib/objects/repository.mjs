/** Opt-in single durable writer. Existing v2 databases are read-only until a separately reviewed migration. */
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import rdf from 'rdf-canonize';
import {loadApplicationDefinitions} from './application.mjs';
import {Representations,privateDatabaseFile} from './representations.mjs';
import {createVersionValidator} from './versions.mjs';
import {inspectUnit,unitKey} from './rdf-unit.mjs';
import {inspectionAuthority,presenceFromProof} from './inspections.mjs';
import {captureState,snapshotFrom} from './repository-state.mjs';
import {persistApplicationRow,recordGroups} from './application-rows.mjs';
import {readModel} from './read-model.mjs';
import {ObjectStore} from './store.mjs';
import {exportBundle,importBundle,validateBundle,stableJSON} from './bundle.mjs';
import {processDataset} from './codec.mjs';
import {sha256,reject,absoluteIRI,closed} from './registry.mjs';
const APP_ID=0x5a484f42,key=(id,revision)=>id+'|'+revision;
const normalize=kind=>kind==='HermesConfigurationProfile'?'ConfigurationProfile':kind;
export class HubRepository {
  #db;#definitions;#representations;#pins;#encodedDefinitions;#validate;#queue=Promise.resolve();#authority;#closed=false;#migrationPermit=null;#extensionPins=[];#extensionEncoded=[];
  static async open(options){const definitions=await loadApplicationDefinitions(options);const repo=new HubRepository(options,definitions);try{await repo.#open(options);return repo;}catch(e){await repo.close();throw e;}}
  constructor({dataDir,clock=Date.now,fault=()=>{}},definitions){this.dataDir=dataDir;this.clock=clock;this.fault=fault;this.#definitions=definitions;this.registry=definitions.registry;this.mode='foundation';}
  async #open({inspectSoftware,inspectionAdapterDigest,inspectionHostRef,monotonic,bootId}) {
    const file=await privateDatabaseFile(this.dataDir);let db=new DatabaseSync(file,{timeout:2000,allowExtension:false,readOnly:true});this.#db=db;
    const version=db.prepare('PRAGMA user_version').get().user_version,application=db.prepare('PRAGMA application_id').get().application_id,tables=db.prepare("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
    if(version===2&&application===APP_ID){db.close();this.#db=null;this.legacy=new ObjectStore({dataDir:this.dataDir,registry:this.registry,readOnly:true});this.mode='legacy-read-only';return;}
    if(application!==APP_ID&&(application!==0||tables.length)||![0,5].includes(version))reject('repository_migration_required',409);
    db.close();db=new DatabaseSync(file,{timeout:2000,allowExtension:false});this.#db=db;
    this.#representations=new Representations(this.dataDir,{fault:this.fault});await this.#representations.initialize();
    this.#encodedDefinitions=[];this.#pins=[];
    for(const resource of this.#definitions.resources.values()){const e=this.#representations.encodeBytes(resource.bytes,'definitions',resource.kind==='ontology-module'?'jsonld':'json');this.#encodedDefinitions.push(e);this.#pins.push({kind:resource.kind,id:resource.id,file:e.ref});}
    const definitionManifest={applicationManifestSha256:this.#definitions.manifestSha256,pins:this.#pins},manifest=this.#representations.encode(definitionManifest,'definitions');this.#encodedDefinitions.push(manifest);this.definitionSetId='urn:zenith:hub:definition-set:'+manifest.ref.artifact.sha256;
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON;');
    if(version===0){if(tables.length)reject('repository_migration_required',409);await this.#representations.publish(this.#encodedDefinitions);
      db.exec('BEGIN IMMEDIATE');try{const nowVersion=db.prepare('PRAGMA user_version').get().user_version;if(nowVersion!==0)reject('repository_initialization_race',409);
        for(const name of ['003-revision-ledger.sql','004-application-projections.sql','005-application-state.sql']){const sql=this.#definitions.assets.get(name).toString('utf8').replace(/^(?:BEGIN IMMEDIATE;|COMMIT;|PRAGMA user_version=.*;|PRAGMA foreign_keys=ON;)\s*$/gm,'');db.exec(sql);db.prepare('INSERT INTO hub_schema_migrations VALUES(?,?,?)').run(Number(name.slice(0,3)),sha256(this.#definitions.assets.get(name)),new Date(this.clock()).toISOString());}
        db.prepare('INSERT INTO hub_store_state VALUES(1,?,0,?)').run('urn:zenith:hub:repository:'+randomUUID(),'repository');this.#insertFiles(this.#encodedDefinitions);db.prepare('INSERT INTO hub_definition_sets VALUES(?,?)').run(this.definitionSetId,manifest.ref.artifact.sha256);
        for(const p of this.#pins)db.prepare('INSERT INTO hub_definition_pins VALUES(?,?,?,?)').run(this.definitionSetId,p.kind,p.id,p.file.artifact.sha256);
        db.exec('PRAGMA application_id='+APP_ID+'; PRAGMA user_version=5; COMMIT');
      }catch(e){db.exec('ROLLBACK');throw e;}
    }
    const actual=db.prepare('SELECT manifest_sha256 FROM hub_definition_sets WHERE id=?').get(this.definitionSetId);if(actual?.manifest_sha256!==manifest.ref.artifact.sha256)reject('definition_migration_required',503);
    for(const resource of this.#definitions.extensions?.resources.values()||[]){const e=this.#representations.encodeBytes(resource.bytes,'definitions',resource.kind==='ontology-module'?'jsonld':'json');this.#extensionEncoded.push(e);this.#extensionPins.push({kind:resource.kind,id:resource.id,file:e.ref});}
    await this.#representations.read(manifest.ref);this.settingsId=db.prepare('SELECT repository_id FROM hub_store_state').get().repository_id+'/settings';this.#validate=createVersionValidator(this.#definitions,[...this.#pins,...this.#extensionPins]);
    this.configureInspection({inspectSoftware,inspectionAdapterDigest,inspectionHostRef,monotonic,bootId});
    await this.#read();
  }
  configureInspection({inspectSoftware,inspectionAdapterDigest,inspectionHostRef,monotonic,bootId}) {
    this.#authority=inspectionAuthority({lookup:async(id,role,revision)=>{const {validation,snapshot}=await this.#read();const e=validation.entries.get(revision?key(id,revision):validation.selected.get(id)),v=e?.views.get(role);if(!v)reject('inspection_version_mismatch',422);return {version:{objectId:id,objectRevision:e.object.objectRevision},value:v.value,referenceBindings:snapshot.referenceBindings.filter(b=>b.ownerKind==='object'&&b.ownerRef===id&&b.ownerRevision===e.object.objectRevision)};},inspectSoftware,adapterDigest:inspectionAdapterDigest,localHostRef:inspectionHostRef,validateProof:this.#definitions.ajv.compile({$ref:this.#definitions.schema.$id+'#/$defs/InspectionProof'}),clock:this.clock,monotonic,bootId});this.inspections=this.#authority.facade;
  }
  #insertFiles(encoded){for(const e of encoded)this.#db.prepare('INSERT OR IGNORE INTO hub_files VALUES(?,?,?,?)').run(e.ref.artifact.sha256,e.ref.storageKey,e.ref.artifact.byteLength,e.ref.artifact.mediaType);}
  #assertWrite(){if(this.#closed)reject('repository_closed',503);if(this.mode!=='foundation')reject('repository_migration_required',409);}
  #state(){return captureState(this.#db,this.#pins);}
  #trusted(state) {
    const objects=new Map(),units=new Map(),inspections=new Map(),references=new Map(),documents=new Map();
    for(const commit of state.commits){const manifest=commit.result.manifest;
      for(const o of manifest.objects)objects.set(key(o.id,o.objectRevision),{...o,jsonldSha256:o.jsonldFile.artifact.sha256,bindingsSha256:o.bindingsFile.artifact.sha256});
      for(const u of manifest.units)units.set(unitKey(u),u);
      for(const r of manifest.inspections)inspections.set(r.proof.id,sha256(stableJSON(r)));
      for(const d of manifest.documents||[])documents.set(d.key,sha256(stableJSON(d)));
      for(const r of manifest.referenceBindings)references.set(stableJSON([r.ownerKind,r.ownerRef,r.ownerRevision,r.field,r.targetRef]),stableJSON(r));
    }
    return {objects,units,inspections,references,documents,selection:state.commits.at(-1)?.result.manifest.selection||{objects:[],units:[]}};
  }
  async #validateState(state,encoded=[]) {
    for(const o of state.objects)if(o.definitionSetId&&o.definitionSetId!==this.definitionSetId)reject('definition_migration_required',503);
    const readCache=new Map(),pending=new Map(encoded.map(e=>[e.ref.storageKey,e])),trusted=this.#trusted(state),snapshot=snapshotFrom(state,this.#definitions,this.settingsId);
    if(trusted.objects.size!==state.objects.length||trusted.units.size!==state.units.length||trusted.inspections.size!==state.inspections.length)reject('repository_commit_incomplete',503);
    const ordered=(values,id)=>[...values].sort((a,b)=>a[id].localeCompare(b[id]));if(stableJSON(ordered(trusted.selection.objects,'objectId'))!==stableJSON(ordered(state.selectedObjects,'objectId'))||stableJSON(ordered(trusted.selection.units,'id'))!==stableJSON(ordered(state.selectedUnits,'id')))reject('selection_commit_mismatch',503);
    if(trusted.documents.size!==state.documents.length)reject('application_document_integrity',503);for(const d of state.documents){if(trusted.documents.get(d.key)!==sha256(stableJSON(d))||d.sha256!==sha256(stableJSON(d.value)))reject('application_document_integrity',503);}
    for(const r of state.inspections)if(trusted.inspections.get(r.proof.id)!==sha256(stableJSON(r)))reject('inspection_commit_mismatch',503);
    for(const r of state.referenceBindings)if(trusted.references.get(stableJSON([r.ownerKind,r.ownerRef,r.ownerRevision,r.field,r.targetRef]))!==stableJSON(r))reject('reference_commit_mismatch',503);
    const readObject=async ref=>{const cacheKey=stableJSON(ref);if(!readCache.has(cacheKey))readCache.set(cacheKey,(async()=>{const p=pending.get(ref.storageKey);if(p){if(stableJSON(p.ref)!==stableJSON(ref))reject('representation_integrity_mismatch',422);return JSON.parse(p.bytes);}return this.#representations.read(ref);})());return readCache.get(cacheKey);};
    const validation=await this.#validate(snapshot,{readObject,committedVersions:trusted.objects,committedAtomicUnits:trusted.units});return {snapshot,validation};
  }
  async #read(){if(this.#closed)reject('repository_closed',503);const state=this.#state();return {...await this.#validateState(state),state};}
  generation(){return this.legacy?null:this.#db.prepare('SELECT generation FROM hub_store_state').get().generation;}
  async readSnapshot(){if(this.legacy)reject('repository_migration_required',409);const {snapshot,state}=await this.#read();return {generation:state.generation,snapshot};}
  commitBatch(batch){return this.#serialize(()=>this.#execute(batch));}
  #serialize(fn){const result=this.#queue.then(fn);this.#queue=result.catch(()=>{});return result;}
  #replay(id,digest,operation=false){const old=this.#db.prepare('SELECT * FROM hub_commits WHERE idempotency_key=?').get(id);if(!old)return null;if(old.request_sha256!==digest)reject('idempotency_conflict',409);const saved=JSON.parse(old.result_json);return {...(operation?saved.operation:saved.result),replayed:true};}
  async #execute(input,{digest=sha256(stableJSON(input)),operation=null,migrationPermit=null}={}) {
    this.#assertWrite();if(!this.#definitions.validateBatch(input))reject('invalid_repository_batch',422,{errors:this.#definitions.validateBatch.errors.map(e=>({path:e.instancePath,keyword:e.keyword,message:e.message})).slice(-20)});if(Buffer.byteLength(stableJSON(input))>8*1024**2)reject('invalid_repository_batch',422);
    const replay=this.#replay(input.idempotencyKey,digest,!!operation);if(replay)return replay;
    for(const write of input.inspectionWrites)this.#authority.authorize(write);
    const migrating=migrationPermit!==null&&migrationPermit===this.#migrationPermit;
    if(!migrating&&input.objectWrites.some(o=>o.admission!=='observation'||o.legacyReadOnly||o.legacyOrigin))reject('foundation_admission_unsupported',422);
    const batch=structuredClone(input),state=this.#state();if(state.generation!==batch.expectedGeneration)reject('stale_generation',409);if(batch.definitionSetId!==this.definitionSetId)reject('definition_untrusted',422);
    const encoded=[],preparedUnits=[],preparedObjects=[],objectWrites=new Map(),unitWrites=new Set(),oldSelected=new Map(state.selectedObjects.map(v=>[v.objectId,v.objectRevision])),unitHeads=new Map(state.selectedUnits.map(v=>[v.id,v.revision]));
    const objectRecords=new Map(state.objects.map(o=>[key(o.id,o.objectRevision),o])),retired=new Set();
    for(const u of batch.retireUnits){if(retired.has(u.id)||unitHeads.get(u.id)!==u.revision)reject('stale_unit_revision',409);retired.add(u.id);}
    for(const u of batch.unitWrites){if(unitWrites.has(u.id))reject('duplicate_unit_write',422);unitWrites.add(u.id);const expected=unitHeads.get(u.id)||0;if(expected!==u.expectedRevision||u.revision!==expected+1)reject('stale_unit_revision',409);if(!expected&&state.units.some(v=>v.id===u.id))reject('unit_identity_exists',409);
      const info=await inspectUnit(u.document,this.registry);if(stableJSON([...u.members].sort())!==stableJSON(info.members))reject('unit_incomplete',422);const prior=state.units.find(v=>v.id===u.id&&v.revision===expected);if(prior&&(stableJSON(prior.members)!==stableJSON(info.members)||prior.semanticSha256===info.semanticSha256))reject('invalid_unit_revision',422);
      const e=this.#representations.encode(u.document,'objects','jsonld');encoded.push(e);preparedUnits.push({id:u.id,revision:u.revision,members:info.members,semanticSha256:info.semanticSha256,jsonldFile:e.ref,canonical:info.canonical});
    }
    const futureUnits=[...state.units,...preparedUnits.map(({canonical,...u})=>u)];
    for(const o of batch.objectWrites){if(objectWrites.has(o.id))reject('duplicate_object_write',422);const expected=oldSelected.get(o.id)||0;if(expected!==o.expectedRevision||o.objectRevision!==(migrating&&!expected?o.legacyOrigin?.sourceRevision:expected+1))reject('stale_object_revision',409);if(!expected&&state.objects.some(v=>v.id===o.id))reject('object_identity_exists',409);if(o.definitionSetId!==this.definitionSetId)reject('definition_untrusted',422);if(expected&&objectRecords.get(key(o.id,expected)).legacyReadOnly)reject('legacy_read_only',409);objectWrites.set(o.id,o);
      const unit=futureUnits.find(u=>u.id===o.atomicUnit.id&&u.revision===o.atomicUnit.revision);if(!unit||!unit.members.includes(o.id))reject('unit_incomplete',422);
      const e=this.#representations.encode(o.bindings,'bindings');encoded.push(e);const ext=this.#definitions.extensions,extended=o.bindings.bindings.some(b=>ext?.ownership.extensionRoles.some(role=>ext.ownership.records[role].projection===b.profile)),owner=extended?ext.ownership:this.#definitions.ownership,refs=extended?[...this.#pins,...this.#extensionPins]:this.#pins,recognized=o.bindings.bindings.some(b=>Object.values(owner.records).some(m=>m.projection===b.profile)),mappingRef=o.mappingRef||(recognized?{id:owner.id,sha256:refs.find(p=>p.kind==='field-mapping'&&p.id===owner.id).file.artifact.sha256}:undefined);if(extended)for(const file of this.#extensionEncoded)if(!encoded.some(e=>e.ref.storageKey===file.ref.storageKey))encoded.push(file);
      preparedObjects.push({id:o.id,objectRevision:o.objectRevision,atomicUnit:o.atomicUnit,admission:o.admission,types:o.types,...(o.legacyReadOnly?{legacyReadOnly:true}:{}),...(o.legacyOrigin?{legacyOrigin:o.legacyOrigin}:{}),jsonldFile:unit.jsonldFile,bindingsFile:e.ref,definitions:refs,...(mappingRef?{mappingRef}:{}),definitionSetId:this.definitionSetId});
    }
    for(const u of preparedUnits)for(const id of u.members){const o=objectWrites.get(id);if(!o||o.atomicUnit.id!==u.id||o.atomicUnit.revision!==u.revision)reject('unit_incomplete',422);}
    for(const id of retired)for(const member of state.units.find(u=>u.id===id&&u.revision===unitHeads.get(id)).members)if(!objectWrites.has(member))reject('connected_update_requires_complete_unit',409);
    const next=structuredClone(state);next.objects.push(...preparedObjects);next.units.push(...preparedUnits.map(({canonical,...u})=>u));next.selectedUnits=next.selectedUnits.filter(u=>!retired.has(u.id)&&!unitWrites.has(u.id));next.selectedUnits.push(...preparedUnits.map(({id,revision})=>({id,revision})));
    next.selectedObjects=next.selectedObjects.filter(o=>!objectWrites.has(o.objectId));next.selectedObjects.push(...preparedObjects.map(o=>({objectId:o.id,objectRevision:o.objectRevision})));
    const documentWrites=[],documentKeys=new Set();for(const d of batch.documentWrites||[]){if(documentKeys.has(d.key))reject('duplicate_application_document',422);documentKeys.add(d.key);const prior=state.documents.find(v=>v.key===d.key);if(d.expectedRevision!==(prior?.revision||0)||d.revision!==d.expectedRevision+1)reject('stale_document_revision',409);documentWrites.push({key:d.key,kind:d.kind,revision:d.revision,value:d.value,sha256:sha256(stableJSON(d.value))});}
    next.documents=next.documents.filter(d=>!documentKeys.has(d.key));next.documents.push(...documentWrites);
    const appWrites=[],appKeys=new Set(),priorRows=new Map(state.rows.map(r=>[normalize(r.kind)+'|'+r.value.id,r]));
    for(const write of batch.appWrites){const k=normalize(write.kind)+'|'+write.value.id;if(appKeys.has(k))reject('duplicate_record_identity',422);appKeys.add(k);const previous=priorRows.get(k);if((previous?.value.revision||0)!==write.expectedRevision||write.value.revision!==write.expectedRevision+1)reject('stale_record_revision',409);appWrites.push(write);}
    for(const row of state.rows)if(recordGroups[row.kind]&&objectWrites.has(row.value.id)&&!appKeys.has(normalize(row.kind)+'|'+row.value.id)){
      const object=objectWrites.get(row.value.id),profileId=row.value.objectVersion.profileId,binding=object.bindings.bindings.find(b=>b.profile===profileId);if(!binding)reject('application_profile_required',422);const value={...row.value,...binding.value};delete value.types;value.revision++;value.objectVersion={objectId:object.id,objectRevision:object.objectRevision,profileId};
      if(row.kind==='SoftwareInstallationRecord')value.presence={state:'unknown',observedAt:new Date(this.clock()).toISOString(),method:'repository',reason:'Installation object revision changed; inspect this revision.'};appWrites.push({kind:row.kind,expectedRevision:row.value.revision,value});appKeys.add(normalize(row.kind)+'|'+row.value.id);
    }
    for(const record of batch.inspectionWrites){const proof=record.proof,existing=next.inspections.find(r=>r.proof.id===proof.id);if(existing){if(stableJSON(existing.proof)!==stableJSON(proof)||existing.association&&stableJSON(existing.association)!==stableJSON(record.association))reject('inspection_identity_conflict',409);if(record.association)existing.association=record.association;}else next.inspections.push(record);
      if(record.association){const ref=record.association;if(proof.subject.kind==='candidate'&&(objectWrites.get(ref.objectId)?.expectedRevision!==0||objectWrites.get(ref.objectId)?.objectRevision!==ref.objectRevision))reject('registration_requires_new_description',422);
        const target=preparedObjects.find(o=>o.id===ref.objectId&&o.objectRevision===ref.objectRevision)||objectRecords.get(key(ref.objectId,ref.objectRevision));if(!target)reject('inspection_version_mismatch',422);
        let row=appWrites.find(r=>r.kind==='SoftwareInstallationRecord'&&r.value.id===ref.objectId);if(!row){const old=priorRows.get('SoftwareInstallationRecord|'+ref.objectId);if(old){row={kind:old.kind,expectedRevision:old.value.revision,value:{...structuredClone(old.value),revision:old.value.revision+1}};appWrites.push(row);appKeys.add('SoftwareInstallationRecord|'+ref.objectId);}}
        if(row){const expected=presenceFromProof(proof);if(batch.appWrites.includes(row)&&stableJSON(row.value.presence)!==stableJSON(expected))reject('presence_evidence_mismatch',422);row.value.presence=expected;}
      }
    }
    next.rows=next.rows.filter(r=>!appKeys.has(normalize(r.kind)+'|'+r.value.id));next.rows.push(...appWrites.map(({kind,value})=>({kind,value})));
    for(const b of batch.referenceBindings)if(b.ownerKind==='object'?!objectWrites.has(b.ownerRef)||objectWrites.get(b.ownerRef).objectRevision!==b.ownerRevision:!appWrites.some(w=>w.value.id===b.ownerRef&&w.value.revision===b.ownerRevision))reject('reference_owner_not_written',422);
    const liveAppOwners=new Set(next.rows.map(r=>r.value.id+'|'+r.value.revision));next.referenceBindings=next.referenceBindings.filter(b=>b.ownerKind==='object'||liveAppOwners.has(b.ownerRef+'|'+b.ownerRevision));next.referenceBindings.push(...batch.referenceBindings);
    const commitId='urn:zenith:hub:commit:'+randomUUID(),result={commitId,generation:state.generation+1,objectVersions:preparedObjects.map(o=>({objectId:o.id,objectRevision:o.objectRevision})),recordRevisions:appWrites.map(w=>({kind:w.kind,id:w.value.id,revision:w.value.revision})),replayed:false};
    const manifest={objects:preparedObjects,units:preparedUnits.map(({canonical,...u})=>u),inspections:batch.inspectionWrites,documents:documentWrites,referenceBindings:batch.referenceBindings,selection:{objects:next.selectedObjects,units:next.selectedUnits}},saved={result,operation,manifest};next.commits.push({result:saved});
    await this.#validateState(next,encoded);await this.#representations.publish(encoded);await this.fault('before-database');
    this.#db.exec('BEGIN IMMEDIATE');let committed=false;
    try{const again=this.#replay(batch.idempotencyKey,digest,!!operation);if(again){this.#db.exec('ROLLBACK');return again;}if(this.generation()!==batch.expectedGeneration)reject('stale_generation',409);for(const write of input.inspectionWrites)this.#authority.authorize(write);
      this.#db.prepare('INSERT INTO hub_commits VALUES(?,?,?,?,?,?)').run(commitId,batch.idempotencyKey,digest,result.generation,JSON.stringify(saved),new Date(this.clock()).toISOString());this.#insertFiles(encoded);
      for(const o of preparedObjects)this.#db.prepare('INSERT OR IGNORE INTO hub_object_identities VALUES(?)').run(o.id);
      for(const u of preparedUnits){this.#db.prepare('INSERT INTO hub_rdf_unit_versions VALUES(?,?,?,?,?,?)').run(u.id,u.revision,u.semanticSha256,u.jsonldFile.artifact.sha256,u.canonical,commitId);for(const id of u.members)this.#db.prepare('INSERT INTO hub_rdf_unit_members VALUES(?,?,?)').run(u.id,u.revision,id);this.#indexUnit(u,u.canonical);}
      for(const o of preparedObjects){this.#db.prepare('INSERT INTO hub_object_versions(object_id,object_revision,unit_id,unit_revision,jsonld_sha256,bindings_sha256,definition_set_id,admission,legacy_read_only,mapping_id,mapping_sha256,commit_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(o.id,o.objectRevision,o.atomicUnit.id,o.atomicUnit.revision,o.jsonldFile.artifact.sha256,o.bindingsFile.artifact.sha256,this.definitionSetId,o.admission,Number(!!o.legacyReadOnly),o.mappingRef?.id||null,o.mappingRef?.sha256||null,commitId);for(const type of o.types)this.#db.prepare('INSERT INTO hub_object_type_history VALUES(?,?,?)').run(o.id,o.objectRevision,type);for(const binding of objectWrites.get(o.id).bindings.bindings)this.#db.prepare('INSERT INTO hub_profile_values VALUES(?,?,?,?)').run(o.id,o.objectRevision,binding.profile,JSON.stringify(binding.value));}
      for(const o of preparedObjects)this.#db.prepare('DELETE FROM hub_projections WHERE object_id=?').run(o.id);
      for(const id of retired)this.#db.prepare('DELETE FROM hub_current_units WHERE unit_id=?').run(id);
      for(const u of preparedUnits)this.#db.prepare('INSERT INTO hub_current_units VALUES(?,?) ON CONFLICT(unit_id) DO UPDATE SET unit_revision=excluded.unit_revision').run(u.id,u.revision);
      for(const o of preparedObjects)this.#db.prepare('INSERT INTO hub_current_objects VALUES(?,?,?,?) ON CONFLICT(object_id) DO UPDATE SET object_revision=excluded.object_revision,unit_id=excluded.unit_id,unit_revision=excluded.unit_revision').run(o.id,o.objectRevision,o.atomicUnit.id,o.atomicUnit.revision);
      this.#persistInspections(batch.inspectionWrites,commitId);
      for(const d of documentWrites){this.#db.prepare('INSERT INTO hub_application_document_versions VALUES(?,?,?,?,?,?)').run(d.key,d.revision,d.kind,JSON.stringify(d.value),d.sha256,commitId);this.#db.prepare('INSERT INTO hub_application_documents VALUES(?,?) ON CONFLICT(document_key) DO UPDATE SET revision=excluded.revision').run(d.key,d.revision);}
      for(const row of appWrites)persistApplicationRow(this.#db,row,this.#definitions.ownership);
      for(const b of batch.referenceBindings)this.#db.prepare('INSERT INTO hub_reference_bindings VALUES(?,?,?,?,?,?,?)').run(b.ownerKind,b.ownerRef,b.ownerRevision,b.field,b.targetRef,b.mode,b.objectRevision??null);
      this.#db.exec('DELETE FROM hub_software_keys');for(const o of next.selectedObjects){const entry=next.objects.find(v=>v.id===o.objectId&&v.objectRevision===o.objectRevision),write=objectWrites.get(o.objectId);const bindings=write?.bindings.bindings||this.#db.prepare('SELECT value_json,profile_id FROM hub_profile_values WHERE object_id=? AND object_revision=?').all(o.objectId,o.objectRevision).map(r=>({profile:r.profile_id,value:JSON.parse(r.value_json)}));const descriptor=bindings.find(b=>b.profile===this.#definitions.ownership.records.SoftwareDescriptor.projection);if(descriptor)this.#db.prepare('INSERT INTO hub_software_keys VALUES(?,?)').run(descriptor.value.key,entry.id);}
      this.#db.prepare('UPDATE hub_store_state SET generation=? WHERE singleton=1').run(result.generation);this.#trip('database-write');if(this.#db.prepare('PRAGMA foreign_key_check').all().length)reject('repository_integrity_failure',503);this.#db.exec('COMMIT');committed=true;
      await this.fault('database-commit');await this.fault('acknowledgement');return operation||result;
    }catch(e){if(!committed)this.#db.exec('ROLLBACK');throw e;}
  }
  #indexUnit(unit,canonical) {
    const scope='u'+sha256(unitKey(unit))+'_',spelling=t=>t.termType==='BlankNode'?'_:'+scope+t.value:t.value;
    for(const q of rdf.NQuads.parse(canonical))if(q.object.termType!=='Literal')this.#db.prepare('INSERT OR IGNORE INTO hub_rdf_links VALUES(?,?,?,?,?,?)').run(unit.id,unit.revision,spelling(q.subject),q.predicate.value,spelling(q.object),spelling(q.graph));
  }
  rebuildIndexes(){return this.#serialize(async()=>{
    this.#assertWrite();const state=this.#state(),trusted=this.#trusted(state);
    // Reconstruct cache types from the committed manifest, then verify authoritative files independently.
    for(const o of state.objects){const original=trusted.objects.get(key(o.id,o.objectRevision));if(!original)reject('repository_integrity_failure',503);o.types=original.types;}
    const {validation}=await this.#validateState(state);
    this.#db.exec('BEGIN IMMEDIATE');try{
      if(this.generation()!==state.generation)reject('stale_generation',409);
      this.#db.exec('DELETE FROM hub_projections; DELETE FROM hub_profile_values; DELETE FROM hub_object_type_history; DELETE FROM hub_rdf_links; DELETE FROM hub_software_keys;');
      for(const e of validation.entries.values()){
        for(const type of e.object.types)this.#db.prepare('INSERT INTO hub_object_type_history VALUES(?,?,?)').run(e.object.id,e.object.objectRevision,type);
        for(const binding of e.file.bindings)this.#db.prepare('INSERT INTO hub_profile_values VALUES(?,?,?,?)').run(e.object.id,e.object.objectRevision,binding.profile,JSON.stringify(binding.value));
        if(validation.selected.get(e.object.id)===key(e.object.id,e.object.objectRevision)){const descriptor=e.views.get('SoftwareDescriptor');if(descriptor)this.#db.prepare('INSERT INTO hub_software_keys VALUES(?,?)').run(descriptor.value.key,e.object.id);}
      }
      for(const u of state.units){const canonical=validation.unitCanonical.get(unitKey(u));this.#indexUnit(u,canonical);this.#db.prepare('UPDATE hub_rdf_unit_versions SET canonical_nquads=? WHERE unit_id=? AND unit_revision=?').run(canonical,u.id,u.revision);}
      for(const row of state.rows)persistApplicationRow(this.#db,row,this.#definitions.ownership);
      if(this.#db.prepare('PRAGMA foreign_key_check').all().length)reject('repository_integrity_failure',503);
      this.#db.exec('COMMIT');return {rebuilt:true,generation:state.generation};
    }catch(e){this.#db.exec('ROLLBACK');throw e;}
  });}
  #trip(point){const result=this.fault(point);if(result?.then)reject('asynchronous_transaction_hook',500);}
  #persistInspections(records,commitId){for(const {proof:p,association}of records){const columns={id:p.id,software_id:p.softwareVersion.objectId,software_revision:p.softwareVersion.objectRevision,host_id:p.hostVersion.objectId,host_revision:p.hostVersion.objectRevision,source_id:p.sourceVersion?.objectId||null,source_revision:p.sourceVersion?.objectRevision||null,build_id:p.buildVersion?.objectId||null,build_revision:p.buildVersion?.objectRevision||null,subject_kind:p.subject.kind,candidate_id:p.subject.candidateId||null,copy_identity:p.subject.copyIdentity||null,inspected_installation_id:p.subject.installationVersion?.objectId||null,inspected_installation_revision:p.subject.installationVersion?.objectRevision||null,fingerprint_sha256:p.fingerprint.sha256||null,scope_key:p.scope.key,scope_complete:Number(p.scope.complete),observed_at:p.observedAt,valid_until:p.validUntil,boot_id:p.bootId,adapter_digest:p.adapterDigest,state:p.state,reasons_json:JSON.stringify(p.reasons),proof_json:JSON.stringify(p),proof_sha256:sha256(stableJSON(p)),commit_id:commitId};this.#db.prepare('INSERT OR IGNORE INTO hub_inspections('+Object.keys(columns).join(',')+') VALUES('+Object.keys(columns).map(()=>'?').join(',')+')').run(...Object.values(columns));if(association)this.#db.prepare('INSERT OR IGNORE INTO hub_inspection_associations VALUES(?,?,?,?)').run(p.id,association.objectId,association.objectRevision,commitId);}}
  async ingestLegacy({bundle,records,units,sourceFingerprint}) {
    return this.#serialize(async()=>{
      this.#assertWrite();if(this.generation()!==0)reject('migration_target_not_empty',409);
      if(!/^[a-f0-9]{64}$/.test(sourceFingerprint))reject('invalid_migration_source',422);
      await validateBundle(this.registry,bundle);
      const interpreted=await processDataset('interpret',{document:bundle.dataset},this.registry),all=new Set(interpreted.fragments.flatMap(f=>f.ids));
      if(stableJSON([...all].sort())!==stableJSON(records.map(r=>r.id).sort()))reject('migration_membership_mismatch',422);
      const b={schema:this.#definitions.commitSchema.properties.schema.const,idempotencyKey:'legacy-'+sourceFingerprint,expectedGeneration:0,definitionSetId:this.definitionSetId,unitWrites:[],retireUnits:[],objectWrites:[],appWrites:[],referenceBindings:[],inspectionWrites:[]};
      for(const unit of units){const atomicUnit={id:unit.id,revision:1},info=await inspectUnit(unit.document,this.registry);b.unitWrites.push({...atomicUnit,expectedRevision:0,members:info.members,document:unit.document});
        for(const id of info.members){const r=records.find(v=>v.id===id);if(!r||!Number.isSafeInteger(r.revision)||r.revision<1)reject('invalid_migration_source',422);
          const node=info.nodes.find(n=>n['@id']===id),admission=bundle.admissions[id],legacyOrigin={sourceFingerprint,sourceRevision:r.revision,...(r.sourceImportKey?{sourceImportKey:r.sourceImportKey,sourceProvenance:r.sourceProvenance||{}}:{})};
          b.objectWrites.push({id,expectedRevision:0,objectRevision:r.revision,atomicUnit,types:node['@type']||[],admission,...(admission!=='observation'?{legacyReadOnly:true}:{}),legacyOrigin,definitionSetId:this.definitionSetId,bindings:{schema:this.#definitions.schema.$defs.ProfileBindingsFile.properties.schema.const,objectId:id,objectRevision:r.revision,atomicUnit,bindings:bundle.projections[id]}});
        }
      }
      this.#migrationPermit={};try{return await this.#execute(b,{migrationPermit:this.#migrationPermit});}finally{this.#migrationPermit=null;}
    });
  }
  importDocument(document,options={}) {return this.#serialize(async()=>{
    this.#assertWrite();closed(options,['importKey'],['source','expectedRevisions','projections','intent','objectId','admission','admissions','referenceBindings']);const {importKey,source=null,expectedRevisions={},projections={},intent='import',objectId,admission,admissions={},referenceBindings=[]}=options;
    if(typeof importKey!=='string'||!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(importKey))reject('invalid_import_options',400);
    if(!admissions||typeof admissions!=='object'||Array.isArray(admissions)||!Array.isArray(referenceBindings))reject('invalid_import_options',400);
    if(admission&&admission!=='observation'||Object.values(admissions).some(v=>v!=='observation'))reject('foundation_admission_unsupported',422);
    let parsed=document;if(typeof document==='string'){try{parsed=JSON.parse(document);}catch{reject('invalid_json',400);}}const interpreted=await processDataset('interpret',{document:parsed},this.registry);
    const identity={source,expectedRevisions,projections,intent,objectId:objectId||null,admission:admission||'observation',admissions,referenceBindings,definitionSetId:this.definitionSetId},digest=sha256(interpreted.nquads+stableJSON(identity)),idempotencyKey='object-import-'+sha256(importKey),replay=this.#replay(idempotencyKey,digest,true);if(replay)return replay;
    const read=await this.#read(),state=read.state,model=readModel(read.snapshot,read.validation,this.registry);
    try {
      const result=await model.importDocument(parsed,{importKey:'foundation-candidate',source,expectedRevisions,projections,intent,...(objectId?{objectId}:{}),admission:'observation',admissions});result.importKey=importKey;
      const batch={schema:this.#definitions.commitSchema.properties.schema.const,idempotencyKey,expectedGeneration:state.generation,definitionSetId:this.definitionSetId,unitWrites:[],retireUnits:[],objectWrites:[],appWrites:[],referenceBindings:[],inspectionWrites:[]},mappedUnits=new Map(),selected=new Map(state.selectedObjects.map(v=>[v.objectId,v.objectRevision]));
      const currentUnits=state.selectedUnits.map(u=>state.units.find(v=>v.id===u.id&&v.revision===u.revision));
      for(const u of model.db.prepare('SELECT * FROM units').all()){
        const members=model.db.prepare('SELECT id FROM objects WHERE unit_id=? ORDER BY id').all(u.id).map(r=>r.id),previous=currentUnits.find(v=>stableJSON(v.members)===stableJSON(members)&&v.semanticSha256===u.semantic_sha256&&(members.length||u.id===sha256(unitKey(v))));
        if(previous){mappedUnits.set(u.id,{id:previous.id,revision:previous.revision});continue;}
        const lineage=members.length?currentUnits.find(v=>stableJSON(v.members)===stableJSON(members)):null,id=lineage?.id||'urn:zenith:hub:rdf-unit:'+sha256(idempotencyKey+'|'+u.semantic_sha256+'|'+stableJSON(members)+'|'+batch.unitWrites.length),revision=(lineage?.revision||0)+1;
        mappedUnits.set(u.id,{id,revision});batch.unitWrites.push({id,expectedRevision:lineage?.revision||0,revision,members,document:await processDataset('export',{nquads:u.nquads},this.registry)});
      }
      const newUnitKeys=new Set([...mappedUnits.values()].map(unitKey));for(const u of currentUnits)if(!newUnitKeys.has(unitKey(u)))batch.retireUnits.push({id:u.id,revision:u.revision});
      for(const row of model.db.prepare('SELECT * FROM objects').all())if(row.revision!==(selected.get(row.id)||0)){
        const atomicUnit=mappedUnits.get(row.unit_id),bindings=JSON.parse(row.profiles),types=model.db.prepare('SELECT type FROM object_types WHERE object_id=? ORDER BY type').all(row.id).map(r=>r.type);
        if(state.objects.find(o=>o.id===row.id&&o.objectRevision===selected.get(row.id))?.legacyReadOnly)reject('legacy_read_only',409);
        batch.objectWrites.push({id:row.id,expectedRevision:selected.get(row.id)||0,objectRevision:row.revision,atomicUnit,types,admission:'observation',definitionSetId:this.definitionSetId,bindings:{schema:this.#definitions.schema.$defs.ProfileBindingsFile.properties.schema.const,objectId:row.id,objectRevision:row.revision,atomicUnit,bindings}});
      }
      for(const write of batch.objectWrites){const explicit=referenceBindings.filter(b=>b.ownerKind==='object'&&b.ownerRef===write.id&&b.ownerRevision===write.objectRevision);batch.referenceBindings.push(...explicit);
        const old=state.referenceBindings.filter(b=>b.ownerKind==='object'&&b.ownerRef===write.id&&b.ownerRevision===write.expectedRevision);
        for(const binding of write.bindings.bindings){const role=Object.entries(this.#definitions.ownership.records).find(([,m])=>m.projection===binding.profile)?.[0];
          for(const oldRef of old){if(explicit.some(b=>b.field===oldRef.field&&b.targetRef===oldRef.targetRef))continue;const value=oldRef.field.slice(1).split('/').reduce((v,k)=>v?.[k],binding.value);if(value===oldRef.targetRef||value?.id===oldRef.targetRef||Array.isArray(value)&&value.includes(oldRef.targetRef))batch.referenceBindings.push({...oldRef,ownerRevision:write.objectRevision});}
          if(['SoftwareBuild','SoftwareInstallationRecord'].includes(role))for(const field of ['sourceSnapshotRef','buildRef']){const target=binding.value[field];if(!target||batch.referenceBindings.some(b=>b.ownerRef===write.id&&b.ownerRevision===write.objectRevision&&b.field==='/'+field))continue;const revision=batch.objectWrites.find(w=>w.id===target)?.objectRevision||selected.get(target);if(!revision)reject('reference_version_missing',422);batch.referenceBindings.push({ownerKind:'object',ownerRef:write.id,ownerRevision:write.objectRevision,field:'/'+field,targetRef:target,mode:'object-version',objectRevision:revision});}
        }
      }
      batch.referenceBindings=[...new Map(batch.referenceBindings.map(b=>[stableJSON(b),b])).values()];result.validation.invocationConformance='not-assessed';await this.#execute(batch,{digest,operation:result});return result;
    }finally{model.close();}
  });}

  get definitions(){return this.#definitions;}
  async applicationState(){return this.#read();}
  async readApplicationDocument(id){const {state}=await this.#read();const d=state.documents.find(v=>v.key===id);return d?structuredClone(d):null;}
  async applicationDocuments(){return structuredClone((await this.#read()).state.documents);}
  async get(id){if(!absoluteIRI(id))reject('invalid_object_id',400);if(this.legacy)return this.legacy.get(id);const read=await this.#read(),revision=read.validation.selected.get(id);if(!revision)reject('object_not_found',404);return this.#view(read.validation.entries.get(revision),read);}
  async getVersion(id,revision){if(!absoluteIRI(id)||!Number.isSafeInteger(revision)||revision<1)reject('invalid_object_revision',400);if(this.legacy){const current=await this.legacy.get(id);if(current.revision!==revision)reject('historical_revision_unavailable',404);return current;}const read=await this.#read(),entry=read.validation.entries.get(key(id,revision));if(!entry)reject('object_not_found',404);return this.#view(entry,read,true);}
  async #view(entry,{state},historical=false){const o=entry.object,commit=state.commits.find(c=>c.result.manifest.objects.some(v=>v.id===o.id&&v.objectRevision===o.objectRevision)),selection=historical?commit.result.manifest.selection.objects:state.selectedObjects,selected=new Map(selection.map(v=>[v.objectId,v.objectRevision])),members=state.units.find(u=>u.id===o.atomicUnit.id&&u.revision===o.atomicUnit.revision).members;
    return {id:o.id,revision:o.objectRevision,objectRevision:o.objectRevision,types:o.types,admission:o.admission,invocation:this.registry.contractStatus(o.id,entry.file.bindings),atomicUnitVersion:o.atomicUnit,atomicUnit:members.map(id=>({id,revision:selected.get(id)})),projections:entry.file.bindings,jsonldFile:o.jsonldFile,bindingsFile:o.bindingsFile,definitions:o.definitions,updatedAt:commit.committed_at,referenceBindings:state.referenceBindings.filter(b=>b.ownerKind==='object'&&b.ownerRef===o.id&&b.ownerRevision===o.objectRevision),document:await this.#representations.read(o.jsonldFile),provenance:{source:'hub-repository',generation:state.generation,...(o.legacyOrigin?{legacy:o.legacyOrigin}:{})},validation:{typeRecognition:o.types.length?'asserted-types':'untyped-description',types:o.types.map(type=>({type,recognized:this.registry.types.has(type),...this.registry.types.get(type)})),invocationConformance:'not-assessed'}};}
  list(options={}){if(this.legacy)return this.legacy.list(options);const {type,after='',limit=100,includeSubclasses=false}=options;if(!Number.isInteger(limit)||limit<1||limit>1000||typeof after!=='string'||typeof includeSubclasses!=='boolean'||type!==undefined&&!absoluteIRI(type))reject('invalid_list_query',400);const types=type?(includeSubclasses?this.registry.moduleGraph.descendants(type):[type]):null;const rows=types?.length?this.#db.prepare('SELECT DISTINCT o.object_id AS id,o.object_revision AS revision FROM hub_current_objects o JOIN hub_object_type_history t ON t.object_id=o.object_id AND t.object_revision=o.object_revision WHERE t.type_iri IN ('+types.map(()=>'?').join(',')+') AND o.object_id>? ORDER BY o.object_id LIMIT ?').all(...types,after,limit+1):types?[]:this.#db.prepare('SELECT object_id AS id,object_revision AS revision FROM hub_current_objects WHERE object_id>? ORDER BY object_id LIMIT ?').all(after,limit+1);return {items:rows.slice(0,limit),next:rows.length>limit?rows[limit-1].id:null,...(includeSubclasses?{typeExpansion:'bounded-rdfs-subClassOf'}:{})};}
  async exportDocument(selection={}){if(this.legacy)return this.legacy.exportDocument(selection);const read=await this.#read(),model=readModel(read.snapshot,read.validation,this.registry);try{return await model.exportDocument(selection);}finally{model.close();}}
  row(id){if(this.legacy)return this.legacy.row(id);const row=this.#db.prepare('SELECT * FROM hub_current_objects WHERE object_id=?').get(id);if(!row)return undefined;return {id,revision:row.object_revision,profiles:JSON.stringify(this.#db.prepare('SELECT profile_id,value_json FROM hub_profile_values WHERE object_id=? AND object_revision=?').all(id,row.object_revision).map(r=>({profile:r.profile_id,value:JSON.parse(r.value_json)})))};}
  admission(id){return this.legacy?this.legacy.admission(id):this.#db.prepare('SELECT v.admission FROM hub_current_objects h JOIN hub_object_versions v ON v.object_id=h.object_id AND v.object_revision=h.object_revision WHERE h.object_id=?').get(id)?.admission||'observation';}
  async exportBundle(selection){return exportBundle(this,selection);}
  async importBundle(bundle,options){return importBundle(this,bundle,options);}
  async relationships(options){if(this.legacy)return this.legacy.relationships(options);const r=await this.#read(),model=readModel(r.snapshot,r.validation,this.registry);try{return model.relationships(options);}finally{model.close();}}
  async connected(options){if(this.legacy)return this.legacy.connected(options);const r=await this.#read(),model=readModel(r.snapshot,r.validation,this.registry);try{return model.connected(options);}finally{model.close();}}
  async close(){if(this.#closed)return;this.#closed=true;await this.#queue;this.legacy?.close();this.#db?.close();this.#db=null;}
}
