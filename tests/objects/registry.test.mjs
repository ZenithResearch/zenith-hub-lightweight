import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, rm, cp, readFile, writeFile, mkdir, symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {loadOntologyRegistry, sha256} from '../../src/lib/objects/registry.mjs';
import {ObjectStore} from '../../src/lib/objects/store.mjs';
const Z='https://zenith-research.ca/ontology/terms/';
async function fixture(t) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'hub-ontology-test-')), root=await realpath(directory);
  t.after(()=>rm(root,{recursive:true,force:true}));
  await cp('profiles/object-store',root,{recursive:true});
  const file=path.join(root,'registry.json');
  return {root,file,config:JSON.parse(await readFile(file,'utf8'))};
}
test('a $defs-only document is not accepted as a profile admission schema',async t=>{
  const {file,config}=await fixture(t);
  config.profiles[0].id=config.profiles[0].id.split('#')[0];
  await writeFile(file,JSON.stringify(config));
  await assert.rejects(loadOntologyRegistry(file),{code:'definition_only_schema'});
});
test('pinned ontology changes and symlinked resources are rejected',async t=>{
  const {root,file}=await fixture(t);
  const schema=path.join(root,'ontology/zenith-0.1.0/schemas/core.schema.json');
  await writeFile(schema,'{}');
  await assert.rejects(loadOntologyRegistry(file),{code:'ontology_resource_changed'});
  await rm(schema); await symlink('/etc/passwd',schema);
  await assert.rejects(loadOntologyRegistry(file),{code:'unsafe_ontology_resource'});
});
test('owner-registered expanded-node profiles validate actual JSON-LD nodes using existing ontology terms',async t=>{
  const {root,file,config}=await fixture(t), url='urn:hub:profile:artifact-admission';
  // Application validation shape only. It introduces no ontology classes or properties.
  const schema={$schema:'https://json-schema.org/draft/2020-12/schema',$id:url,type:'object',
    required:['@id','@type','http://www.w3.org/2000/01/rdf-schema#label']};
  const content=JSON.stringify(schema);await writeFile(path.join(root,'admission.json'),content);
  config.resources.push({url,path:'admission.json',sha256:sha256(content)});
  config.profiles.push({id:url,representation:'expanded-node',appliesTo:[Z+'Artifact']});
  await writeFile(file,JSON.stringify(config));
  const registry=await loadOntologyRegistry(file), store=new ObjectStore({memory:true,registry});
  t.after(()=>store.close());
  await assert.rejects(store.importDocument({'@id':'urn:artifact','@type':Z+'Artifact'},{importKey:'invalid'}),{code:'schema_validation_failed'});
  assert.equal(store.list().items.length,0);
  await store.importDocument({'@id':'urn:artifact','@type':Z+'Artifact','http://www.w3.org/2000/01/rdf-schema#label':'Valid'},{importKey:'valid'});
  assert.equal(store.list().items.length,1);
});
