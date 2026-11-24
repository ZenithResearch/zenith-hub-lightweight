/** Owner-selected application definitions. Never resolve schema paths supplied by an object. */
import fs from 'node:fs/promises';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {loadOntologyRegistry,sha256,reject} from './registry.mjs';
import {APPLICATION_MANIFEST_SHA256} from './application-pin.mjs';
export async function loadApplicationDefinitions({registryFile=path.resolve('profiles/object-store/registry.json'),directory=path.resolve('profiles/application-db')}={}) {
  const registry=await loadOntologyRegistry(registryFile),resources=new Map(),assets=new Map();
  async function read(file,expected){for(let p=file;;p=path.dirname(p)){if((await fs.lstat(p)).isSymbolicLink())reject('unsafe_definition_path',503);if(path.dirname(p)===p)break;}const b=await fs.readFile(file);if(b.length>5*1024**2||expected&&sha256(b)!==expected)reject('definition_untrusted',503);return b;}
  const manifestBytes=await read(path.join(directory,'manifest.json'),APPLICATION_MANIFEST_SHA256),manifest=JSON.parse(manifestBytes);
  for(const asset of manifest.files){if(path.basename(asset.path)!==asset.path)reject('unsafe_definition_path',503);assets.set(asset.path,await read(path.join(directory,asset.path),asset.sha256));}
  const schema=JSON.parse(assets.get('schema.json')),ownership=JSON.parse(assets.get('field-ownership.json')),commitSchema=JSON.parse(assets.get('commit.schema.json')),referencePolicy=JSON.parse(assets.get('reference-policy.json'));
  const ajv=addFormats(new Ajv2020({allErrors:true,strictSchema:true,strictTypes:false,allowUnionTypes:true}));
  for(const doc of Object.values(registry.documents))if(doc.$id&&doc.$schema&&!ajv.getSchema(doc.$id))ajv.addSchema(doc);
  for(const [name,b]of assets)if(name.endsWith('.json')||name.endsWith('.jsonld')){const doc=JSON.parse(b);if(doc.$schema&&doc.$id){ajv.addSchema(doc);registry.documents[doc.$id]=doc;registry.hashes[doc.$id]=sha256(b);registry.sizes[doc.$id]=b.length;}}
  for(const m of Object.values(ownership.records))registry.profiles.set(m.projection,{id:m.projection,representation:'projection',appliesTo:[m.appliesTo],includeSubclasses:m.includeSubclasses,identityField:'id',typesField:'types',validate:ajv.compile({$ref:m.projection})});
  const add=(kind,id,bytes)=>resources.set(kind+'|'+id,{kind,id,bytes});
  const baseConfig=JSON.parse(await fs.readFile(registryFile,'utf8'));
  for(const pkg of baseConfig.packages){const base=path.resolve(path.dirname(registryFile),pkg.directory),b=await read(path.join(base,'manifest.json'),pkg.manifestSha256),m=JSON.parse(b);add('package-manifest',m.ontologyId,b);
    for(const asset of m.files){const bytes=await read(path.join(base,asset.path),asset.sha256);if(!/\.(json|jsonld)$/.test(asset.path))continue;const doc=JSON.parse(bytes);if(doc.$id&&doc.$schema)add('json-schema',doc.$id,bytes);for(const declaration of m.ontologyDocuments.filter(d=>d.path===asset.path))add('ontology-module',declaration.versionIri,bytes);}
  }
  for(const [name,b]of assets){if(name.endsWith('.sql'))continue;const doc=JSON.parse(b);if(doc.$schema&&doc.$id)add('json-schema',doc.$id,b);if(name==='field-ownership.json')add('field-mapping',ownership.id,b);if(name==='application-relations.jsonld')add('ontology-module',doc['@graph'].find(n=>n['@type']==='owl:Ontology')['@id'],b);}
  add('package-manifest',manifest.id,manifestBytes);
  for(const p of registry.profiles.values()){const base=resources.get('json-schema|'+p.id.split('#')[0]);if(base)add('json-schema',p.id,base.bytes);}
  const core='https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/core.schema.json';add('json-schema',core+'#/$defs/ArtifactRef',resources.get('json-schema|'+core).bytes);
  add('json-schema',schema.$id+'#/$defs/ProfileBindingsFile',assets.get('schema.json'));
  const extensions=await (await import('../catalog/definitions.mjs')).loadCatalogDefinitions({registry,ajv,baseOwnership:ownership});
  return {extensions,registry,resources,assets,schema,ownership,commitSchema,referencePolicy,manifest,manifestBytes,manifestSha256:sha256(manifestBytes),definitionSetId:manifest.id,ajv,
    validateBatch:ajv.compile({$ref:commitSchema.$id}),validateSnapshot:ajv.compile({$ref:schema.$id}),validateBindings:ajv.compile({$ref:schema.$id+'#/$defs/ProfileBindingsFile'})};
}
