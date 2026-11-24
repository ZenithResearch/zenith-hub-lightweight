/** Offline verification only: no service provisioning, network access or live stores. */
import {readFile,mkdtemp,realpath,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import jsonld from 'jsonld';
import {loadOntologyRegistry} from '../src/lib/objects/registry.mjs';
import {ObjectStore} from '../src/lib/objects/store.mjs';
import {exportBundle,importBundle} from '../src/lib/objects/bundle.mjs';
const registry=await loadOntologyRegistry('profiles/object-store/registry.json');
const base='profiles/object-store/ontology/infrastructure';
const example=JSON.parse(await readFile(base+'/examples/connected.jsonld','utf8')),projections=JSON.parse(await readFile(base+'/examples/projections.json','utf8'));
registry.validateDefinition('https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/domain.schema.json',JSON.parse(await readFile(base+'/domain.json','utf8')));
const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'hub-infrastructure-verify-'))),stores=[];
const open=name=>{const s=new ObjectStore({dataDir:path.join(root,name),registry});stores.push(s);return s;};
const canon=doc=>jsonld.canonize(doc,{algorithm:'RDFC-1.0',safe:true});
try {
 const first=open('first');await first.importDocument(example,{importKey:'verify',admission:'infrastructure',projections});const before=await first.exportDocument();first.close();
 const reopened=open('first'),bundle=await exportBundle(reopened),fresh=open('fresh');await importBundle(fresh,bundle,{importKey:'fresh',expectedBundleSha256:bundle.integrity.sha256});fresh.close();
 const final=open('fresh'),again=await exportBundle(final);assert.equal(await canon(before),await canon(again.dataset));assert.deepEqual(bundle.projections,again.projections);assert.deepEqual(bundle.admissions,again.admissions);
 console.log(JSON.stringify({passed:true,offline:true,verifiedModules:registry.moduleGraph.modules.size,infrastructureClasses:7,objectCount:final.list().items.length,
  persistedRestart:true,freshStoreImport:true,RDFC10Equivalent:true,portableBindingsEqual:true,callability:'not-established',authorization:'not-established'},null,2));
}finally{for(const s of stores)try{s.close();}catch{}await rm(root,{recursive:true,force:true});}
