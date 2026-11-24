/** Production HTTP qualification using only disposable setup and object data. */
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {createServer} from 'node:net';import {spawn} from 'node:child_process';
import {ObjectStore} from '../src/lib/objects/store.mjs';import {loadOntologyRegistry,sha256} from '../src/lib/objects/registry.mjs';
const repo=process.cwd(),standalone=process.argv.includes('--standalone');
const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'hub-api-')));await chmod(root,0o700);
const setupRoot=path.join(root,'setup');await mkdir(setupRoot,{mode:0o700});
const stateFile=path.join(setupRoot,'setup.json');
await writeFile(stateFile,JSON.stringify({schema:'zenith.hub-setup-state.v1',revision:1,step:'welcome',selection:[{instanceId:'saved-draft',componentId:'process-runtime',mode:'install',config:{port:19292}}],instances:[{instanceId:'existing',componentId:'devgraph',mode:'connect',enabled:false,config:{endpoint:'http://127.0.0.1:65221',label:'Existing fixture'}}],operations:{}}),{mode:0o600});
const before=sha256(await readFile(stateFile));
const dataDir=path.join(root,'objects'),store=new ObjectStore({dataDir,registry:await loadOntologyRegistry('profiles/object-store/registry.json')});
await store.importDocument({'@id':'urn:fixture:unrelated','@type':'https://zenith-research.ca/ontology/terms/Artifact'},{importKey:'fixture'});store.close();
const listener=createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const origin='http://127.0.0.1:'+port,env={...process.env,PORT:String(port),HOSTNAME:'127.0.0.1',ZENITH_LOCAL_OPERATOR:'1',ZENITH_GUIDED_SETUP:'1',ZENITH_OPERATOR_ORIGIN:origin,ZENITH_HUB_SETUP_DIR:setupRoot,ZENITH_HUB_DATA_DIR:dataDir,NEXT_TELEMETRY_DISABLED:'1'};
for(const key of ['ZENITH_NATIVE_DEMO','ZENITH_CONTAINER_DEMO','ZENITH_PROCESS_PROFILE','ZENITH_HUB_RESOURCES_FILE'])delete env[key];
const child=spawn(process.execPath,standalone?['server.js']:['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port',String(port)],{cwd:standalone?path.join(repo,'.next/standalone'):repo,env,stdio:['ignore','pipe','pipe'],detached:true});
let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-1000);});child.stdout.on('data',()=>{});
async function read(route){const response=await fetch(origin+route,{signal:AbortSignal.timeout(10000)});const value=await response.json();assert.equal(response.status,200,value.error||'HTTP failure');return value;}
try {
 let overview;
 for(let attempt=0;attempt<100;attempt++){try{overview=await read('/api/hub');break;}catch(e){if(child.exitCode!==null)throw Error('server exited: '+stderr);if(attempt===99)throw e;await new Promise(r=>setTimeout(r,200));}}
 assert.equal(overview.schema,'zenith.hub-overview.v1');assert.deepEqual(overview.warnings,[]);assert.equal(overview.resources.length,1);assert.equal(overview.resources[0].status,'Disconnected');
 assert.equal((await read('/api/objects?operation=list')).items[0].id,'urn:fixture:unrelated');
 assert.equal(Object.hasOwn(overview,'graph'),false);
 const post=async body=>{const response=await fetch(origin+'/api/hub',{method:'POST',headers:{origin,'content-type':'application/json','x-zenith-csrf':overview.csrf},body:JSON.stringify({schema:'zenith.hub-action.v1',...body})});const value=await response.json();assert.equal(response.status,200,value.error||'POST failure');return value;};
 const review=await post({operation:'plan-add',componentId:'devgraph',instanceId:'review-only',mode:'connect',config:{label:'Review only',endpoint:'http://127.0.0.1:65222'},expectedRevision:1});
 assert.equal(review.plan.action,'connect');await post({operation:'cancel',planId:review.plan.id});
 assert.equal(sha256(await readFile(stateFile)),before);assert.equal((await read('/api/objects?operation=get&id=urn:fixture:unrelated')).revision,1);
 console.log('Hub API '+(standalone?'standalone':'production')+' passed: gallery reads, reviewed Add/cancel, unrelated objects and setup/draft bytes preserved.');
} finally {
 try{process.kill(-child.pid,'SIGTERM');}catch{}
 await new Promise(resolve=>{const t=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}resolve();},3000);child.once('exit',()=>{clearTimeout(t);resolve();});if(child.exitCode!==null){clearTimeout(t);resolve();}});
 await rm(root,{recursive:true,force:true});
}
