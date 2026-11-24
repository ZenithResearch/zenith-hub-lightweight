/** Software inventory/inspection facades. A configured guide or reachable API is not installation evidence. */
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {readPrivate} from '../setup/state.mjs';
import {hermesInstallations} from '../setup/hermes-installations.mjs';
import {softwareFromHermesReceipt} from '../setup/hermes-receipt.mjs';
import {verifyHermesCopy,inspectionRelease} from './native-inspection.mjs';
import {ApplicationCompiler,identity,softwareId,unknown,timestamp} from './compiler.mjs';
import {compileSetup,decodeSetup} from './model.mjs';
import {presenceFromProof} from '../objects/inspections.mjs';
import {sha256,closed,reject} from '../objects/registry.mjs';
import {stableJSON} from '../objects/bundle.mjs';
export class ApplicationInventory {
 constructor(app,{env=process.env,release,candidateProvider,verifier=verifyHermesCopy}={}){this.app=app;this.env=env;this.release=release;this.candidateProvider=candidateProvider;this.verifier=verifier;this.bootId=randomUUID();this.candidates=new Map();this.handles=new Map();}
 async configure(){if(this.configured)return;this.release ||= await inspectionRelease();const status=await this.app.status();this.hostRef=status.hostRef;
  this.app.repository.configureInspection({inspectionHostRef:this.hostRef,inspectionAdapterDigest:this.release.digest,bootId:this.bootId,inspectSoftware:async({candidateHandle})=>{
   const item=this.candidates.get(candidateHandle);if(!item)return {state:'unknown',scope:{key:'configured',complete:false},fingerprint:{kind:'unavailable',reason:'candidate_handle_unknown'},reasons:['candidate_handle_unknown']};
   const facts=item.software?await this.verifier(item.software,{release:this.release}):item.facts;
   if(facts.state!=='present')return facts;
   if(item.facts.fingerprint.sha256!==facts.fingerprint.sha256)return {state:'unknown',scope:facts.scope,fingerprint:{kind:'unavailable',reason:'inspection_files_changed'},reasons:['inspection_files_changed']};
   return {...facts,...(item.sourceVersion?{sourceVersion:item.sourceVersion}:{})};
  }});this.configured=true;
 }
 async candidatesFor(setup){if(this.candidateProvider)return this.candidateProvider(setup);
  const result=[];
  for(const i of setup.instances.filter(i=>i.componentId==='hermes'&&i.mode==='install'&&/^[a-z][a-z0-9-]{0,47}$/.test(i.instanceId))){try{const root=path.join(this.app.root,'instances',i.instanceId);if(i.root!==root)continue;const receipt=JSON.parse(await readPrivate(path.join(root,'receipt.json')));if(receipt.componentId!=='hermes'||receipt.instanceId!==i.instanceId)continue;const software=await softwareFromHermesReceipt(root,receipt);result.push({id:sha256(software.source),instanceId:i.instanceId,software});}catch{}}
  try{const rows=await hermesInstallations({env:this.env,setupRoot:this.app.root}).discover({fresh:true});for(const r of rows)if(r.software&&!result.some(c=>c.software.source===r.software.source))result.push({id:r.id,software:r.software});}catch{}
  return result.slice(0,32);
 }
 async read(){const read=await this.app.repository.applicationState(),now=this.app.clock();const effectivePresence={};for(const i of read.snapshot.installations){const evidence=read.snapshot.inspectionRecords.find(r=>r.proof.id===i.presence.inspectionId)?.proof;effectivePresence[i.id]=evidence&&evidence.bootId===this.bootId&&Date.parse(evidence.validUntil)>now?evidence.state:'unknown';}const allowed=read.snapshot.installations.some(i=>i.softwareRef===softwareId('hermes')&&i.hostRef===read.snapshot.hub.localHostRef&&effectivePresence[i.id]==='present');return {schema:'zenith.hub.inventory.v2',generation:read.state.generation,validation:'committed-verified',entry:{allowed,reason:allowed?'verified-local-software':'presence-unknown'},next:null,softwareDescriptors:read.snapshot.softwareDescriptors,catalogEntries:read.snapshot.catalogEntries,installations:read.snapshot.installations,effectivePresence};}
 async inspect(input){closed(input,['softwareRef','hostRef'],['installationRef','candidateHandle','scopeHandle']);return this.app.serialize(async()=>{
  await this.configure();if(input.scopeHandle)reject('inspection_scope_unknown',422);if(input.hostRef!==this.hostRef)reject('local_inspection_host_mismatch',403);let read=await this.app.repository.applicationState();const descriptor=read.snapshot.softwareDescriptors.find(s=>s.id===input.softwareRef);if(!descriptor)reject('software_not_registered',404);
  let chosen,facts;
  if(descriptor.key==='hermes'){
   let candidates=await this.candidatesFor(decodeSetup(read));
   if(input.candidateHandle)candidates=candidates.filter(c=>c.id===input.candidateHandle||c.instanceId===input.candidateHandle);
   if(input.installationRef){const install=read.snapshot.installations.find(i=>i.id===input.installationRef);if(!install||install.softwareRef!==input.softwareRef)reject('inspection_subject_mismatch',422);candidates=candidates.filter(c=>c.software.source===install.locations.source);}
   for(const candidate of candidates){const inspected=await this.verifier(candidate.software,{release:this.release});chosen=candidate;facts=inspected;if(facts.state==='present')break;}
  }
  facts ||= {state:'unknown',scope:{key:'configured-software-locations',complete:false},fingerprint:{kind:'unavailable',reason:descriptor.key==='hermes'?'no_verified_copy_in_scope':'inspector_not_available'},reasons:[descriptor.key==='hermes'?'No verified local copy in the inspected scope.':'No native inspector is registered for this software.']};
  let sourceVersion,known;
  if(facts.state==='present'){
   const sourceId=identity('source-snapshot',input.softwareRef+'|'+facts.repository+'|'+facts.commit);
   const source=read.snapshot.sourceSnapshots.find(s=>s.id===sourceId);
   if(!source){const compiler=new ApplicationCompiler(this.app.repository,read);await compiler.typed('SoftwareSourceSnapshot',{id:sourceId,softwareRef:input.softwareRef,repository:facts.repository,commit:facts.commit});await this.app.repository.commitBatch(await compiler.finish());read=await this.app.repository.applicationState();}
   const id=identity('installed-version',input.softwareRef+'|'+input.hostRef+'|'+facts.copyIdentity+'|'+sourceId);
   known=read.snapshot.installations.find(i=>i.id===id);
   const pin=known&&read.state.referenceBindings.find(b=>b.ownerKind==='object'&&b.ownerRef===known.id&&b.ownerRevision===known.objectVersion.objectRevision&&b.field==='/sourceSnapshotRef');
   sourceVersion={objectId:sourceId,objectRevision:pin?.objectRevision||read.snapshot.sourceSnapshots.find(s=>s.id===sourceId).objectVersion.objectRevision};
  }
  const candidateHandle=randomBytes(24).toString('base64url');this.candidates.set(candidateHandle,{software:chosen?.software,facts,sourceVersion});
  const inspected=await this.app.repository.inspections.inspect({softwareRef:input.softwareRef,hostRef:input.hostRef,candidateHandle,...(known?{installationRef:known.id}:{})});
  this.handles.set(inspected.inspectionHandle,{...inspected,software:chosen?.software,instanceId:chosen?.instanceId,sourceVersion,facts,installationId:known?.id||identity('installed-version',input.softwareRef+'|'+input.hostRef+'|'+facts.copyIdentity+'|'+sourceVersion?.objectId),at:this.app.clock()});
  for(const [handle,record]of this.handles)if(this.app.clock()-record.at>=30000)this.handles.delete(handle);
  if(this.candidates.size>64)this.candidates.delete(this.candidates.keys().next().value);
  return {schema:'zenith.hub.inspection-response.v2',...inspected};
 });}
 async register(handle,{enterHub=false,expectedSetupRevision,instanceId}={}){return this.app.serialize(async()=>{
  const item=this.handles.get(handle);if(!item)reject('inspection_handle_unknown',409);if(item.proof.state!=='present')reject('hermes_installation_required',409);
  const fresh=await this.verifier(item.software,{release:this.release});if(fresh.state!=='present'||fresh.fingerprint.sha256!==item.proof.fingerprint.sha256)reject('inspection_files_changed',409);
  const read=await this.app.repository.applicationState(),setup=decodeSetup(read);if(expectedSetupRevision!==undefined&&setup.revision!==expectedSetupRevision)reject('setup_revision_changed',409);
  const existing=read.snapshot.installations.find(i=>i.id===item.installationId);if(existing&&item.proof.subject.kind==='candidate')reject('inspection_requires_refresh',409);
  const compiler=new ApplicationCompiler(this.app.repository,read),i={id:item.installationId,softwareRef:item.proof.softwareVersion.objectId,hostRef:this.hostRef,management:existing?.management||(item.instanceId?'hub-managed':'external'),locations:item.facts.locations,sourceSnapshotRef:item.sourceVersion.objectId,presence:existing?.presence||presenceFromProof(item.proof),compatibility:existing?.compatibility||unknown('Installation presence does not establish adapter or inference readiness.')};
  if(!existing)await compiler.typed('SoftwareInstallationRecord',i,{references:[{field:'/sourceSnapshotRef',targetRef:item.sourceVersion.objectId,mode:'object-version',objectRevision:item.sourceVersion.objectRevision}]});
  const overrides=new Map();for(const s of setup.instances)if(s.componentId==='hermes'&&s.mode==='install'&&(s.instanceId===item.instanceId||s.software?.source===i.locations.source)){s.software={...(s.software||{}),source:i.locations.source};overrides.set(s.instanceId,i);}
  if(enterHub){setup.welcomeEnteredAt=timestamp();if(instanceId){const target=setup.instances.find(s=>s.instanceId===instanceId&&s.componentId==='hermes');if(!target)reject('unknown_hermes_instance',404);target.welcomeEnteredAt=setup.welcomeEnteredAt;}}
  if(overrides.size||enterHub){setup.revision++;await compileSetup(compiler,setup,await this.app.registry(),{hostRef:this.hostRef,root:this.app.root,installationOverrides:overrides});}
  const batch=await compiler.finish(),write=this.app.repository.inspections.write(handle,{objectId:i.id,objectRevision:existing?.objectVersion.objectRevision||1});batch.inspectionWrites.push(write);await this.app.repository.commitBatch(batch);this.handles.delete(handle);return {installationRef:i.id,registered:true,...(enterHub?{entered:true}:{})};
 });}
 async enter({expectedRevision,instanceId}={}){const current=await this.app.readSetup();if(current.revision!==expectedRevision)reject('setup_revision_changed',409);const inspected=await this.inspect({softwareRef:softwareId('hermes'),hostRef:(await this.app.status()).hostRef,...(instanceId?{candidateHandle:instanceId}:{})});return this.register(inspected.inspectionHandle,{enterHub:true,expectedSetupRevision:expectedRevision,instanceId});}
}
