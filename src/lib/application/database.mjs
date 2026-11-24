/** Hub application owner: SQLite and versioned objects, with adapters for existing wire contracts. */
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {CatalogService} from '../catalog/service.mjs';
import {ApplicationInventory} from './inventory.mjs';
import {HubRepository} from '../objects/repository.mjs';
import {ApplicationCompiler,identity} from './compiler.mjs';
import {compileSetup,decodeSetup,compileResources,decodeResources,seedCatalog,validateSetup} from './model.mjs';
import {loadCatalog} from '../setup/catalog.mjs';
import {stableJSON} from '../objects/bundle.mjs';
import {sha256,reject} from '../objects/registry.mjs';
const same=(a,b)=>stableJSON(a)===stableJSON(b);

export class HubApplication {
 #queue=Promise.resolve();
 static async open(options){const repository=await HubRepository.open(options);if(repository.mode!=='foundation'){await repository.close();reject('application_migration_required',503);}return new HubApplication(repository,options);}
 constructor(repository,{setupRoot,resourcesFile,catalog,clock=Date.now,...options}={}) {this.repository=repository;repository.applicationOwned=true;this.root=setupRoot;this.resourcesFile=resourcesFile;this.catalog=catalog;this.clock=clock;this.legacyCatalogLaunch=!!options.env&&options.env.ZENITH_HUB_CATALOG_READY!=='1';this.catalogService=new CatalogService(this,options);this.inventory=new ApplicationInventory(this,options);}
 serialize(fn){const result=this.#queue.then(fn);this.#queue=result.catch(()=>{});return result;}
 async registry(){if(this.catalog)return this.catalog;const active=await this.catalogService.committed();if(active)return this.catalogService.bindingCatalog();if(this.legacyCatalogLaunch)return (await loadCatalog()).catalog;reject('catalog_unavailable',503);}
 async synchronizeCatalog(){return this.catalogService.synchronize();}
 async initialize({setup,resources,machineId}={}) {
  const initial=await this.serialize(async()=>{
   const read=await this.repository.applicationState();if(read.state.documents.some(d=>d.key==='setup'))return null;
   const compiler=new ApplicationCompiler(this.repository,read),hostRef=machineId||identity('host',this.repository.settingsId);
   const prior=read.validation.entries.get(read.validation.selected.get(hostRef));
   const label=prior?.node?.['http://www.w3.org/2000/01/rdf-schema#label']?.[0]?.['@value']||os.hostname();
   let candidate=null;if(!this.catalog){try{candidate=await this.catalogService.candidate();}catch(error){reject('catalog_unavailable',503,{cause:error.code||'catalog_update_failed'});}}const catalog=this.catalog||candidate.catalog;if(candidate){await compiler.typed('Host',{id:hostRef,label,kind:'physical'});await this.catalogService.compile(compiler,candidate);}else await seedCatalog(compiler,catalog,{id:hostRef,label,kind:'physical'});
   await compileSetup(compiler,setup,catalog,{hostRef,root:this.root});await compileResources(compiler,resources);
   compiler.document('application','application',{schema:'zenith.hub-application.v1',setupRoot:this.root,resourcesFile:this.resourcesFile||null,hostRef,catalogSha256:sha256(stableJSON(catalog))});
   await this.repository.commitBatch(await compiler.finish());return this.status();
  });
  if(!this.catalog)await this.synchronizeCatalog();return this.status();
 }
 async status(){const read=await this.repository.applicationState();const document=read.state.documents.find(d=>d.key==='application');if(!document)reject('application_database_not_initialized',503);if(document.value.setupRoot!==this.root)reject('application_root_mismatch',503);decodeSetup(read);decodeResources(read);if(!this.catalog&&!this.legacyCatalogLaunch&&!read.state.documents.some(d=>d.key==='catalog:active'))reject('catalog_unavailable',503);return {schema:'zenith.hub-database-status.v1',ready:true,storage:'sqlite',schemaVersion:5,repositoryId:read.state.repositoryId,generation:read.state.generation,definitionSetId:this.repository.definitionSetId,objects:read.state.selectedObjects.length,hostRef:document.value.hostRef,software:read.snapshot.softwareDescriptors.length,installations:read.snapshot.installations.length,profiles:read.snapshot.profiles.length,connections:read.snapshot.connections.length,operations:read.snapshot.operations.length,catalog:(()=>{const c=read.state.documents.find(d=>d.key==='catalog:active')?.value;return c?{state:'ready',version:c.version,digest:c.digest}:{state:this.legacyCatalogLaunch?'legacy-compatibility':'unavailable'};})()};}
 async readSetup(){return decodeSetup(await this.repository.applicationState());}
 async writeSetup(fn,options={}){return this.serialize(async()=>{
   const read=await this.repository.applicationState();if(options.expectedGeneration!==undefined&&options.expectedGeneration!==read.state.generation)reject('setup_plan_changed',409);const setup=decodeSetup(read),result=await fn(setup);setup.revision++;validateSetup(setup);
   const compiler=new ApplicationCompiler(this.repository,read);await compileSetup(compiler,setup,await this.registry(),{hostRef:read.snapshot.hub.localHostRef,root:this.root});if(options.retireReviewId)compiler.document('review:'+options.retireReviewId,'review-plan',{retired:true});await this.repository.commitBatch(await compiler.finish());return result;
 });}
 async readResources(){return decodeResources(await this.repository.applicationState());}
 async changeResources(action){return this.serialize(async()=>{
   const read=await this.repository.applicationState();if(action.expectedGeneration!==undefined&&action.expectedGeneration!==read.state.generation)reject('resource_registry_changed',409);const registry=decodeResources(read);
   if(action.expectedRevision!==undefined&&registry.revision!==action.expectedRevision)reject('resource_registry_changed',409);
   const at=registry.resources.findIndex(r=>r.id===action.resourceId);
   if(action.operation==='register'){if(at!==-1)reject('resource_already_registered',409);registry.resources.push(action.resource);}
   else if(action.operation==='set-enabled'){if(at===-1)reject('resource_not_registered',404);if(typeof action.enabled!=='boolean')reject('invalid_resource_action',400);if(registry.resources[at].enabled===action.enabled)return registry;registry.resources[at].enabled=action.enabled;}
   else if(action.operation==='forget'){if(at===-1)reject('resource_not_registered',404);registry.resources.splice(at,1);}
   else reject('invalid_resource_action',400);
   registry.revision++;const {validateRegistry}=await import('../resource-registry.mjs');validateRegistry(registry);
   const compiler=new ApplicationCompiler(this.repository,read);await compileResources(compiler,registry);await this.repository.commitBatch(await compiler.finish());return registry;
 });}
 async retainReview(compiler,key,plan,expectedGeneration){
  const id=identity('review-artifact',key),digest=sha256(stableJSON(plan));await compiler.typed('RetainedReview',{id,label:'Review '+String(plan.action||plan.kind||'Hub change'),documentDigest:digest},{persistRow:false});
  const current=compiler.read.state.selectedObjects.find(o=>o.objectId===id),changed=[...compiler.groups.values()].some(g=>g.members.has(id));
  compiler.document(key,'review-plan',{plan,expectedGeneration,artifactRef:{objectId:id,objectRevision:(current?.objectRevision||0)+(changed?1:0)}});
 }
 async readReview(key){const read=await this.repository.applicationState(),d=read.state.documents.find(v=>v.key===key);if(!d?.value.plan)return null;const {objectId,objectRevision}=d.value.artifactRef||{};const artifact=read.validation.entries.get(objectId+'|'+objectRevision)?.views.get('RetainedReview')?.value;if(!artifact||artifact.documentDigest!==sha256(stableJSON(d.value.plan)))reject('review_artifact_integrity',503);return {...d.value.plan,applicationGeneration:d.value.expectedGeneration};}
 async saveHubReview(id,value){return this.serialize(async()=>{const read=await this.repository.applicationState(),compiler=new ApplicationCompiler(this.repository,read),generation=read.state.generation+1;await this.retainReview(compiler,'review:hub:'+id,value,generation);const native=read.state.documents.find(d=>d.key==='review:'+id);if(native?.value.plan)compiler.document(native.key,'review-plan',{...native.value,expectedGeneration:generation});await this.repository.commitBatch(await compiler.finish());return generation;});}
 async getHubReview(id){return this.readReview('review:hub:'+id);}
 async retireHubReview(id){return this.serialize(async()=>{const read=await this.repository.applicationState(),d=read.state.documents.find(d=>d.key==='review:hub:'+id);if(d&&!d.value.retired){const c=new ApplicationCompiler(this.repository,read);c.document(d.key,'review-plan',{retired:true});await this.repository.commitBatch(await c.finish());}});}
 async saveReview(plan){return this.serialize(async()=>{const read=await this.repository.applicationState(),compiler=new ApplicationCompiler(this.repository,read);await this.retainReview(compiler,'review:'+plan.id,plan,read.state.generation+1);const result=await this.repository.commitBatch(await compiler.finish());return result.generation;});}
 async getReview(id){return this.readReview('review:'+id);}
 async deleteReview(id){return this.serialize(async()=>{const d=await this.repository.readApplicationDocument('review:'+id);if(!d)return;const read=await this.repository.applicationState(),compiler=new ApplicationCompiler(this.repository,read);compiler.document('review:'+id,'review-plan',{retired:true});await this.repository.commitBatch(await compiler.finish());});}
 async close(){await this.#queue;await this.repository.close();}
}
