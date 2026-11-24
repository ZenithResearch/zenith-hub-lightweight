/** Explicit source-fingerprinted migration. Native software, service data and credential files are never copied or changed. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync,backup} from 'node:sqlite';
import {spawnSync} from 'node:child_process';
import {ObjectStore} from '../objects/store.mjs';
import {loadOntologyRegistry,sha256,reject,absoluteIRI} from '../objects/registry.mjs';
import {privateDatabaseFile,privateDirectory} from '../objects/representations.mjs';
import {stableJSON} from '../objects/bundle.mjs';
import {processDataset} from '../objects/codec.mjs';
import {readPrivate,atomic} from '../setup/state.mjs';
import {validateRegistry} from '../resource-registry.mjs';
import {loadCatalog} from '../setup/catalog.mjs';
import {HubApplication} from './database.mjs';
import {loadApplicationDefinitions} from '../objects/application.mjs';
import {readPackage} from '../catalog/package.mjs';
import {ApplicationCompiler,identity} from './compiler.mjs';
import {emptySetup,emptyResources,validateSetup} from './model.mjs';
import {activation,markerFile} from './owner.mjs';

const exists=async file=>fs.lstat(file).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
const hash=v=>sha256(stableJSON(v));
const codeRoot=path.resolve('profiles/object-store/registry.json');
export function locations(options){const root=path.resolve(options.setupRoot),dataDir=path.resolve(options.dataDir||path.join(root,'objects')),resourcesFile=path.resolve(options.resourcesFile||path.join(root,'resources.json'));return {setupRoot:root,dataDir,resourcesFile,registryFile:options.registryFile||codeRoot};}
async function sourceJSON(file,fallback){try{const bytes=await readPrivate(file);return {file,value:JSON.parse(bytes),sha256:sha256(bytes)};}catch(e){if(e.code==='ENOENT')return {file,value:fallback,sha256:null};throw e;}}
async function legacySource(directory,registry,file=path.join(directory,'objects.sqlite')){if(!await exists(file))return null;
 if(file===path.join(directory,'objects.sqlite'))await privateDatabaseFile(directory,{create:false});else{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.nlink!==1||stat.mode&0o077)reject('unsafe_hub_database',503);}const db=new DatabaseSync(file,{readOnly:true,allowExtension:false});let data;
 try{const version=db.prepare('PRAGMA user_version').get().user_version;if(version!==2)reject('migration_source_version_unsupported',409,{path:directory,version});if(db.prepare('PRAGMA application_id').get().application_id!==0x5a484f42)reject('not_a_supported_hub_database',503);
  db.exec('BEGIN');data={units:db.prepare('SELECT * FROM units ORDER BY id').all(),objects:db.prepare('SELECT * FROM objects ORDER BY id').all(),admissions:db.prepare('SELECT * FROM admissions ORDER BY object_id').all(),imports:db.prepare('SELECT * FROM imports ORDER BY import_key').all(),tables:db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>({name:r.name,count:db.prepare('SELECT count(*) AS n FROM "'+r.name.replaceAll('"','""')+'"').get().n}))};db.exec('COMMIT');
 }finally{db.close();}
 for(const u of data.units)if(sha256(u.nquads)!==u.semantic_sha256)reject('legacy_rdf_integrity_failure',503);
 return {directory,file,data,fingerprint:hash(data)};
}
function materialize(sources,registry){
 const memory=new ObjectStore({registry,memory:true}),records=new Map(),units=[],conflicts=[];
 memory.db.prepare('INSERT INTO imports VALUES(?,?,?,?,?,?)').run('migration','migration','migration','migration','{}','{}');
 for(const source of sources)for(const u of source.data.units){const owned=source.data.objects.filter(o=>o.unit_id===u.id),members=owned.map(o=>o.id).sort(),existing=owned.map(o=>records.get(o.id)).filter(Boolean);
  if(existing.length){
   const same=existing.length===owned.length&&existing.every(r=>r.semantic===u.semantic_sha256&&stableJSON(r.members)===stableJSON(members)&&stableJSON(JSON.parse(r.profiles))===stableJSON(JSON.parse(owned.find(o=>o.id===r.id).profiles))&&r.admission===(source.data.admissions.find(a=>a.object_id===r.id)?.policy||'observation'));
   if(!same){conflicts.push(...members);continue;}
   for(const o of owned){const r=records.get(o.id);if(o.revision>r.revision){r.revision=o.revision;r.sourceImportKey=o.last_import;r.sourceProvenance=JSON.parse(source.data.imports.find(i=>i.import_key===o.last_import)?.provenance||'{}');}memory.db.prepare('UPDATE objects SET revision=? WHERE id=?').run(r.revision,o.id);}continue;
  }
  const unitId=sha256(source.directory+'|'+u.id);memory.db.prepare('INSERT INTO units VALUES(?,?,?)').run(unitId,u.nquads,u.semantic_sha256);units.push({id:identity('migrated-unit',source.directory+'|'+u.id),nquads:u.nquads});
  for(const o of owned){const admission=source.data.admissions.find(a=>a.object_id===o.id)?.policy||'observation';records.set(o.id,{...o,sourceImportKey:o.last_import,sourceProvenance:JSON.parse(source.data.imports.find(i=>i.import_key===o.last_import)?.provenance||'{}'),admission,semantic:u.semantic_sha256,members});memory.db.prepare('INSERT INTO objects VALUES(?,?,?,?,?,?)').run(o.id,unitId,o.revision,o.updated_at,'migration',o.profiles);memory.db.prepare('INSERT INTO admissions VALUES(?,?)').run(o.id,admission);}
  memory.index({id:unitId,nquads:u.nquads});
 }
 return {memory,records:[...records.values()].map(r=>({id:r.id,revision:r.revision,sourceImportKey:r.sourceImportKey,sourceProvenance:r.sourceProvenance})),units,conflicts:[...new Set(conflicts)]};
}
export async function planMigration(options){
 const config=locations(options);if(config.dataDir===config.setupRoot||config.setupRoot.startsWith(config.dataDir+path.sep)||config.dataDir.startsWith(path.join(config.setupRoot,'instances')+path.sep)||config.resourcesFile.startsWith(config.dataDir+path.sep))reject('unsafe_application_storage_layout',422);const active=await activation(config.setupRoot),journal=await sourceJSON(path.join(config.setupRoot,'application-migration.json'),null);if(journal.value&&journal.value.state!=='complete'&&active)return {schema:'zenith.hub-migration-plan.v1',recoveryRequired:true,config,planFile:journal.value.planFile,blockers:[{code:'migration_recovery_required'}]};if(active)return {schema:'zenith.hub-migration-plan.v1',alreadyActive:true,config,activation:active,blockers:[]};
 const interrupted=await sourceJSON(path.join(config.setupRoot,'application-migration.json'),null);if(interrupted.value&&interrupted.value.state!=='complete'){const j=interrupted.value;if(await exists(path.join(config.dataDir,'objects.sqlite'))){const db=new DatabaseSync(path.join(config.dataDir,'objects.sqlite'),{readOnly:true});const version=db.prepare('PRAGMA user_version').get().user_version;db.close();if(version===5)return {schema:'zenith.hub-migration-plan.v1',recoveryRequired:true,config,planFile:j.planFile,blockers:[{code:'migration_recovery_required'}]};}if(!await exists(config.dataDir)&&await exists(j.archive||'/nonexistent'))return {schema:'zenith.hub-migration-plan.v1',recoveryRequired:true,config,planFile:j.planFile,blockers:[{code:'migration_recovery_required'}]};}
 if(await exists(config.dataDir)&&!await exists(path.join(config.dataDir,'objects.sqlite'))&&(await fs.readdir(config.dataDir)).length)reject('migration_target_not_empty',409);
 const registry=await loadOntologyRegistry(config.registryFile),setup=await sourceJSON(path.join(config.setupRoot,'setup.json'),emptySetup()),resources=await sourceJSON(config.resourcesFile,emptyResources()),machine=await sourceJSON(path.join(config.setupRoot,'machine.json'),null);
 validateSetup(setup.value);validateRegistry(resources.value);if(machine.value&&!absoluteIRI(machine.value.id))reject('invalid_machine_identity',422);
 const directories=[...new Set([config.dataDir,path.join(config.setupRoot,'objects')])],sources=[];
 for(const directory of directories){const source=await legacySource(directory,registry);if(source)sources.push(source);}
 const joined=materialize(sources,registry);let bundle;try{bundle=await joined.memory.exportBundle();}finally{joined.memory.close();}
 const nativePending=Object.values(setup.value.operations).filter(op=>op.state==='applying').map(op=>op.id||'unknown');
 const blockers=[...joined.conflicts.map(id=>({code:'conflicting_legacy_object',id})),...nativePending.map(id=>({code:'pending_native_operation_requires_reconciliation',id}))];
 const catalogDefinitions=await loadApplicationDefinitions({}),catalogPackage=await readPackage({definitions:catalogDefinitions,registry:catalogDefinitions.registry});
 const pins={catalogPackageDigest:catalogPackage.digest,catalogDefinitionsSha256:catalogDefinitions.extensions.manifestSha256,applicationManifestSha256:sha256(await fs.readFile('profiles/application-db/manifest.json')),catalogSha256:sha256(await fs.readFile('profiles/setup/catalog.json')),driverSha256:sha256(Buffer.concat(await Promise.all(['src/lib/application/model.mjs','src/lib/application/compiler.mjs','src/lib/application/database.mjs','src/lib/application/migration.mjs','src/lib/catalog/service.mjs','src/lib/catalog/package.mjs','src/lib/catalog/definitions.mjs','src/lib/catalog/pin.mjs'].map(p=>fs.readFile(p)))))};
 const fingerprints={setup:setup.sha256,resources:resources.sha256,machine:machine.sha256,databases:sources.map(s=>({directory:s.directory,fingerprint:s.fingerprint}))},sourceFingerprint=hash(fingerprints),digest=hash({config,fingerprints,pins});
 const units=[];for(const u of joined.units)units.push({id:u.id,document:await processDataset('export',{nquads:u.nquads},registry)});
 return {schema:'zenith.hub-migration-plan.v1',alreadyActive:false,digest,sourceFingerprint,config,fingerprints,pins,blockers,
  summary:{action:setup.sha256||sources.length||resources.sha256?'migrate':'initialize',setupRevision:setup.value.revision,instances:setup.value.instances.length,connections:resources.value.resources.length,operations:Object.keys(setup.value.operations).length,objects:joined.records.length,units:units.length,softwareCatalogEntries:catalogPackage.entries.length,sourceDatabases:sources.map(s=>({path:s.file,fingerprint:s.fingerprint,tables:s.data.tables})),nativeData:'Preserved in place; no installation, process adoption, credential or history copy.'},
  payload:{setup:setup.value,resources:resources.value,machineId:machine.value?.id,bundle,records:joined.records,units}};
}
export function publicPlan(plan){const {payload,...value}=plan;return value;}
async function syncDir(dir){const f=await fs.open(dir,'r');try{await f.sync();}finally{await f.close();}}
async function publish(file,value){await atomic(file,value);await syncDir(path.dirname(file));}
async function copyPrivate(source,target){const bytes=Buffer.from(await readPrivate(source));const f=await fs.open(target,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}return sha256(bytes);}
async function lock(file){if(await exists(file)){let old;try{old=JSON.parse(await readPrivate(file,4096));}catch{reject('migration_writer_busy',409,{file});}if(!Number.isSafeInteger(old.pid)||old.pid<1)reject('migration_writer_busy',409,{file});try{process.kill(old.pid,0);reject('migration_writer_busy',409,{file});}catch(e){if(e.code!=='ESRCH')throw e;await fs.unlink(file);}}let handle;try{handle=await fs.open(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')reject('migration_writer_busy',409,{file});throw e;}await handle.writeFile(JSON.stringify({pid:process.pid}));await handle.sync();return async()=>{await handle.close();await fs.unlink(file);};}
function assertNoDatabaseWriters(file){const result=spawnSync('/usr/sbin/lsof',['-F','pfa','--',file],{encoding:'utf8'});if(result.error?.code==='ENOENT'){
 const alternate=spawnSync('lsof',['-F','pfa','--',file],{encoding:'utf8'});if(alternate.error)reject('migration_writer_check_unavailable',503);return checkWriters(alternate.stdout);
 }if(result.error)throw result.error;checkWriters(result.stdout);}
function checkWriters(text){let pid;const writers=new Set();for(const line of (text||'').split('\n')){if(line.startsWith('p'))pid=Number(line.slice(1));if(/^a[wu]$/.test(line)&&pid!==process.pid)writers.add(pid);}if(writers.size)reject('migration_database_in_use',409,{pids:[...writers]});}
async function verifySources(plan){const current=await planMigration(plan.config);if(current.alreadyActive||current.digest!==plan.digest)reject('migration_sources_changed',409);if(current.blockers.length)reject('migration_blocked',409,{blockers:current.blockers});return current;}

export async function applyMigration(options,reviewed,{fault=()=>{}}={}){
 const config=locations(options);if(stableJSON(config)!==stableJSON(reviewed.config))reject('migration_configuration_changed',409);
 const active=await activation(config.setupRoot);if(active){const app=await HubApplication.open({...config,setupRoot:config.setupRoot});try{const status=await app.status();if(status.repositoryId!==active.repositoryId||active.migrationDigest!==reviewed.digest)reject('application_identity_mismatch',503);const redirect={schema:'zenith.hub-storage-redirect.v1',setupRoot:config.setupRoot,applicationDatabase:config.dataDir,migrationDigest:reviewed.digest};await publish(path.join(config.setupRoot,'setup.json'),redirect);if(path.dirname(config.resourcesFile)===config.setupRoot)await publish(config.resourcesFile,redirect);await publish(path.join(config.setupRoot,'application-migration.json'),{schema:'zenith.hub-migration-journal.v1',digest:reviewed.digest,state:'complete',backupManifest:active.backupManifest,status});return {...status,replayed:true};}finally{await app.close();}}
 if(reviewed.blockers?.length)reject('migration_blocked',409,{blockers:reviewed.blockers});
 await privateDirectory(config.setupRoot);const unlock=await lock(path.join(config.setupRoot,'application-migration.lock'));const oldLocks=[];
 const journalFile=path.join(config.setupRoot,'application-migration.json');let app;
 try{
  // A new server is not started until this completes. Stop an existing owner before apply.
  oldLocks.push(await lock(path.join(config.setupRoot,'setup.lock')));
  if(await exists(config.resourcesFile))oldLocks.push(await lock(config.resourcesFile+'.lock'));
  const targetExists=await exists(config.dataDir),resume=await sourceJSON(journalFile,null),prior=resume.value;
  let targetVersion=null;if(targetExists&&await exists(path.join(config.dataDir,'objects.sqlite'))){const probe=new DatabaseSync(path.join(config.dataDir,'objects.sqlite'),{readOnly:true});try{targetVersion=probe.prepare('PRAGMA user_version').get().user_version;}finally{probe.close();}}
  const plannedArchive=config.dataDir+'.legacy-'+reviewed.digest.slice(0,16);const moved=prior?.digest===reviewed.digest&&(prior.state==='source-archived'||prior.state==='target-published'||targetVersion===5||!targetExists&&await exists(plannedArchive));const published=!!moved;
  let current=reviewed;if(!published)current=await verifySources(reviewed);
  for(const s of reviewed.summary.sourceDatabases)if(await exists(s.path))assertNoDatabaseWriters(s.path);
  const parent=path.dirname(config.dataDir);await privateDirectory(parent);
  const space=await fs.statfs(parent),bytes=await Promise.all(reviewed.summary.sourceDatabases.map(s=>fs.stat(s.path).then(v=>v.size,e=>{if(e.code==='ENOENT'&&published)return 0;throw e;}))),required=64*1024**2+3*bytes.reduce((a,b)=>a+b,0);if(space.bavail*space.bsize<required)reject('insufficient_migration_space',409,{requiredBytes:required});
  const work=path.join(config.setupRoot,'application-backups',reviewed.digest),stage=config.dataDir+'.migration-'+reviewed.digest.slice(0,16),archive=config.dataDir+'.legacy-'+reviewed.digest.slice(0,16);
  await privateDirectory(path.dirname(work));await privateDirectory(work);
  const backups=[];
  if(!published){
   await publish(path.join(work,'plan.json'),reviewed);
   for(const [name,file]of [['setup.json',path.join(config.setupRoot,'setup.json')],['resources.json',config.resourcesFile],['machine.json',path.join(config.setupRoot,'machine.json')]])if(await exists(file)){
    const dest=path.join(work,name);if(!await exists(dest))await copyPrivate(file,dest);const digest=sha256(await fs.readFile(dest));const expected=reviewed.fingerprints[name.split('.')[0]];if(digest!==expected)reject('migration_backup_mismatch',503);backups.push({source:file,backup:dest,sha256:digest});
   }
   for(let i=0;i<reviewed.summary.sourceDatabases.length;i++){const source=reviewed.summary.sourceDatabases[i],dest=path.join(work,'objects-'+i+'.sqlite');if(!await exists(dest)){const db=new DatabaseSync(source.path,{readOnly:true});try{await backup(db,dest);}finally{db.close();}await fs.chmod(dest,0o600);const f=await fs.open(dest,'r');try{await f.sync();}finally{await f.close();}}
    const snap=await legacySource(path.dirname(source.path),await loadOntologyRegistry(config.registryFile));if(snap.fingerprint!==source.fingerprint)reject('migration_sources_changed',409);const saved=await legacySource(work,await loadOntologyRegistry(config.registryFile),dest);if(saved.fingerprint!==source.fingerprint)reject('migration_backup_mismatch',503);backups.push({source:source.path,backup:dest,sha256:sha256(await fs.readFile(dest)),fingerprint:source.fingerprint});
   }
   await publish(path.join(work,'manifest.json'),{schema:'zenith.hub-migration-backup.v1',digest:reviewed.digest,backups,nativeDataCopied:false});
   await publish(journalFile,{schema:'zenith.hub-migration-journal.v1',digest:reviewed.digest,state:'backed-up',stage,archive,backupManifest:path.join(work,'manifest.json'),planFile:path.join(work,'plan.json')});await fault('backed-up');
   app=await HubApplication.open({dataDir:stage,setupRoot:config.setupRoot,resourcesFile:config.resourcesFile,registryFile:config.registryFile});
   if(app.repository.generation()===0&&current.payload.units.length)await app.repository.ingestLegacy({bundle:current.payload.bundle,records:current.payload.records,units:current.payload.units,sourceFingerprint:reviewed.sourceFingerprint});
   await app.initialize({setup:current.payload.setup,resources:current.payload.resources,machineId:current.payload.machineId});
   // Compare compatibility reads before publishing any cutover pointer.
   if(stableJSON(await app.readSetup())!==stableJSON(current.payload.setup)||stableJSON(await app.readResources())!==stableJSON(current.payload.resources))reject('migration_roundtrip_mismatch',503);
   const read=await app.repository.applicationState(),compiler=new ApplicationCompiler(app.repository,read);compiler.document('migration','migration',{digest:reviewed.digest,sourceFingerprint:reviewed.sourceFingerprint,backupManifest:path.join(work,'manifest.json'),legacyHistory:'Only available source revisions retained; no pre-migration history invented.'});if(!read.state.documents.some(d=>d.key==='migration'))await app.repository.commitBatch(await compiler.finish());
   const status=await app.status();await app.close();app=null;await verifySources(reviewed);await fault('staged');
   // Keep the existing root intact under an explicit archive; no source data is deleted.
   if(targetExists){if(await exists(archive))reject('migration_archive_exists',409);await fs.rename(config.dataDir,archive);await syncDir(parent);await publish(journalFile,{schema:'zenith.hub-migration-journal.v1',digest:reviewed.digest,state:'source-archived',stage,archive,backupManifest:path.join(work,'manifest.json'),planFile:path.join(work,'plan.json')});await fault('source-archived');}
   await fs.rename(stage,config.dataDir);await syncDir(parent);
   await publish(journalFile,{schema:'zenith.hub-migration-journal.v1',digest:reviewed.digest,state:'target-published',archive:targetExists?archive:null,backupManifest:path.join(work,'manifest.json'),planFile:path.join(work,'plan.json'),status});await fault('target-published');
  }
  if(published&&!await exists(config.dataDir)){if(!await exists(stage))reject('migration_recovery_missing_stage',503);await fs.rename(stage,config.dataDir);await syncDir(parent);}
  const verifiedManifest=JSON.parse(await readPrivate(path.join(work,'manifest.json')));if(verifiedManifest.digest!==reviewed.digest)reject('migration_backup_mismatch',503);for(const b of verifiedManifest.backups)if(sha256(await fs.readFile(b.backup))!==b.sha256)reject('migration_backup_mismatch',503);
  app=await HubApplication.open({...config,setupRoot:config.setupRoot});const migration=await app.repository.readApplicationDocument('migration');if(migration?.value.digest!==reviewed.digest)reject('migration_target_identity_mismatch',503);const status=await app.status();
  await publish(markerFile(config.setupRoot),{schema:'zenith.hub-application-activation.v1',setupRoot:config.setupRoot,dataDir:config.dataDir,resourcesFile:config.resourcesFile,repositoryId:status.repositoryId,definitionSetId:status.definitionSetId,migrationDigest:reviewed.digest,backupManifest:path.join(work,'manifest.json')});await fault('activated');
  // Old binaries fail closed rather than writing a second setup/connection authority.
  const redirect={schema:'zenith.hub-storage-redirect.v1',setupRoot:config.setupRoot,applicationDatabase:config.dataDir,migrationDigest:reviewed.digest};
  await publish(path.join(config.setupRoot,'setup.json'),redirect);if(path.dirname(config.resourcesFile)===config.setupRoot)await publish(config.resourcesFile,redirect);
  await publish(journalFile,{schema:'zenith.hub-migration-journal.v1',digest:reviewed.digest,state:'complete',backupManifest:path.join(work,'manifest.json'),status});
  return {...status,migrated:reviewed.summary.action==='migrate',initialized:true,backupManifest:path.join(work,'manifest.json')};
 }finally{await app?.close();for(const release of oldLocks.reverse())await release();await unlock();}
}
