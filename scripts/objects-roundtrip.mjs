/** Reproducible acceptance demonstration. Always uses new disposable stores. */
import {mkdtemp, realpath, rm, readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import jsonld from 'jsonld';
import {ObjectStore} from '../src/lib/objects/store.mjs';
import {loadOntologyRegistry, sha256} from '../src/lib/objects/registry.mjs';
const registry=await loadOntologyRegistry('profiles/object-store/registry.json');
const raw=await readFile('examples/objects/connected.jsonld','utf8');
const source=JSON.parse(raw), temporary=await mkdtemp(path.join(os.tmpdir(),'hub-rdf-roundtrip-')),root=await realpath(temporary);
const stores=[];
const open=name=>{const s=new ObjectStore({dataDir:path.join(root,name),registry});stores.push(s);return s;};
const canonical=document=>jsonld.canonize(document,{algorithm:'RDFC-1.0',safe:true,documentLoader:async url=>{
  if(!Object.hasOwn(registry.documents,url))throw Error('Unregistered context');
  return {contextUrl:null,documentUrl:url,document:registry.documents[url]};
}});
try {
  const first=open('first');await first.importDocument(raw,{importKey:'demo:first'});first.close();
  const reopened=open('first'), exported=await reopened.exportDocument(), second=open('second');
  await second.importDocument(exported,{importKey:'demo:second'});
  const output=await second.exportDocument();
  const expected=await canonical(source), afterRestart=await canonical(exported), afterReimport=await canonical(output);
  if(expected!==afterRestart || expected!==afterReimport)throw Error('RDF dataset changed');
  console.log(JSON.stringify({passed:true,algorithm:'RDFC-1.0',reopenedPersistentStore:true,freshStoreImport:true,
    objectCount:second.list().items.length,semanticSha256:sha256(afterReimport),
    contentByteSha256:sha256(raw),externalReferencePreserved:JSON.stringify(output).includes('https://example.org/configuration/not-imported')},null,2));
} finally {
  for(const store of stores)try{store.close();}catch{}
  await rm(root,{recursive:true,force:true});
}
