#!/usr/bin/env node
/** Initialize/check storage before starting the local app server. Browser launch is an owner action. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {existsSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {planMigration,applyMigration,publicPlan,locations} from '../src/lib/application/migration.mjs';
import {activation,assertNoPendingMigration,assertActivatedStorage} from '../src/lib/application/owner.mjs';
import {HubApplication} from '../src/lib/application/database.mjs';
import {readPrivate,atomic,privateDirectory} from '../src/lib/setup/state.mjs';
if(existsSync('.env.operator.local'))process.loadEnvFile('.env.operator.local');
const args=process.argv.slice(2),flags={},position=[];
const values=new Set(['--setup-dir','--data-dir','--resources-file','--port','--plan','--software']);
for(let i=0;i<args.length;i++){const token=args[i];if(values.has(token)){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('Missing '+token);flags[token]=args[++i];}else if(['--dev','--production','--migrate','--json','--register'].includes(token))flags[token]=true;else if(token.startsWith('--'))throw Error('Unknown option '+token);else position.push(token);}
const command=position.join(' ')||'serve';
const root=path.resolve(flags['--setup-dir']||process.env.ZENITH_HUB_SETUP_DIR||path.join(os.homedir(),'Library/Application Support/Zenith/Hub'));
const configured={setupRoot:root,...(flags['--data-dir']||process.env.ZENITH_HUB_DATA_DIR?{dataDir:flags['--data-dir']||process.env.ZENITH_HUB_DATA_DIR}:{}),...(flags['--resources-file']||process.env.ZENITH_HUB_RESOURCES_FILE?{resourcesFile:flags['--resources-file']||process.env.ZENITH_HUB_RESOURCES_FILE}:{}),...(process.env.ZENITH_HUB_ONTOLOGY_REGISTRY_FILE?{registryFile:process.env.ZENITH_HUB_ONTOLOGY_REGISTRY_FILE}:{})};
const print=value=>console.log(JSON.stringify(value,null,2));
const stamp=pid=>{const r=spawnSync('/bin/ps',['-p',String(pid),'-o','lstart=,comm='],{encoding:'utf8'});return r.status===0?r.stdout.trim():null;};
let server;
async function ready(options){await assertNoPendingMigration(root);const marker=await activation(root);if(marker){await assertActivatedStorage(marker);if(options.dataDir&&path.resolve(options.dataDir)!==marker.dataDir)throw Object.assign(Error('application_storage_configuration_changed'),{code:'application_storage_configuration_changed'});const config={...options,dataDir:marker.dataDir,resourcesFile:marker.resourcesFile};const app=await HubApplication.open(config);try{const catalog=await app.synchronizeCatalog();if(catalog.warning)print({phase:'catalog-last-good',...catalog});return {config,status:await app.status()};}finally{await app.close();}}
 const plan=await planMigration(options);if(plan.recoveryRequired)throw Object.assign(Error('migration_recovery_required'),{code:'migration_recovery_required',details:publicPlan(plan)});
 if(plan.summary.action==='migrate'&&!flags['--migrate'])throw Object.assign(Error('application_migration_required'),{code:'application_migration_required',details:{...publicPlan(plan),next:'Run db plan --plan <private-file>, then db apply --plan <private-file>. No UI server was started.'}});
 if(plan.blockers.length)throw Object.assign(Error('migration_blocked'),{code:'migration_blocked',details:publicPlan(plan)});
 print({phase:plan.summary.action,plan:publicPlan(plan)});return {config:plan.config,status:await applyMigration(plan.config,plan)};
}
async function stop(){const file=path.join(root,'server.json');let lease;try{lease=JSON.parse(await readPrivate(file,65536));}catch(e){if(e.code==='ENOENT'){print({running:false});return;}throw e;}
 if(lease.schema!=='zenith.hub-server.v1'||lease.source!==process.cwd()||!Number.isSafeInteger(lease.pid)||lease.pid<1)throw Error('unsafe_server_lease');
 const current=stamp(lease.pid);if(!current){await fs.unlink(file);print({running:false,staleLeaseRemoved:true});return;}if(current!==lease.processStamp)throw Error('server_process_identity_changed');
 process.kill(lease.pid,'SIGTERM');print({stopping:true,pid:lease.pid,port:lease.port});}
try {
 if(command==='stop'){await stop();}
 else if(command==='status'||command==='db status'){await assertNoPendingMigration(root);const marker=await activation(root);if(!marker){print({ready:false,migrationRequired:true,setupRoot:root});process.exitCode=2;}else{await assertActivatedStorage(marker);const app=await HubApplication.open({setupRoot:root,dataDir:marker.dataDir,resourcesFile:marker.resourcesFile,registryFile:configured.registryFile});try{print(await app.status());}finally{await app.close();}}}
 else if(command==='catalog sync'||command==='catalog status'){const marker=await activation(root);if(!marker)throw Error('application_database_not_initialized');const app=await HubApplication.open({setupRoot:root,dataDir:marker.dataDir,resourcesFile:marker.resourcesFile});try{print(command==='catalog sync'?await app.synchronizeCatalog():{...((await app.catalogService.committed())?.value?{state:'ready',version:(await app.catalogService.committed()).value.version,digest:(await app.catalogService.committed()).value.digest}:{state:'unavailable'}),lastAttempt:await app.catalogService.diagnostics()});}finally{await app.close();}}
 else if(command==='inventory'||command==='inspect'){await assertNoPendingMigration(root);const marker=await activation(root);if(!marker)throw Error('application_database_not_initialized');await assertActivatedStorage(marker);const app=await HubApplication.open({setupRoot:root,dataDir:marker.dataDir,resourcesFile:marker.resourcesFile});try{if(command==='inventory')print(await app.inventory.read());else{const status=await app.status(),inspected=await app.inventory.inspect({softwareRef:'urn:zenith:software:'+(flags['--software']||'hermes'),hostRef:status.hostRef});print(inspected);if(flags['--register'])print(await app.inventory.register(inspected.inspectionHandle));}}finally{await app.close();}}
 else if(command==='db plan'){const plan=await planMigration(configured);if(flags['--plan']){await privateDirectory(path.dirname(path.resolve(flags['--plan'])));await atomic(path.resolve(flags['--plan']),plan);}print(publicPlan(plan));if(plan.blockers.length)process.exitCode=2;}
 else if(command==='db apply'||command==='db recover'){let file=flags['--plan'];if(!file&&command==='db recover'){const journal=JSON.parse(await readPrivate(path.join(root,'application-migration.json')));file=journal.planFile;}if(!file)throw Error('A reviewed --plan file is required.');const plan=JSON.parse(await readPrivate(path.resolve(file),16*1024**2));print(await applyMigration(locations({...configured,...(!flags['--data-dir']?{dataDir:plan.config.dataDir}:{}),...(!flags['--resources-file']?{resourcesFile:plan.config.resourcesFile}:{})}),plan));}
 else if(command==='prepare'||command==='db init'){print({phase:'database-ready',...(await ready(configured)).status});}
 else if(command==='serve'){
  try{const lease=JSON.parse(await readPrivate(path.join(root,'server.json'),65536));if(stamp(lease.pid)===lease.processStamp)throw Object.assign(Error('hub_already_running'),{code:'hub_already_running'});}catch(e){if(e.code!=='ENOENT')throw e;}
  const {config,status}=await ready(configured),port=Number(flags['--port']||process.env.ZENITH_OPERATOR_PORT||4318);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid local port.');
  const leaseFile=path.join(root,'server.json');try{const old=JSON.parse(await readPrivate(leaseFile,65536));if(stamp(old.pid)===old.processStamp)throw Object.assign(Error('hub_already_running'),{code:'hub_already_running'});await fs.unlink(leaseFile);}catch(e){if(e.code!=='ENOENT')throw e;}
  const token=randomUUID(),lease={schema:'zenith.hub-server.v1',pid:process.pid,processStamp:stamp(process.pid),source:process.cwd(),port,serverInstanceId:token,repositoryId:status.repositoryId};
  const f=await fs.open(leaseFile,'wx',0o600);try{await f.writeFile(JSON.stringify(lease,null,2)+'\n');await f.sync();}finally{await f.close();}
  print({phase:'database-ready',...status,url:'http://127.0.0.1:'+port});
  const env={...process.env,ZENITH_HUB_CATALOG_READY:'1',ZENITH_HUB_APPLICATION_DB:'1',ZENITH_HUB_REPOSITORY_FOUNDATION:'1',ZENITH_HUB_SETUP_DIR:root,ZENITH_HUB_DATA_DIR:config.dataDir,ZENITH_HUB_RESOURCES_FILE:config.resourcesFile,ZENITH_HUB_SERVER_INSTANCE:token,ZENITH_OPERATOR_PORT:String(port),ZENITH_PREVIEW_BUILD:flags['--production']?'0':'1',ZENITH_DEV_BUNDLER:'webpack',NEXT_TELEMETRY_DISABLED:'1'};
  server=spawn(process.execPath,['scripts/operator.mjs',...(flags['--production']?['--production']:[])],{env,stdio:'inherit'});
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.kill(signal));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.once('exit',code=>{process.exitCode=code||0;resolve();});});
  const current=JSON.parse(await readPrivate(leaseFile,65536));if(current.serverInstanceId===token)await fs.unlink(leaseFile);
 }else throw Error('Use: hub [prepare|serve|stop|status|db plan|db apply|db recover|db status|catalog sync|catalog status] [--setup-dir PATH] [--data-dir PATH] [--resources-file FILE] [--port PORT] [--plan FILE] [--migrate] [--production]');
}catch(error){print({ready:false,error:error.code||error.message,details:error.details});process.exitCode=1;}
