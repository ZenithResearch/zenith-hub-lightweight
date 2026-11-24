/** Release-owned extension profiles. Content cannot choose definitions, adapters or loaders. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {sha256,reject} from '../objects/registry.mjs';
import {stableJSON} from '../objects/bundle.mjs';
import {CATALOG_DEFINITIONS_SHA256} from './pin.mjs';
export const C='urn:zenith:hub:catalog:';
export const A='https://zenith-research.ca/ontology/terms/Artifact';
export const CONTEXT={zn:'https://zenith-research.ca/ontology/terms/',cms:C,rdfs:'http://www.w3.org/2000/01/rdf-schema#'};
export async function boundedFile(file,max=8*1024**2){
 for(let p=path.resolve(file);;p=path.dirname(p)){const s=await fs.lstat(p);if(s.isSymbolicLink())reject('unsafe_catalog_path',422);if(path.dirname(p)===p)break;}
 const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>max)reject('catalog_file_too_large',422);const bytes=await fs.readFile(file);if(bytes.length!==stat.size)reject('catalog_source_changed',409);return bytes;
}
export async function loadCatalogDefinitions({registry,ajv,baseOwnership}) {
 const directory=path.resolve('profiles/catalog'),manifestBytes=await boundedFile(path.join(directory,'manifest.json'));
 if(sha256(manifestBytes)!==CATALOG_DEFINITIONS_SHA256)reject('catalog_definitions_untrusted',503);
 const manifest=JSON.parse(manifestBytes),assets=new Map(),resources=new Map(),releaseFiles=new Map();
 const add=(kind,id,bytes)=>resources.set(kind+'|'+id,{kind,id,bytes});
 for(const f of manifest.files){if(path.basename(f.path)!==f.path)reject('unsafe_catalog_definition',503);const b=await boundedFile(path.join(directory,f.path));if(sha256(b)!==f.sha256)reject('catalog_definitions_untrusted',503);assets.set(f.path,b);}
 for(const f of manifest.releaseFiles){if(!/^profiles\/[a-zA-Z0-9_./-]+\.json$/.test(f.path)||f.path.split('/').includes('..'))reject('unsafe_catalog_definition',503);const b=await boundedFile(path.resolve(f.path));if(sha256(b)!==f.sha256)reject('catalog_release_pin_mismatch',503);releaseFiles.set(f.path,{...f,bytes:b,value:JSON.parse(b)});}
 for(const contract of Object.values(releaseFiles.get('profiles/setup/component-contracts.json').value.components))for(const artifact of contract.artifacts){if(artifact.manifest&&releaseFiles.get('profiles/setup/'+artifact.manifest)?.sha256!==artifact.manifestSha256)reject('catalog_release_reference_mismatch',503);if(artifact.preparationManifest&&releaseFiles.get('profiles/setup/'+artifact.preparationManifest)?.sha256!==artifact.preparationSha256)reject('catalog_release_reference_mismatch',503);if(artifact.lock){const lock=releaseFiles.get('profiles/setup/'+artifact.lock)?.value;if(!lock||artifact.files.some(name=>!lock.groups[artifact.group]?.some(f=>f.filename===name)))reject('catalog_release_reference_mismatch',503);if(artifact.sourceSha256&&releaseFiles.get('profiles/setup/matrix-build.json').value.source.sha256!==artifact.sourceSha256)reject('catalog_release_reference_mismatch',503);}}
 const schema=JSON.parse(assets.get('schema.json')),ownership=JSON.parse(assets.get('field-ownership.json'));
 // The extension may reuse base roles, but cannot silently redefine the established ABI.
 for(const [role,m]of Object.entries(baseOwnership.records))if(stableJSON(m)!==stableJSON(ownership.records[role]))reject('catalog_base_mapping_changed',503);
 ajv.addSchema(schema);registry.documents[schema.$id]=schema;registry.hashes[schema.$id]=sha256(assets.get('schema.json'));registry.sizes[schema.$id]=assets.get('schema.json').length;
 add('json-schema',schema.$id,assets.get('schema.json'));add('field-mapping',ownership.id,assets.get('field-ownership.json'));add('ontology-module',ownership.relationsId,assets.get('properties.jsonld'));add('package-manifest',manifest.id,manifestBytes);
 for(const asset of releaseFiles.values())add('package-manifest','urn:zenith:hub:release-file:'+asset.sha256,asset.bytes);
 const validators={};for(const name of ['RecipeBody','PackageBody'])validators[name]=ajv.compile({$ref:schema.$id+'#/$defs/'+name});
 for(const role of ownership.extensionRoles){const m=ownership.records[role],validateProfile=ajv.compile({$ref:m.projection});
  const validate=value=>{if(!validateProfile(value))return false;if(!value.specJson)return true;try{const body=JSON.parse(value.specJson);return stableJSON(body)===value.specJson&&validators[role==='CatalogRecipe'?'RecipeBody':'PackageBody'](body);}catch{return false;}};
  registry.profiles.set(m.projection,{id:m.projection,representation:'projection',appliesTo:[m.appliesTo],includeSubclasses:true,identityField:'id',typesField:'types',validate});add('json-schema',m.projection,assets.get('schema.json'));
 }
 return {manifest,manifestBytes,manifestSha256:sha256(manifestBytes),assets,resources,schema,ownership,releaseFiles,validators,contracts:releaseFiles.get('profiles/setup/component-contracts.json').value.components};
}
