/** Bounded local package parser. Validation has no database or native execution effects. */
import path from 'node:path';
import {boundedFile,CONTEXT,A,C} from './definitions.mjs';
import {sha256,reject,absoluteIRI} from '../objects/registry.mjs';
import {stableJSON} from '../objects/bundle.mjs';
export const PACKAGE_ID='urn:zenith:hub:catalog-package:builtin';
export const CATALOG_ID='urn:zenith:hub:catalog:builtin-software';
const closed=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
const fail=(code,details)=>reject(code,422,details);
export function parseCSV(text,headers){
 if(Buffer.byteLength(text)>131072||text.includes('\0'))fail('catalog_csv_too_large');let rows=[],row=[],field='',quoted=false,ended=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;ended=true;}}else field+=c;continue;}
  if(ended&&c!==','&&c!=='\n'&&c!=='\r')fail('invalid_catalog_csv');
  if(c==='"'){if(field||ended)fail('invalid_catalog_csv');quoted=true;}else if(c===','){row.push(field);field='';ended=false;}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';ended=false;if(rows.length>129)fail('catalog_csv_too_large');}else field+=c;
 }
 if(quoted)fail('invalid_catalog_csv');if(field||row.length||ended){row.push(field);rows.push(row);}if(stableJSON(rows.shift())!==stableJSON(headers)||rows.some(r=>r.length!==headers.length))fail('invalid_catalog_csv_headers');
 return rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
}
function boundedJSON(bytes){let value;try{value=JSON.parse(bytes);}catch{fail('invalid_catalog_json');}const walk=(v,d=0)=>{if(d>24)fail('catalog_document_too_deep');if(v&&typeof v==='object')for(const x of Object.values(v))walk(x,d+1);};walk(value);return value;}
function readNode(bytes,role='CatalogPackage'){const d=boundedJSON(bytes),keys=['@context','@id','@type','rdfs:label',...(role==='CatalogSoftwareMetadata'?['rdfs:comment','cms:key','cms:publisher','cms:repository']:role==='CatalogRecipe'?['cms:software','cms:spec']:['cms:spec'])];if(!closed(d,keys)||stableJSON(d['@context'])!==stableJSON(CONTEXT)||d['@type']!=='zn:Artifact'||typeof d['@id']!=='string'||typeof d['rdfs:label']!=='string'||!d['rdfs:label']||d['rdfs:label'].length>512)fail('invalid_catalog_jsonld');for(const field of ['cms:repository','cms:software'])if(d[field]&&(!closed(d[field],['@id'])||typeof d[field]['@id']!=='string'))fail('invalid_catalog_jsonld');return d;}
function validVersion(version){if(version.length>64||version.split('.').length>8||version.split('.').some(v=>!Number.isSafeInteger(Number(v))))fail('invalid_catalog_version');}

function validateObjectIdentities(packageId,software,recipes){
 const roles=new Map();
 // These are separately authored objects. Repeated references and composed
 // SoftwareDescriptor/SoftwareMetadata profiles are not extra definitions.
 for(const [role,ids]of [['package',[packageId]],['software',software.keys()],['recipe',recipes.keys()]])for(const id of ids){
  if(roles.has(id))fail('catalog_object_identity_collision',{id,roles:[roles.get(id),role]});
  roles.set(id,role);
 }
}
function validateEntryActions(entry,recipes){
 const attached=entry.recipeIds.map(id=>recipes.get(id));
 for(const mode of new Set(attached.map(r=>r.body.mode))){
  const action=mode==='connect'?'connect':'install';
  // VPS remains an explicit unqualified legacy mode, hidden from Add resource.
  // Supported modes require a qualified entry recipe; supplementary recipes
  // may expose only configure/control actions without regaining install rights.
  const qualification=mode==='vps'?'unqualified':'supported';
  if(!attached.some(r=>r.body.mode===mode&&r.body.qualification===qualification&&r.body.actions.includes(action)))
   fail('catalog_entry_action_missing',{entryId:entry.entryId,mode,action});
 }
}

const fromNode=(role,d)=>role==='CatalogSoftwareMetadata'?{id:d['@id'],types:[A],key:d['cms:key'],publisher:d['cms:publisher'],repository:d['cms:repository']?.['@id'],description:d['rdfs:comment']}:{id:d['@id'],types:[A],label:d['rdfs:label'],...(role==='CatalogRecipe'?{softwareRef:d['cms:software']?.['@id']} :{}),specJson:d['cms:spec']};
export function sourceFor(key,extension){const c=extension.contracts[key];if(!c)fail('catalog_capability_unsupported');let version=c.source;
 if(c.sourceRef){const ref=extension.releaseFiles.get(c.sourceRef.path);if(!ref)fail('catalog_release_reference_invalid');const v=c.sourceRef.pointer.split('/').slice(1).reduce((v,k)=>v?.[k],ref.value);if(!v)fail('catalog_release_reference_invalid');version={...(v.source_commit||v.commit?{commit:v.source_commit||v.commit}:{}),...(c.sourceVersionLabel||v.version?{version:c.sourceVersionLabel||v.version}: {})};}
 return {repository:c.repository,...version};}
export function descriptorFor(meta,entry,recipes,extension){const c=extension.contracts[meta.key];if(!c)fail('catalog_capability_unsupported');if(meta.repository!=='https://github.com/'+c.repository)fail('catalog_repository_mismatch');const {repository,source,sourceRef,sourceVersionLabel,actions,...contract}=c;
 return {id:meta.key,label:entry.label,description:meta.description,category:entry.category,source:sourceFor(meta.key,extension),...contract,modes:[...new Set(recipes.map(r=>r.body.mode))]};}
export async function readPackage(repository,{directory=path.resolve('cms'),storedSources}={}){
 const read=async(file,max)=>{if(!storedSources)return boundedFile(path.join(directory,file),max);if(typeof storedSources[file]!=='string')fail('catalog_source_missing');const b=Buffer.from(storedSources[file]);if(b.length>max)fail('catalog_file_too_large');return b;};
 const ext=repository.definitions.extensions,rawManifest=await read('manifest.jsonld',524288),manifest=readNode(rawManifest),packageValue=fromNode('CatalogPackage',manifest),profile=repository.registry.profiles.get(ext.ownership.records.CatalogPackage.projection);
 if(!profile.validate(packageValue))fail('invalid_catalog_package');const body=JSON.parse(packageValue.specJson);validVersion(body.version);
 if(body.profiles.length!==1||body.profiles[0].path!=='profiles/catalog/manifest.json'||body.profiles[0].sha256!==ext.manifestSha256)fail('catalog_profile_pin_mismatch');
 const files=new Map(),sources={'manifest.jsonld':rawManifest.toString()},declared=new Set();let bytes=rawManifest.length;
 for(const f of body.files){if(!/^(catalog\.csv|recipes\.csv|(?:software|recipes)\/[a-z][a-z0-9-]{0,79}\.jsonld)$/.test(f.path)||declared.has(f.path))fail('unsafe_catalog_path');declared.add(f.path);const b=await read(f.path,524288);bytes+=b.length;if(bytes>3*1024**2)fail('catalog_package_too_large');if(sha256(b)!==f.sha256)fail('catalog_file_hash_mismatch',{path:f.path});files.set(f.path,b);sources[f.path]=b.toString();}
 if(!files.has('catalog.csv')||!files.has('recipes.csv'))fail('catalog_index_missing');
 const entries=parseCSV(files.get('catalog.csv').toString(),['entryId','catalogId','softwareId','softwarePath','label','category','position','recipeIds']),recipeRows=parseCSV(files.get('recipes.csv').toString(),['recipeId','softwareId','path']),software=new Map(),recipes=new Map(),used=new Set(['catalog.csv','recipes.csv']),entryIds=new Set(),catalogKeys=new Set();
 const validate=(role,v)=>{if(!repository.registry.profiles.get(ext.ownership.records[role].projection).validate(v))fail('invalid_catalog_profile',{role});};
 for(const e of entries){if(!absoluteIRI(e.entryId)||e.label.length>512||!Number.isSafeInteger(Number(e.position))||entryIds.has(e.entryId)||e.catalogId!==body.catalogId||!/^\d+$/.test(e.position)||!['work','communications'].includes(e.category)||!e.label)fail('invalid_catalog_entry');entryIds.add(e.entryId);e.position=Number(e.position);try{e.recipeIds=JSON.parse(e.recipeIds);}catch{fail('invalid_catalog_entry');}if(!Array.isArray(e.recipeIds)||new Set(e.recipeIds).size!==e.recipeIds.length||!e.recipeIds.length)fail('invalid_catalog_entry');
  if(!/^software\/[a-z][a-z0-9-]*\.jsonld$/.test(e.softwarePath)||!files.has(e.softwarePath))fail('catalog_reference_missing');const d=readNode(files.get(e.softwarePath),'CatalogSoftwareMetadata'),meta=fromNode('CatalogSoftwareMetadata',d);validate('CatalogSoftwareMetadata',meta);
  if(meta.id!==e.softwareId||meta.id!=='urn:zenith:software:'+meta.key)fail('catalog_software_identity_mismatch');const key=e.catalogId+'|'+meta.key;if(catalogKeys.has(key))fail('duplicate_catalog_membership');catalogKeys.add(key);
  const existing=software.get(meta.id);if(existing&&existing.path!==e.softwarePath)fail('duplicate_software_identity');software.set(meta.id,{value:meta,label:d['rdfs:label'],document:d,path:e.softwarePath});used.add(e.softwarePath);
 }
 for(const r of recipeRows){if(recipes.has(r.recipeId)||!software.has(r.softwareId)||!/^recipes\/[a-z][a-z0-9-]*\.jsonld$/.test(r.path)||!files.has(r.path))fail('catalog_reference_missing');const d=readNode(files.get(r.path),'CatalogRecipe'),v=fromNode('CatalogRecipe',d);validate('CatalogRecipe',v);if(v.id!==r.recipeId||v.softwareRef!==r.softwareId)fail('catalog_recipe_identity_mismatch');const spec=JSON.parse(v.specJson);validVersion(spec.version);const cap=ext.contracts[spec.capability];
  if(!cap||v.softwareRef!=='urn:zenith:software:'+spec.capability||!cap.modes.includes(spec.mode)||spec.contract.path!=='profiles/setup/component-contracts.json'||spec.contract.sha256!==ext.releaseFiles.get(spec.contract.path).sha256||spec.actions.some(a=>!(spec.mode==='connect'?['connect']:cap.actions).includes(a)))fail('catalog_recipe_capability_mismatch');
  if(spec.mode==='vps'&&spec.qualification!=='unqualified')fail('catalog_recipe_unqualified');recipes.set(v.id,{value:v,body:spec,document:d,path:r.path});used.add(r.path);
 }
 for(const e of entries)for(const id of e.recipeIds)if(!recipes.has(id)||recipes.get(id).value.softwareRef!==e.softwareId)fail('catalog_recipe_reference_mismatch');
 validateObjectIdentities(packageValue.id,software,recipes);
 for(const e of entries)validateEntryActions(e,recipes);
 if(used.size!==files.size)fail('catalog_unindexed_file');const catalog={schema:'zenith.hub-component-catalog.v1',version:1,components:entries.sort((a,b)=>a.position-b.position||a.entryId.localeCompare(b.entryId)).map(e=>descriptorFor(software.get(e.softwareId).value,e,e.recipeIds.map(id=>recipes.get(id)),ext))};
 if(sha256(await read('manifest.jsonld',524288))!==sha256(rawManifest))fail('catalog_source_changed');
 const validateCatalog=repository.definitions.ajv.compile(JSON.parse(ext.releaseFiles.get('profiles/setup/catalog.schema.json').bytes));if(!validateCatalog(catalog))fail('invalid_derived_catalog');
 return {id:manifest['@id'],version:body.version,catalogId:body.catalogId,digest:sha256(stableJSON({id:manifest['@id'],value:packageValue,sources})),manifestSha256:sha256(rawManifest),packageValue,manifest,entries,software,recipes,sources,catalog};
}
