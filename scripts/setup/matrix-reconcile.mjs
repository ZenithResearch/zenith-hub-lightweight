#!/usr/bin/env node
/** Explicit legacy recovery: inspect -> private review -> apply identity metadata only.
 * Never adopt a listening endpoint, regenerate keys, configure or start a server.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readPrivate,atomic,privateDirectory} from '../../src/lib/setup/state.mjs';
import {check,digest} from '../../src/lib/setup/catalog.mjs';
import {runOwned} from '../../src/lib/setup/adapters.mjs';
const within=(root,file)=>file.startsWith(root+path.sep);
async function evidence(file,limit=1048576){const bytes=await readPrivate(file,limit);return {path:file,sha256:digest(bytes)};}
function stopped(root,planFile){
 const result=spawnSync('/bin/ps',['-axo','command='],{encoding:'utf8',timeout:5000,maxBuffer:1048576});
 check(result,!result.error&&result.status===0,'matrix_reconciliation_process_unknown');
 const active=result.stdout.split('\n').some(line=>((line.includes('instance.py configure ')||line.includes('controller.py _matrix-config '))&&line.includes(planFile))||(line.includes('synapse.app.homeserver')&&line.includes(path.join(root,'config/homeserver.yaml'))));
 check(result,!active,'matrix_stop_native_writers_before_reconciliation');
}
export async function inspectLegacyMatrix(planFile,{installationPlan,run=runOwned,assertStopped=stopped}={}){
 planFile=path.resolve(planFile);const p=JSON.parse(await readPrivate(planFile)),root=path.resolve(p.root||'');
 check(p,p.componentId==='matrix'&&p.mode==='install'&&/^[a-z][a-z0-9-]{0,47}$/.test(p.instanceId||'')&&path.basename(root)===p.instanceId&&path.basename(path.dirname(root))==='instances'&&await fs.realpath(root)===root,'matrix_reconciliation_identity_unknown');
 const r=JSON.parse(await readPrivate(path.join(root,'receipt.json')));
 check(r,r.componentId==='matrix'&&r.instanceId===p.instanceId&&r.root===root&&r.installed===true&&r.configured===false&&p.config?.access==='private'&&p.config.federation!==true,'matrix_reconciliation_receipt_mismatch');
 await assertStopped(root,planFile);
 const controller=await evidence(path.join(root,'controller.py'),2097152);check(r,controller.sha256===r.controllerSha256,'matrix_reconciliation_controller_changed');
 const plans=installationPlan?[path.resolve(installationPlan)]:(await fs.readdir(path.join(root,'../../plans'))).slice(0,128).filter(f=>/\.json$/.test(f)).map(f=>path.join(root,'../../plans',f));
 let original,originalFile;
 for(const file of plans){const row=JSON.parse(await readPrivate(file));if(row.digest===r.planDigest&&row.root===root&&row.instanceId===p.instanceId&&row.componentId==='matrix'&&row.mode==='install'){original=row;originalFile=file;break;}}
 check(original,!!original&&original.config?.serverName===p.config.serverName&&digest(original.config)===digest(p.config),'matrix_original_installation_review_required');
 const closure=(original.artifacts||[]).map(a=>({filename:path.basename(a.path),sha256:a.sha256}));
 check(r,digest(closure)===digest(r.artifacts),'matrix_reconciliation_artifacts_changed');
 const wheels=[];
 for(const a of r.artifacts){check(a,path.basename(a.filename)===a.filename,'matrix_reconciliation_artifacts_changed');const file=path.join(root,'wheels',a.filename),stat=await fs.lstat(file);check(stat,stat.isFile()&&!stat.isSymbolicLink(),'matrix_reconciliation_artifacts_changed');const hash=digest(await fs.readFile(file));check(a,hash===a.sha256,'matrix_reconciliation_artifacts_changed');wheels.push({path:file,sha256:hash});}
 const yamlFile=path.join(root,'config/homeserver.yaml'),source='import yaml,json,sys;d=yaml.safe_load(open(sys.argv[1]));db=d.get("database",{});print(json.dumps({"serverName":d.get("server_name"),"signingKeyPath":d.get("signing_key_path"),"databaseKind":db.get("name"),"databasePath":db.get("args",{}).get("database") if db.get("name")=="sqlite3" else None,"mediaPath":d.get("media_store_path")}))';
 const y=JSON.parse(await run(path.join(root,'venv/bin/python'),['-I','-c',source,yamlFile],{timeout:10000}));
 check(y,y.serverName===p.config.serverName&&typeof y.signingKeyPath==='string','matrix_reconciliation_server_identity_changed');
 const key=path.resolve(root,y.signingKeyPath);check(key,within(root,await fs.realpath(key)),'matrix_reconciliation_key_outside_instance');
 for(const [value,target]of [[y.databasePath,'data/homeserver.db'],[y.mediaPath,'data/media']]){
  if(!value)continue;const file=path.resolve(root,value);check(file,within(root,file),'matrix_reconciliation_storage_outside_instance');
  try{const stat=await fs.lstat(file);check(stat,!stat.isSymbolicLink()&&within(root,await fs.realpath(file)),'matrix_reconciliation_storage_outside_instance');if(file!==path.join(root,target))check(stat,stat.isDirectory()&&(await fs.readdir(file)).length===0,'matrix_retained_storage_requires_explicit_migration');}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 check(y,!y.databaseKind||y.databaseKind==='sqlite3','matrix_reconciliation_database_unsupported');
 const intent={instanceId:p.instanceId,componentId:'matrix',serverName:p.config.serverName,configuration:p.config,root,artifacts:r.artifacts};
 const files=[await evidence(planFile),await evidence(originalFile),await evidence(path.join(root,'receipt.json')),controller,await evidence(yamlFile),await evidence(key,65536),...wheels];
 const driver=digest(await fs.readFile(fileURLToPath(import.meta.url)));
 return {schema:'zenith.hub-matrix-reconciliation.v1',planFile,installationPlan:originalFile,root,serverName:y.serverName,action:'record-verified-legacy-identity-intent',effects:['Record only the verified configuration identity intent. Retain YAML, signing key, database and media. Return to Hub, reconcile retained setup, then review Configure again.'],intent,files,driverDigest:driver,fingerprint:digest({intent,files,driver})};
}
export async function applyLegacyMatrix(review,options={}){
 check(review,review?.schema==='zenith.hub-matrix-reconciliation.v1','matrix_invalid_reconciliation_review');
 // Share the native configure lock so a review/apply race cannot replace identity
 // metadata while another writer generates configuration.
 const root=path.resolve(review.root||''),lock=path.join(root,'config/configuration-lock.json'),token=randomUUID();
 check(review,path.isAbsolute(review.root||'')&&await fs.realpath(root)===root,'matrix_reconciliation_identity_unknown');
 const stamp=spawnSync('/bin/ps',['-p',String(process.pid),'-o','lstart=,comm='],{encoding:'utf8',timeout:5000});
 check(stamp,!stamp.error&&stamp.status===0&&stamp.stdout.trim(),'matrix_reconciliation_process_unknown');
 let handle;
 try{handle=await fs.open(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')check(review,false,'matrix_reconciliation_configuration_locked');throw e;}
 try{
  await handle.writeFile(JSON.stringify({schema:'zenith.hub-configure-lock.v1',root,instanceId:review.intent?.instanceId,pid:process.pid,processStamp:stamp.stdout.trim(),token}));await handle.sync();
  const fresh=await inspectLegacyMatrix(review.planFile,{...options,installationPlan:review.installationPlan});
  check(review,fresh.root===root&&fresh.fingerprint===review.fingerprint&&digest(fresh.intent)===digest(review.intent),'matrix_reconciliation_review_changed');
  const file=path.join(fresh.root,'config/matrix-identity.json');
  try{const prior=JSON.parse(await readPrivate(file));check(prior,digest(prior)===digest(fresh.intent),'matrix_reconciliation_intent_conflict');return {recorded:true,alreadyRecorded:true};}catch(e){if(e.code!=='ENOENT')throw e;}
  await atomic(file,fresh.intent);return {recorded:true,nativeDataChanged:false,next:'Reconcile retained setup in Hub, then review Configure.'};
 }finally{
  await handle.close();
  try{if(JSON.parse(await readPrivate(lock)).token===token)await fs.unlink(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];if(args.includes('--apply'))console.log(JSON.stringify(await applyLegacyMatrix(JSON.parse(await readPrivate(path.resolve(value('--apply'))))),null,2));
 else{check(args,args.includes('--plan')&&args.includes('--review'),'matrix_reconciliation_arguments_required');const review=await inspectLegacyMatrix(value('--plan'),{...(args.includes('--installation-plan')?{installationPlan:value('--installation-plan')}:{})}),out=path.resolve(value('--review'));await privateDirectory(path.dirname(out));await atomic(out,review);console.log(JSON.stringify({schema:review.schema,serverName:review.serverName,root:review.root,effects:review.effects,reviewFile:out},null,2));}}
 catch(e){console.error(JSON.stringify({error:e.code||'matrix_reconciliation_incomplete'}));process.exitCode=1;}
}
