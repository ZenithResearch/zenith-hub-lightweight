/** Verify the built Next operator on an ephemeral port and disposable Hub database. */
import {spawn} from 'node:child_process';
import {mkdtemp, realpath, rm, readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import jsonld from 'jsonld';
import {loadOntologyRegistry} from '../src/lib/objects/registry.mjs';
const standalone = process.argv.includes('--standalone');
const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'hub-object-api-')));
const origin=`http://127.0.0.1:${port}`;
const env={...process.env,ZENITH_OPERATOR_PORT:String(port),ZENITH_OPERATOR_ORIGIN:origin,
  ZENITH_LOCAL_OPERATOR:'1',ZENITH_NATIVE_DEMO:'0',ZENITH_CONTAINER_DEMO:'0',ZENITH_PROCESS_PROFILE:'installation',
  ZENITH_PROCESS_ROOT:path.join(directory,'not-installed'),ZENITH_HUB_DATA_DIR:path.join(directory,'objects'),
  ZENITH_HUB_ONTOLOGY_REGISTRY_FILE:path.join(process.cwd(),'profiles/object-store/registry.json'),
  ZENITH_HUB_RESOURCES_FILE:'',NEXT_TELEMETRY_DISABLED:'1'};
if (standalone) {
  env.PORT=String(port); env.HOSTNAME='127.0.0.1';
  env.ZENITH_HUB_ONTOLOGY_REGISTRY_FILE=path.join(process.cwd(),'.next/standalone/profiles/object-store/registry.json');
}
const child=spawn(process.execPath,standalone?['.next/standalone/server.js']:['scripts/operator.mjs','--production'],{env,stdio:['ignore','pipe','pipe'],detached:true});
let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{logs=(logs+bytes.toString()).slice(-20000);});
async function read(query) {
  const response=await fetch(origin+'/api/objects?'+query,{signal:AbortSignal.timeout(3000)});
  const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;
}
try {
  let session;const deadline=Date.now()+40000;
  while(!session && Date.now()<deadline) {
    if(child.exitCode!==null)throw Error('Built operator exited');
    try{session=await read('operation=session');}catch{await new Promise(resolve=>setTimeout(resolve,200));}
  }
  assert.ok(session?.csrf,'Built object session unavailable');
  const document=JSON.parse(await readFile('examples/objects/connected.jsonld','utf8'));
  const response=await fetch(origin+'/api/objects',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Zenith-CSRF':session.csrf},
    body:JSON.stringify({schema:'zenith.hub-object-action.v1',operation:'import',importKey:'built-api-test',document}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.created.length,2);
  const exported=await fetch(origin+'/api/objects?operation=export');assert.equal(exported.headers.get('content-type'),'application/ld+json');
  const value=await exported.json();
  const registry=await loadOntologyRegistry(env.ZENITH_HUB_ONTOLOGY_REGISTRY_FILE);
  const canonical=doc=>jsonld.canonize(doc,{algorithm:'RDFC-1.0',safe:true,documentLoader:async url=>{
    if(!Object.hasOwn(registry.documents,url))throw Error('Unregistered test context');
    return {contextUrl:null,documentUrl:url,document:registry.documents[url]};
  }});
  assert.equal(await canonical(document),await canonical(value));
  const recognized=await read('operation=list');assert.equal(recognized.items.length,2);
  assert.ok(value.some(node=>node['@id']==='urn:hub:example:catalog'));
  const infraRoot='profiles/object-store/ontology/infrastructure/examples/';
  const infrastructure=JSON.parse(await readFile(infraRoot+'connected.jsonld','utf8'));
  const projections=JSON.parse(await readFile(infraRoot+'projections.json','utf8'));
  async function mutate(body) {
    const response=await fetch(origin+'/api/objects',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','X-Zenith-CSRF':session.csrf},
      body:JSON.stringify({schema:'zenith.hub-object-action.v1',...body}),signal:AbortSignal.timeout(20000)});
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
  }
  const added=await mutate({operation:'import',importKey:'built-infrastructure',document:infrastructure,projections,admission:'infrastructure'});
  assert.equal(added.created.length,20);
  const entities=await read('operation=list&type='+encodeURIComponent('https://zenith-research.ca/ontology/terms/Entity')+'&includeSubclasses=true');
  assert.equal(entities.items.length,6);
  const portable=await fetch(origin+'/api/objects?operation=export-bundle');
  assert.equal(portable.headers.get('content-type'),'application/vnd.zenith.hub-object-bundle+json');
  const bundle=await portable.json();assert.ok(Object.keys(bundle.projections).length>=20);
  await mutate({operation:'import-bundle',importKey:'built-portable',document:bundle,expectedBundleSha256:bundle.integrity.sha256});
  assert.equal((await mutate({operation:'import-bundle',importKey:'built-portable',document:bundle})).replayed,true);
  const denied=await fetch(origin+'/api/objects',{method:'POST',headers:{Origin:'https://invalid.example','Content-Type':'application/json'},body:'malformed JSON'});
  assert.equal(denied.status,403);
  console.log(JSON.stringify({passed:true,builtOperator:true,standalone,semanticRoundTrip:true,objectCount:22,infrastructureAdmission:true,subclassQuery:true,portableBindings:true,exportMediaType:'application/ld+json',crossOriginRejected:true}));
} catch(error) {console.error(logs);throw error;}
finally {
  child.kill('SIGTERM');
  if(child.exitCode===null)await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Test operator did not shut down; disposable data retained')),10000);
    child.once('exit',()=>{clearTimeout(timer);resolve();});
  });
  await rm(directory,{recursive:true,force:true});
}
