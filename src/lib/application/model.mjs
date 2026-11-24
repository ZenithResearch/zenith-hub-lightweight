/** Semantic fields have one authority. Compatibility documents retain only application/native bindings. */
import path from 'node:path';
import {validateMatrixBinding} from '../setup/matrix-contract.mjs';
import {recordGroups} from '../objects/application-rows.mjs';
import {identity,softwareId,unknown,timestamp} from './compiler.mjs';
import {reject} from '../objects/registry.mjs';
import {serviceEndpoint} from '../setup/connections.mjs';
const clean=v=>JSON.parse(JSON.stringify(v));
const row=(read,group,id)=>read.snapshot[group].find(v=>v.id===id);
const repoURL=s=>s?.startsWith('https://')?s:'https://github.com/'+s;
const safeTime=s=>Number.isFinite(Date.parse(s))?s:timestamp();
export const emptySetup=()=>({schema:'zenith.hub-setup-state.v1',revision:0,step:'welcome',selection:[],instances:[],operations:{}});
export const emptyResources=()=>({schema:'zenith.hub-resources.v1',revision:1,resources:[]});
export function validateSetup(s) {
 if(s?.schema!=='zenith.hub-setup-state.v1'||!Number.isSafeInteger(s.revision)||s.revision<0||!Array.isArray(s.instances)||!Array.isArray(s.selection)||!s.operations||typeof s.operations!=='object'||Array.isArray(s.operations))reject('invalid_setup_state',422);
 for(const i of s.instances)if(i.matrix)validateMatrixBinding(i.matrix);
 if(new Set(s.instances.map(i=>i.instanceId)).size!==s.instances.length)reject('duplicate_setup_instance',422);
 return s;
}
export async function seedCatalog(compiler,catalog,host) {
 await compiler.typed('Host',host);
 for(const item of catalog.components){
  const software={id:softwareId(item.id),key:item.id,label:item.id==='hermes'?'Hermes':item.label,...(item.source?.repository?{repository:repoURL(item.source.repository),publisher:item.source.repository.split('/')[0]}:{})};
  await compiler.typed('SoftwareDescriptor',software);
  compiler.app('SoftwareCatalogEntry',{id:identity('catalog-entry',item.id),catalogId:'urn:zenith:hub:catalog:builtin-software',key:item.id,softwareRef:software.id,adapterRef:item.id,supportedModes:item.modes});
 }
}
export async function compileSetup(compiler,setup,catalog,{hostRef,root,installationOverrides=new Map()}) {
 validateSetup(setup);const payload=clean(setup),bindings=[];
 for(const i of payload.instances){
  const descriptor=catalog.components.find(c=>c.id===i.componentId);if(!descriptor)reject('unknown_component',422);
  const refs={software:softwareId(i.componentId),configLabel:Object.hasOwn(i.config||{},'label'),enabledPresent:Object.hasOwn(i,'enabled'),profileName:Object.hasOwn(i.profile||{},'name'),profileHome:Object.hasOwn(i.profile||{},'home'),configurationHome:Object.hasOwn(i,'configurationHome')},config=i.config||{},endpoint=serviceEndpoint(i),local=i.mode==='install';
  let installationRef;
  const source=typeof i.software?.source==='string'&&path.isAbsolute(i.software.source)?i.software.source:null;
  if(local&&source){
   const previous=compiler.read.state.documents.find(d=>d.key==='setup')?.value.instances.find(x=>x.instanceId===i.instanceId),old=previous?.databaseRefs?.installation&&row(compiler.read,'installations',previous.databaseRefs.installation),override=installationOverrides.get(i.instanceId);
   installationRef=override?.id||(old&&old.locations.source===source&&previous.source?.commit===i.source?.commit?old.id:identity('installation',refs.software+'|'+source+'|'+(i.source?.commit||'unknown')));refs.installation=installationRef;
   const prior=row(compiler.read,'installations',installationRef);
   if(!installationOverrides.has(i.instanceId))await compiler.typed('SoftwareInstallationRecord',{id:installationRef,softwareRef:refs.software,hostRef,management:prior?.management||'hub-managed',locations:prior?.locations||{source},...(prior?.sourceSnapshotRef?{sourceSnapshotRef:prior.sourceSnapshotRef}:{}),...(prior?.buildRef?{buildRef:prior.buildRef}:{}),presence:prior?.presence||unknown('Legacy registration is not fresh inspection evidence.'),compatibility:prior?.compatibility||unknown('Adapter qualification is independent of installation presence.')});
   const {source:ignored,...nativeSoftware}=i.software;i.software=nativeSoftware; // Reconstructed from the selected installation description, not a second semantic owner.
  }
  if(local&&i.componentId==='matrix'&&i.software?.environment&&i.software?.copyId){
   const native=i.software,build=native.build,buildId=build?identity('build',refs.software+'|'+build.content.sha256+'|'+build.platform):null;
   if(buildId&&!row(compiler.read,'builds',buildId))await compiler.typed('SoftwareBuild',{id:buildId,softwareRef:refs.software,...build,content:{...build.content,id:buildId}});
   installationRef=identity('installation',refs.software+'|'+hostRef+'|'+native.copyId+'|'+(buildId||'unknown'));
   const prior=row(compiler.read,'installations',installationRef),priorPin=prior&&compiler.read.state.referenceBindings.find(b=>b.ownerKind==='object'&&b.ownerRef===installationRef&&b.ownerRevision===prior.objectVersion.objectRevision&&b.field==='/buildRef'&&b.targetRef===buildId),buildVersion=buildId?(priorPin?.objectRevision||row(compiler.read,'builds',buildId)?.objectVersion.objectRevision||1):null;
   await compiler.typed('SoftwareInstallationRecord',{id:installationRef,softwareRef:refs.software,hostRef,management:'hub-managed',locations:{environment:native.environment,launcher:native.launcher},...(buildId?{buildRef:buildId}:{}),presence:prior?.presence||unknown('Verified retained wheel closure and receipt; environment-wide presence inspection is not implemented.'),compatibility:prior?.compatibility||unknown('Matrix API and account authentication are separate checks.')}, {references:buildId?[{field:'/buildRef',targetRef:buildId,mode:'object-version',objectRevision:buildVersion}]:[]});
   refs.installation=installationRef;refs.installationLayout='environment';
  }
  const profileId=identity('profile',i.instanceId),nativeName=i.configurationHome?'default':i.profile?.name||i.instanceId,hermes=i.componentId==='hermes'&&typeof config.modelName==='string'&&!!config.modelName&&typeof config.providerId==='string'&&!!config.providerId;
  const profile={id:profileId,softwareRef:refs.software,...(installationRef?{installationRef}:{}),name:nativeName,profileKind:hermes?'hermes':'generic',...(path.isAbsolute(i.configurationHome||i.profile?.home||'')?{nativeHome:i.configurationHome||i.profile.home}:{}),...(config.secretRef?{credentialRefs:[config.secretRef]}:{}),...(hermes?{modelBinding:{providerId:config.providerId,modelName:config.modelName}}:{})};
  await compiler.typed(hermes?'HermesConfigurationProfile':'ConfigurationProfile',profile);refs.profile=profileId;
  if(hermes){delete config.providerId;delete config.modelName;}
  if(i.configurationHome)delete i.configurationHome;
  if(i.profile?.home)delete i.profile.home;if(i.profile?.name)delete i.profile.name;
  if(local&&descriptor.health!=='none'){
   const legacyId='urn:zenith:hub:instance:'+i.instanceId;const id=compiler.read.validation.selected.has(legacyId)?legacyId:identity('service',i.instanceId),prior=row(compiler.read,'services',id);
   await compiler.typed('ServiceInstance',{id,softwareRef:refs.software,...(installationRef?{installationRef}:{}),profileRef:profileId,label:config.label||descriptor.label,management:'hub-managed',desiredState:i.running===true?'running':'stopped',hostRefs:[hostRef],...(prior?.runtime?{runtime:prior.runtime}:{})});refs.service=id;delete config.label;
  }
  if(i.mode==='connect'&&endpoint){
   const id=identity('setup-connection',i.instanceId);
   compiler.app('Connection',{id,label:config.label||descriptor.label,targetRef:identity('external-service',i.componentId+'|'+endpoint),adapterRef:i.componentId,endpoint,enabled:i.enabled!==false,targetScope:'external-unresolved',...(config.secretRef?{credentialRef:config.secretRef}:{})});refs.connection=id;delete config.label;delete config.endpoint;delete i.enabled;
  }
  i.config=config;i.databaseRefs=refs;bindings.push({instanceId:i.instanceId,...refs});
 }
 const operations={};
 for(const [key,op]of Object.entries(payload.operations)){
  const id=identity('operation',key),targets=(op.instanceIds||[]).map(name=>{const i=bindings.find(i=>i.instanceId===name);return i?.service||i?.connection||i?.profile||hostRef;});
  const review=compiler.read.state.documents.find(d=>d.key==='review:'+key)?.value.artifactRef,previous=compiler.read.snapshot.operations.find(o=>o.id===id);
  compiler.app('SetupOperation',{id,...(review?{planArtifactRef:review.objectId}:previous?.planArtifactRef?{planArtifactRef:previous.planArtifactRef}:{}),action:op.action||'legacy-operation',targetRefs:[...new Set(targets.length?targets:[hostRef])],state:['reviewed','applying','complete','reconciliation-required','cancelled','retryable'].includes(op.state)?op.state:'reconciliation-required',createdAt:safeTime(op.createdAt||op.updatedAt),updatedAt:safeTime(op.updatedAt),...(op.errorCode?{error:{code:op.errorCode,...(op.error?{message:String(op.error)}:{})}}:{})},{references:review?[{field:'/planArtifactRef',targetRef:review.objectId,mode:'object-version',objectRevision:review.objectRevision}]:[]});
  const {action,state,createdAt,updatedAt,error,errorCode,...native}=op;operations[key]={...native,databaseRef:id,...(error&&!errorCode?{legacyError:error}:{}),...(createdAt?{createdAtPresent:true}:{})};
 }
 payload.operations=operations;
 const selected=bindings.find(i=>i.instanceId===setup.welcomeTargetId),selectedProfile=selected&&compiler.desired.find(r=>r.value.id===selected.profile&&r.role==='HermesConfigurationProfile');
 compiler.app('HubSettings',{id:compiler.repository.settingsId,label:compiler.read.snapshot.hub.label||'Hub',localHostRef:hostRef,...(selectedProfile?{selectedGuideProfileRef:selected.profile}:{}),...(setup.welcomeEnteredAt?{enteredAt:safeTime(setup.welcomeEnteredAt)}:{})});
 delete payload.welcomeEnteredAt;
 compiler.document('setup','setup',payload);return payload;
}
export function decodeSetup(read) {
 const document=read.state.documents.find(d=>d.key==='setup');if(!document)reject('application_setup_missing',503);
 const value=clean(document.value);
 for(const i of value.instances){const refs=i.databaseRefs;if(!refs)reject('application_binding_integrity',503);
  const profile=row(read,'profiles',refs.profile);if(!profile)reject('application_binding_integrity',503);
  const config=i.config||{};if(profile.profileKind==='hermes'){config.providerId=profile.modelBinding.providerId;config.modelName=profile.modelBinding.modelName;}
  if(refs.configurationHome&&profile.nativeHome)i.configurationHome=profile.nativeHome;
  if(i.profile){if(refs.profileHome&&profile.nativeHome)i.profile.home=profile.nativeHome;if(refs.profileName)i.profile.name=profile.name;}
  if(refs.installation){const installation=row(read,'installations',refs.installation);if(!installation)reject('application_binding_integrity',503);i.software=refs.installationLayout==='environment'?{...i.software,environment:installation.locations.environment,launcher:installation.locations.launcher}:{...i.software,source:installation.locations.source};}
  if(refs.service){const service=row(read,'services',refs.service);if(!service)reject('application_binding_integrity',503);if(refs.configLabel)config.label=service.label;}
  if(refs.connection){const connection=row(read,'connections',refs.connection);if(!connection)reject('application_binding_integrity',503);if(refs.configLabel)config.label=connection.label;config.endpoint=connection.endpoint;if(refs.enabledPresent||!connection.enabled)i.enabled=connection.enabled;}
  i.config=config;delete i.databaseRefs;
 }
 for(const [key,op]of Object.entries(value.operations)){const r=row(read,'operations',op.databaseRef);if(!r)reject('application_binding_integrity',503);const {databaseRef,legacyError,createdAtPresent,...native}=op;value.operations[key]={...native,action:r.action,state:r.state,updatedAt:r.updatedAt,...(createdAtPresent?{createdAt:r.createdAt}:{}),...(r.error?{errorCode:r.error.code,...(r.error.message?{error:r.error.message}:{})}:legacyError?{error:legacyError}:{})};}
 if(read.snapshot.hub.enteredAt)value.welcomeEnteredAt=read.snapshot.hub.enteredAt;
 return validateSetup(value);
}
export async function compileResources(compiler,registry) {
 const payload=clean(registry),previous=compiler.read.state.documents.find(d=>d.key==='resources')?.value.resources||[];
 for(const prior of previous)if(!payload.resources.some(r=>identity('registry-connection',r.id)===prior.connectionRef)){const old=row(compiler.read,'connections',prior.connectionRef);if(old?.enabled){const {revision,...value}=old;compiler.app('Connection',{...value,enabled:false});}}
 for(const r of payload.resources){const id=identity('registry-connection',r.id),credentialRef=identity('credential-handle',r.credentialFile);
  compiler.document('credential:'+credentialRef,'native-binding',{file:r.credentialFile,owner:'external-resource'});
  compiler.app('Connection',{id,label:r.label,targetRef:identity('external-service',r.kind+'|'+r.endpoint),adapterRef:r.kind,endpoint:r.endpoint,enabled:r.enabled,targetScope:'external-unresolved',credentialRef});
  const {label,endpoint,enabled,credentialFile,...binding}=r;Object.assign(r,binding);for(const key of ['label','endpoint','enabled','credentialFile'])delete r[key];r.connectionRef=id;r.credentialRef=credentialRef;
 }
 compiler.document('resources','resource-registry',payload);
}
export function decodeResources(read) {
 const d=read.state.documents.find(v=>v.key==='resources');if(!d)reject('application_resources_missing',503);const result=clean(d.value);
 result.resources=result.resources.map(r=>{const c=row(read,'connections',r.connectionRef),credential=read.state.documents.find(d=>d.key==='credential:'+r.credentialRef);if(!c||!credential)reject('application_binding_integrity',503);const {connectionRef,credentialRef,...value}=r;return {...value,label:c.label,endpoint:c.endpoint,enabled:c.enabled,credentialFile:credential.value.file};});return result;
}
