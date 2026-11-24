/** One committed catalog view over HubRepository. No installer calls or independent database. */
import path from 'node:path';
import fs from 'node:fs/promises';
import {projectedValue} from '../objects/rdf-unit.mjs';
import {ApplicationCompiler,identity} from '../application/compiler.mjs';
import {readPackage,descriptorFor,sourceFor,CATALOG_ID} from './package.mjs';
import {sha256,reject} from '../objects/registry.mjs';
import {stableJSON} from '../objects/bundle.mjs';
import {atomic,readPrivate,privateDirectory} from '../setup/state.mjs';
const same=(a,b)=>stableJSON(a)===stableJSON(b),clean=({revision,objectVersion,types,...v})=>v;
const key=r=>r.objectId+'|'+r.objectRevision;
const versionCompare=(a,b)=>{const aa=a.split('.').map(Number),bb=b.split('.').map(Number);for(let i=0;i<Math.max(aa.length,bb.length);i++)if((aa[i]||0)!==(bb[i]||0))return (aa[i]||0)-(bb[i]||0);return 0;};
const catalogRow=(entry,candidate)=>{const meta=candidate.software.get(entry.softwareId).value;return {id:entry.entryId,catalogId:entry.catalogId,key:meta.key,softwareRef:meta.id,adapterRef:meta.key,supportedModes:[...new Set(entry.recipeIds.map(id=>candidate.recipes.get(id).body.mode))]};};
export class CatalogService {
 constructor(app,{catalogRoot=path.resolve('cms')}={}){this.app=app;this.directory=catalogRoot;this.diagnosticFile=path.join(app.root,'logs','catalog-sync.json');}
 candidate(){return readPackage(this.app.repository,{directory:this.directory});}
 async diagnostic(value){
  // A reporting file is not catalog authority. Failure to write it cannot undo a committed package.
  this.lastDiagnostic=value;
  try{let old;try{old=JSON.parse(await readPrivate(this.diagnosticFile));}catch(e){if(e.code!=='ENOENT')throw e;}if(same(old,value))return;await privateDirectory(path.dirname(this.diagnosticFile));await atomic(this.diagnosticFile,value);}
  catch{this.lastDiagnostic={...value,diagnosticWarning:'catalog_diagnostic_unavailable'};}
 }
 async diagnostics(){if(this.lastDiagnostic)return this.lastDiagnostic;try{return JSON.parse(await readPrivate(this.diagnosticFile));}catch(e){return e.code==='ENOENT'?null:{state:'unknown',diagnosticWarning:'catalog_diagnostic_unavailable'};}}
 async compile(compiler,candidate){
  const read=compiler.read,previous=read.state.documents.find(d=>d.key==='catalog:active')?.value,selected=new Map(read.state.selectedObjects.map(o=>[o.objectId,o.objectRevision]));
  if(previous){if(previous.packageId!==candidate.id||previous.catalogId!==candidate.catalogId)reject('catalog_identity_changed',409);for(const [id,ref]of Object.entries(previous.owned))if(selected.get(id)!==ref.objectRevision)reject('catalog_local_edit_conflict',409,{id});const prior=await readPackage(this.app.repository,{storedSources:previous.sources});for(const e of prior.entries){const row=read.snapshot.catalogEntries.find(r=>r.id===e.entryId);if(!row||!same(clean(row),catalogRow(e,prior)))reject('catalog_local_edit_conflict',409,{id:e.entryId});}if(previous.digest===candidate.digest)return null;if(versionCompare(candidate.version,previous.version)<=0)reject('catalog_package_version_not_new',409);}
  const owned={...(previous?.owned||{})},managed=new Set([candidate.id,...candidate.software.keys(),...candidate.recipes.keys(),...Object.keys(owned)]);
  for(const id of managed){const entry=read.validation.entries.get(read.validation.selected.get(id));if(entry&&entry.members.some(member=>!managed.has(member)))reject('catalog_shared_unit_conflict',409,{id});}
  const ref=id=>({objectId:id,objectRevision:(selected.get(id)||0)+([...compiler.groups.values()].some(g=>g.members.has(id))?1:0)});
  for(const [id,item]of candidate.software){const m=item.value,base={id,key:m.key,label:item.label,publisher:m.publisher,repository:m.repository},old=read.snapshot.softwareDescriptors.find(v=>v.id===id);
   if(!previous&&selected.has(id)){if(!old||!same(clean(old),base))reject('catalog_local_edit_conflict',409,{id});const entry=read.validation.entries.get(read.validation.selected.get(id)),actual=projectedValue(entry,this.app.repository.definitions.extensions.ownership.records.CatalogSoftwareMetadata,{value:m},entry.object.types,id);for(const field of Object.keys(actual))if(!same(actual[field],m[field]))reject('catalog_local_edit_conflict',409,{id});}
   await compiler.typed('SoftwareDescriptor',base);await compiler.typed('CatalogSoftwareMetadata',m,{persistRow:false});owned[id]=ref(id);
  }
  for(const [id,item]of candidate.recipes){const old=previous?.owned[id]&&read.validation.entries.get(key(previous.owned[id]))?.views.get('CatalogRecipe')?.value;
   if(old){const prior=JSON.parse(old.specJson);if(old.softwareRef!==item.value.softwareRef)reject('catalog_recipe_identity_changed',409,{id});if(old.specJson!==item.value.specJson&&versionCompare(item.body.version,prior.version)<=0)reject('catalog_recipe_version_not_new',409,{id});}
   else if(selected.has(id))reject('catalog_local_edit_conflict',409,{id});
   await compiler.typed('CatalogRecipe',item.value,{persistRow:false,references:[{field:'/softwareRef',targetRef:item.value.softwareRef,mode:'object-version',objectRevision:owned[item.value.softwareRef].objectRevision}]});owned[id]=ref(id);
  }
  if(!previous&&selected.has(candidate.id))reject('catalog_local_edit_conflict',409,{id:candidate.id});
  await compiler.typed('CatalogPackage',candidate.packageValue,{persistRow:false});owned[candidate.id]=ref(candidate.id);
  const knownEntries={...(previous?.knownEntries||{})};
  for(const entry of candidate.entries){const meta=candidate.software.get(entry.softwareId).value,value=catalogRow(entry,candidate);
   if(entry.catalogId===CATALOG_ID&&entry.entryId!==identity('catalog-entry',meta.key))reject('catalog_entry_identity_changed',409);
   const old=read.snapshot.catalogEntries.find(e=>e.id===value.id);if(!previous&&old&&!same(clean(old),value))reject('catalog_local_edit_conflict',409,{id:value.id});compiler.app('SoftwareCatalogEntry',value);knownEntries[entry.entryId]=entry;
  }
  for(const row of read.snapshot.catalogEntries.filter(e=>e.catalogId===candidate.catalogId&&!candidate.entries.some(c=>c.entryId===e.id)))if(row.supportedModes.length)compiler.app('SoftwareCatalogEntry',{...clean(row),supportedModes:[]});
  const value={schema:'zenith.hub-committed-catalog.v1',packageId:candidate.id,version:candidate.version,catalogId:candidate.catalogId,digest:candidate.digest,manifestSha256:candidate.manifestSha256,definitionManifestSha256:this.app.repository.definitions.extensions.manifestSha256,owned,knownEntries,sources:candidate.sources};
  compiler.document('catalog:active','application',value);return value;
 }
 async committed(read){read ||= await this.app.repository.applicationState();const value=read.state.documents.find(d=>d.key==='catalog:active')?.value;if(!value)return null;const candidate=await readPackage(this.app.repository,{storedSources:value.sources});
  if(candidate.digest!==value.digest||candidate.version!==value.version||value.definitionManifestSha256!==this.app.repository.definitions.extensions.manifestSha256)reject('catalog_snapshot_invalid',503);
  const view=(id,role)=>{const reference=value.owned[id],entry=reference&&read.validation.entries.get(key(reference)),v=entry?.views.get(role)?.value;if(!v)reject('catalog_snapshot_invalid',503);return v;};
  if(!same(view(value.packageId,'CatalogPackage'),candidate.packageValue))reject('catalog_snapshot_invalid',503);
  for(const [id,s]of candidate.software)if(!same(view(id,'CatalogSoftwareMetadata'),s.value)||view(id,'SoftwareDescriptor').label!==s.label)reject('catalog_snapshot_invalid',503);
  for(const [id,r]of candidate.recipes)if(!same(view(id,'CatalogRecipe'),r.value))reject('catalog_snapshot_invalid',503);
  // Membership projections are checked for local divergence during synchronization. Runtime
  // content remains the exact retained package, including when a local row edit blocks an update.
  return {value,candidate,read};
 }
 async registry(){const active=await this.committed();if(!active)reject('catalog_unavailable',503);const {value,candidate,read}=active,byId=new Map(candidate.catalog.components.map(c=>[c.id,c])),retainedById=new Map(),retainedRecipes=[];
  for(const [id,ref]of Object.entries(value.owned)){const entry=read.validation.entries.get(key(ref)),recipe=entry?.views.get('CatalogRecipe')?.value;if(recipe)retainedRecipes.push({value:recipe,body:JSON.parse(recipe.specJson)});const meta=entry?.views.get('CatalogSoftwareMetadata')?.value;if(meta){const previous=Object.values(value.knownEntries).find(e=>e.softwareId===id);retainedById.set(meta.key,descriptorFor(meta,previous,this.app.repository.definitions.extensions.contracts[meta.key].modes.map(mode=>({body:{mode}})),this.app.repository.definitions.extensions));}}
  return {catalog:candidate.catalog,sha256:value.digest,byId,retainedById,diagnostics:await this.diagnostics(),package:{id:value.packageId,version:value.version,digest:value.digest},resolveRecipe:(componentId,mode,action,recipeId,{allowRetired=false}={})=>{
   const entry=candidate.entries.find(e=>candidate.software.get(e.softwareId).value.key===componentId);const matches=r=>r.value.softwareRef==='urn:zenith:software:'+componentId&&(!recipeId||r.value.id===recipeId)&&r.body.mode===mode&&r.body.actions.includes(action);// An unqualified option must not shadow a qualified recipe covering the same action.
   // Explicit recipe selection is still enforced by matches and never substituted.
   const choose=list=>list.find(r=>matches(r)&&r.body.qualification==='supported')||list.find(matches);
   const recipe=choose(entry?.recipeIds.map(id=>candidate.recipes.get(id))||[])||(allowRetired?choose(retainedRecipes):null);if(!recipe)reject('catalog_recipe_unavailable',409);if(recipe.body.qualification!=='supported')reject('catalog_recipe_unqualified',409,{reason:recipe.body.qualificationReason});
   return {id:recipe.value.id,version:recipe.body.version,objectVersion:value.owned[recipe.value.id],sha256:sha256(recipe.value.specJson),softwareVersion:value.owned[recipe.value.softwareRef],source:sourceFor(componentId,this.app.repository.definitions.extensions),contract:recipe.body.contract,package:{id:value.packageId,version:value.version,digest:value.digest}};
  }};
 }
 async bindingCatalog(){const active=await this.committed();if(!active)reject('catalog_unavailable',503);const {value,read}=active,components=[];
  for(const [id,ref]of Object.entries(value.owned)){const e=read.validation.entries.get(key(ref)),meta=e?.views.get('CatalogSoftwareMetadata')?.value,base=e?.views.get('SoftwareDescriptor')?.value;if(!meta||!base)continue;const prior=Object.values(value.knownEntries).find(e=>e.softwareId===id);const modes=this.app.repository.definitions.extensions.contracts[meta.key].modes;components.push(descriptorFor(meta,{label:prior?.label||base.label,category:prior?.category||'work'},modes.map(mode=>({body:{mode}})),this.app.repository.definitions.extensions));}
  return {schema:'zenith.hub-component-catalog.v1',version:1,components};
 }
 async synchronize(){let candidate,publishing=false,priorDigest;try{candidate=await this.candidate();const result=await this.app.serialize(async()=>{const read=await this.app.repository.applicationState(),compiler=new ApplicationCompiler(this.app.repository,read),value=await this.compile(compiler,candidate);priorDigest=read.state.documents.find(d=>d.key==='catalog:active')?.value.digest;if(!value)return {changed:false,version:candidate.version,digest:candidate.digest,generation:read.state.generation};const batch=await compiler.finish();batch.idempotencyKey='catalog-'+sha256(candidate.digest+'|'+read.state.generation);publishing=true;const result=await this.app.repository.commitBatch(batch);return {changed:true,version:value.version,digest:value.digest,generation:result.generation};});await this.diagnostic({state:'ready',activeVersion:result.version,activeDigest:result.digest});return result;
  }catch(error){const read=await this.app.repository.applicationState(),active=read.state.documents.find(d=>d.key==='catalog:active')?.value,code=/^[a-z][a-z0-9_]{0,127}$/.test(error.code||'')?error.code:'catalog_update_failed';await this.diagnostic({state:active?'last-good':'unavailable',error:code,activeVersion:active?.version||null,activeDigest:active?.digest||null});if(!active)reject('catalog_unavailable',503,{cause:code});await this.committed(read);return {changed:publishing&&active.digest===candidate?.digest&&active.digest!==priorDigest,version:active.version,digest:active.digest,generation:read.state.generation,warning:code};}
 }
}
