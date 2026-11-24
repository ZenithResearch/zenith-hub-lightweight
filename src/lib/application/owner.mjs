/** One process-local owner per explicitly activated root. GETs never create or migrate storage. */
import path from 'node:path';
import os from 'node:os';
import {readFile,lstat} from 'node:fs/promises';
import {HubApplication} from './database.mjs';
import {reject} from '../objects/registry.mjs';
const owners=globalThis[Symbol.for('zenith.hub.application.owners')] ||= new Map();
export const setupRoot=env=>path.resolve(env.ZENITH_HUB_SETUP_DIR||path.join(os.homedir(),'Library/Application Support/Zenith/Hub'));
export const markerFile=root=>path.join(root,'application.json');
export async function activation(root){
 const file=markerFile(root);let stat;try{stat=await lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
 if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==process.getuid()||stat.mode&0o077||stat.size>65536)reject('unsafe_application_marker',503);
 const value=JSON.parse(await readFile(file,'utf8'));
 if(value.schema!=='zenith.hub-application-activation.v1'||value.setupRoot!==root||!path.isAbsolute(value.dataDir)||!value.repositoryId||!value.definitionSetId)reject('invalid_application_marker',503);
 return value;
}
export async function assertActivatedStorage(marker){let stat;try{stat=await lstat(path.join(marker.dataDir,'objects.sqlite'));}catch(e){if(e.code==='ENOENT')reject('application_database_missing',503);throw e;}if(!stat.isFile()||stat.isSymbolicLink())reject('unsafe_hub_database',503);}
export async function assertNoPendingMigration(root){let value;try{value=JSON.parse(await readFile(path.join(root,'application-migration.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}if(value.state!=='complete')reject('migration_recovery_required',503);}
export async function applicationForRoot(root,options={}){
 root=path.resolve(root);await assertNoPendingMigration(root);const marker=await activation(root);if(!marker)reject('application_database_not_initialized',503);await assertActivatedStorage(marker);
 const key=root+'|'+marker.repositoryId+'|'+marker.definitionSetId;
 if(!owners.has(key))owners.set(key,(async()=>{const app=await HubApplication.open({dataDir:marker.dataDir,setupRoot:root,resourcesFile:marker.resourcesFile,...options});const status=await app.status();if(status.repositoryId!==marker.repositoryId||status.definitionSetId!==marker.definitionSetId){await app.close();reject('application_identity_mismatch',503);}return app;})().catch(e=>{owners.delete(key);throw e;}));return owners.get(key);
}
export async function applicationForEnv(env=process.env){const root=setupRoot(env),marker=await activation(root);if(marker&&env.ZENITH_HUB_DATA_DIR&&path.resolve(env.ZENITH_HUB_DATA_DIR)!==marker.dataDir)reject('application_storage_configuration_changed',503);return applicationForRoot(root,{registryFile:env.ZENITH_HUB_ONTOLOGY_REGISTRY_FILE,env});}
export async function closeApplication(root){for(const [key,p]of owners)if(key.startsWith(path.resolve(root)+'|')){owners.delete(key);await (await p).close();}}
