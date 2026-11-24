/** Rebuild synthetic draft fixtures only. Never reads Hub setup, credentials or live databases. */
import {inspectUnit,unitKey} from './rdf-contract.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
const root=path.resolve('docs/hub-application-db-draft'),storage=path.join(root,'object-storage');
const read=async p=>JSON.parse(await fs.readFile(p,'utf8')),hash=b=>createHash('sha256').update(b).digest('hex');
const schema=await read(path.join(root,'schema.json')),ownership=await read(path.join(root,'field-ownership.json'));
const coreRoot='profiles/object-store/ontology/zenith-0.1.0',infraRoot='profiles/object-store/ontology/infrastructure';
const Z='https://zenith-research.ca/ontology/terms/',I='https://zenith-research.ca/ontology/hub/infrastructure/terms/',L='http://www.w3.org/2000/01/rdf-schema#label';
const CORE='https://zenith-research.ca/ontology/normalized/v0.1.0',INFRA='https://zenith-research.ca/ontology/hub/infrastructure/v0.1.0';
await fs.mkdir(path.join(storage,'bindings'),{recursive:true});
async function blob(bytes,folder,extension){const sha=hash(bytes),storageKey=folder+'/'+sha+'.'+extension;await fs.mkdir(path.join(storage,folder),{recursive:true});await fs.writeFile(path.join(storage,storageKey),bytes);return {storageKey,artifact:{id:'urn:sha256:'+sha,sha256:sha,byteLength:bytes.length,mediaType:extension==='jsonld'?'application/ld+json':'application/json'}};}
const pins=new Map();
async function pin(kind,id,file){const bytes=await fs.readFile(file),ref={kind,id,file:await blob(bytes,'definitions',file.endsWith('.jsonld')?'jsonld':'json')};pins.set(kind+'|'+id,ref);return ref;}
const common=[await pin('ontology-module','urn:zenith:hub:application-relations:draft:6',path.join(root,'application-relations.jsonld')),await pin('ontology-module',CORE+'/modules/core.jsonld',coreRoot+'/modules/core.jsonld'),await pin('package-manifest','https://zenith-research.ca/ontology/normalized',coreRoot+'/manifest.json'),await pin('json-schema',CORE+'/schemas/core.schema.json#/$defs/ArtifactRef',coreRoot+'/schemas/core.schema.json')];
const infra=[await pin('ontology-module',INFRA+'/ontology.jsonld',infraRoot+'/ontology.jsonld'),await pin('package-manifest','https://zenith-research.ca/ontology/hub/infrastructure',infraRoot+'/manifest.json')];
const observed={};for(const type of ['Machine','ServiceInstance'])observed[type]=await pin('json-schema',INFRA+'/schemas/infrastructure.schema.json#/$defs/'+type+'Observed',infraRoot+'/schemas/infrastructure.schema.json');
for(const m of Object.values(ownership.records))await pin('json-schema',m.projection,path.join(root,'schema.json'));
await pin('json-schema',schema.$id+'#/$defs/ProfileBindingsFile',path.join(root,'schema.json'));
const mappingPin=await pin('field-mapping',ownership.id,path.join(root,'field-ownership.json'));
const versionPins=new Map(),unitPins=new Map();
async function bind(row,name){
 const m=ownership.records[name],types=[m.appliesTo],value={types},node={'@id':row.id,'@type':types};
 for(const [field,rule]of Object.entries(m.fields))if(rule.owner!=='operational'&&Object.hasOwn(row,field)){
  value[field]=row[field];
  if(rule.owner==='rdf'&&rule.predicate!=='@id')node[rule.predicate]=rule.valueKind==='iri-set'?row[field].map(id=>({'@id':id})):rule.valueKind==='iri'?[{'@id':row[field]}]:[{'@value':row[field]}];
 }
 row.objectVersion={objectId:row.id,objectRevision:1,profileId:m.projection};
 const atomicUnit={id:'urn:example:unit:'+hash(Buffer.from(row.id)),revision:1};
 const bindings={atomicUnit,schema:'zenith.hub-object-bindings.draft.v6',objectId:row.id,objectRevision:1,bindings:[{profile:m.projection,value}]};
 const jsonldFile=await blob(Buffer.from(JSON.stringify(node,null,2)+'\n'),'objects','jsonld'),bindingsFile=await blob(Buffer.from(JSON.stringify(bindings,null,2)+'\n'),'bindings','json');
 const definitions=[mappingPin,...common,...infra,...(name==='Host'||name==='ServiceInstance'?[observed[name==='Host'?'Machine':'ServiceInstance']]:[]),pins.get('json-schema|'+m.projection),pins.get('json-schema|'+schema.$id+'#/$defs/ProfileBindingsFile')];
 const unit={...atomicUnit,members:[row.id],semanticSha256:(await inspectUnit(node,{documents:{}})).semanticSha256,jsonldFile};unitPins.set(unitKey(unit),unit);
 const mappingRef={id:ownership.id,sha256:mappingPin.file.artifact.sha256};
 const record={mappingRef,atomicUnit,id:row.id,objectRevision:1,admission:'observation',types,jsonldFile,bindingsFile,definitions},key=row.id+'|1',version={mappingRef,atomicUnit,id:row.id,objectRevision:1,admission:'observation',jsonldSha256:jsonldFile.artifact.sha256,bindingsSha256:bindingsFile.artifact.sha256};
 if(versionPins.has(key)&&JSON.stringify(versionPins.get(key))!==JSON.stringify(version))throw Error('fixture_version_conflict');versionPins.set(key,version);return record;
}
const old=await read(path.join(root,'history/draft-1/example-installed-without-guide.json'));
const host={...old.hosts[0]};delete host.objectRef;
const software={...old.software[0]};for(const k of ['objectRef','adapterRef','supportedModes'])delete software[k];
const snapshot={id:old.releases[0].id,revision:1,softwareRef:software.id,repository:old.releases[0].source.repository,commit:old.releases[0].source.revision};
const install={...old.installations[0],sourceSnapshotRef:snapshot.id};delete install.releaseRef;delete install.objectRef;
install.presence={state:'unknown',observedAt:'2026-11-23T00:00:00Z',method:'synthetic fixture',reason:'No runtime-issued inspection in this design fixture'};
const base={inspectionRecords:[],snapshotMode:'current',selectedObjects:[],rdfUnits:[],selectedUnits:[],referenceBindings:[],schema:'zenith.hub-application-db.draft.v6',hub:{...old.hub},hosts:[host],softwareDescriptors:[software],catalogEntries:[{id:'urn:example:catalog-entry:builtin-hermes',revision:1,catalogId:'urn:example:catalog:builtin-software',key:'hermes',softwareRef:software.id,adapterRef:'hermes',supportedModes:['install','connect']}],sourceSnapshots:[snapshot],builds:[],installations:[install],profiles:[],services:[],connections:[],operations:[],objectRecords:[]};
const groups={hosts:'Host',softwareDescriptors:'SoftwareDescriptor',sourceSnapshots:'SoftwareSourceSnapshot',builds:'SoftwareBuild',installations:'SoftwareInstallationRecord',services:'ServiceInstance'};
async function finish(data){data.objectRecords=[];for(const [key,name]of Object.entries(groups))for(const row of data[key])data.objectRecords.push(await bind(row,name));for(const row of data.profiles)data.objectRecords.push(await bind(row,row.profileKind==='hermes'?'HermesConfigurationProfile':'ConfigurationProfile'));data.rdfUnits=data.objectRecords.map(o=>unitPins.get(unitKey(o.atomicUnit)));data.selectedUnits=data.rdfUnits.map(({id,revision})=>({id,revision}));data.selectedObjects=data.objectRecords.map(o=>({objectId:o.id,objectRevision:o.objectRevision}));for(const group of ['builds','installations'])for(const row of data[group])for(const field of ['sourceSnapshotRef','buildRef'])if(row[field])data.referenceBindings.push({ownerKind:'object',ownerRef:row.id,ownerRevision:1,field:'/'+field,targetRef:row[field],mode:'object-version',objectRevision:1});return data;}
await fs.writeFile(path.join(root,'example-installed-without-guide.json'),JSON.stringify(await finish(structuredClone(base)),null,2)+'\n');
const generic=structuredClone(base);generic.profiles=[{id:'urn:example:profile:generic',revision:1,softwareRef:software.id,installationRef:install.id,name:'Named configuration',profileKind:'generic'}];
await fs.writeFile(path.join(root,'example-generic-profile.json'),JSON.stringify(await finish(generic),null,2)+'\n');
const configured=structuredClone(base);
configured.profiles=[{id:'urn:example:profile:hub-guide',revision:1,softwareRef:software.id,installationRef:install.id,name:'hub-guide',profileKind:'hermes',modelBinding:{providerId:'example-provider',modelName:'synthetic-model'}}];
configured.hub.selectedGuideProfileRef=configured.profiles[0].id;
configured.services=[{id:'urn:example:service:hermes-api',revision:1,softwareRef:software.id,installationRef:install.id,profileRef:configured.profiles[0].id,label:'Example Hermes API',management:'external',desiredState:'unmanaged',hostRefs:[host.id],runtime:{state:'stopped',observedAt:'2026-11-22T19:00:00Z',method:'synthetic fixture only'}}];
configured.builds=[{id:'urn:example:build:hermes-synthetic',revision:1,softwareRef:software.id,sourceSnapshotRef:snapshot.id,content:{id:'urn:example:external-build-content',sha256:'a'.repeat(64),byteLength:1234,mediaType:'application/octet-stream'},platform:'synthetic-no-download'}];
configured.referenceBindings=[{ownerKind:'object',ownerRef:configured.builds[0].id,ownerRevision:1,field:'/content',targetRef:configured.builds[0].content.id,mode:'external'}];
await fs.writeFile(path.join(root,'example-configured.json'),JSON.stringify(await finish(configured),null,2)+'\n');
await fs.writeFile(path.join(root,'trusted-fixture-manifest.json'),JSON.stringify({schema:'zenith.hub-trusted-fixture-manifest.draft.v6',schemaSha256:hash(await fs.readFile(path.join(root,'schema.json'))),ownershipSha256:hash(await fs.readFile(path.join(root,'field-ownership.json'))),sourceRegistrySha256:hash(await fs.readFile('profiles/object-store/registry.json')),definitionPins:[...pins.values()],committedObjectVersions:[...versionPins.values()],committedAtomicUnits:[...unitPins.values()],referencePolicySha256:hash(await fs.readFile(path.join(root,'reference-policy.json'))),scope:'Synthetic trust root for review checks; not a signed release or live commit protocol.'},null,2)+'\n');
console.log('Generated three synthetic committed-version fixtures; no installed software or live data accessed.');
