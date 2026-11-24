/** In-memory synthetic publisher. Deliberately independent trusted commits for adversarial checks; never a runtime API. */
import {createHash} from 'node:crypto';
import {inspectUnit,unitKey,stable} from './rdf-contract.mjs';
export function probePublisher({snapshot,commits,unitCommits,ownership,stored,registry}) {
 const committedVersions=new Map(commits),committedAtomicUnits=new Map(unitCommits),files=new Map(),hash=b=>createHash('sha256').update(b).digest('hex');
 const blob=(data,folder,extension)=>{const bytes=Buffer.from(JSON.stringify(data,null,2)+'\n'),sha=hash(bytes),storageKey=folder+'/'+sha+'.'+extension;files.set(storageKey,bytes);return {storageKey,artifact:{id:'urn:sha256:'+sha,sha256:sha,byteLength:bytes.length,mediaType:extension==='jsonld'?'application/ld+json':'application/json'}};};
 const readObject=async ref=>{if(!files.has(ref.storageKey))return stored(ref);const b=files.get(ref.storageKey);if(hash(b)!==ref.artifact.sha256||b.length!==ref.artifact.byteLength||ref.artifact.id!=='urn:sha256:'+hash(b))throw Error('probe_file_integrity_mismatch');return JSON.parse(b);};
 function select(id,revision){snapshot.selectedObjects=snapshot.selectedObjects.filter(v=>v.objectId!==id);snapshot.selectedObjects.push({objectId:id,objectRevision:revision});refreshUnits();}
 function refreshUnits(){const choices=new Map();for(const v of snapshot.selectedObjects){const o=snapshot.objectRecords.find(o=>o.id===v.objectId&&o.objectRevision===v.objectRevision);if(o)choices.set(unitKey(o.atomicUnit),o.atomicUnit);}for(const u of snapshot.selectedUnits)if(snapshot.rdfUnits.find(v=>unitKey(v)===unitKey(u))?.members.length===0)choices.set(unitKey(u),u);snapshot.selectedUnits=[...choices.values()];}
 async function sealUnit(document,atomicUnit,jsonldFile){const info=await inspectUnit(document,registry),u={...atomicUnit,members:info.members,semanticSha256:info.semanticSha256,jsonldFile};
  if(!committedAtomicUnits.has(unitKey(u))){committedAtomicUnits.set(unitKey(u),u);snapshot.rdfUnits.push(u);}return u;
 }
 function reference(row,field,targetRef,{mode='object-version',revision,ownerKind=row.objectVersion?'object':'application'}={}) {
  const b={ownerKind,ownerRef:row.id,ownerRevision:ownerKind==='object'?row.objectVersion.objectRevision:row.revision,field,targetRef,mode,...(mode==='object-version'?{objectRevision:revision}:{})};snapshot.referenceBindings.push(b);return b;
 }
 function commit(o){committedVersions.set(o.id+'|'+o.objectRevision,{id:o.id,objectRevision:o.objectRevision,admission:o.admission,atomicUnit:o.atomicUnit,...(o.mappingRef?{mappingRef:o.mappingRef}:{}),jsonldSha256:o.jsonldFile.artifact.sha256,bindingsSha256:o.bindingsFile.artifact.sha256});}
 async function publish(row,name,{revision,atomicUnit,document}={}) {
  const m=ownership.records[name],previous=snapshot.objectRecords.find(o=>o.id===row.id&&o.objectRevision===row.objectVersion?.objectRevision),template=previous||snapshot.objectRecords.find(o=>o.definitions.some(d=>d.id===m.projection));
  if(!template)throw Error('probe_missing_type_template');revision??=Math.max(0,...snapshot.objectRecords.filter(o=>o.id===row.id).map(o=>o.objectRevision))+1;
  const types=[m.appliesTo],value={types},node={'@id':row.id,'@type':types};
  for(const [field,rule]of Object.entries(m.fields))if(rule.owner!=='operational'&&Object.hasOwn(row,field)){value[field]=row[field];if(rule.owner==='rdf'&&rule.predicate!=='@id')node[rule.predicate]=rule.valueKind==='iri-set'?row[field].map(id=>({'@id':id})):rule.valueKind==='iri'?[{'@id':row[field]}]:[{'@value':row[field]}];}
  const data=document||node,info=await inspectUnit(data,registry),oldUnit=previous&&committedAtomicUnits.get(unitKey(previous.atomicUnit));
  atomicUnit??={id:previous?.atomicUnit.id||'urn:example:unit:'+hash(Buffer.from(row.id)),revision:oldUnit&&oldUnit.semanticSha256===info.semanticSha256?oldUnit.revision:(previous?.atomicUnit.revision||0)+1};
  const jsonldFile=blob(data,'objects','jsonld');await sealUnit(data,atomicUnit,jsonldFile);
  const bindingsFile=blob({schema:'zenith.hub-object-bindings.draft.v4',objectId:row.id,objectRevision:revision,atomicUnit,bindings:[{profile:m.projection,value}]},'bindings','json');
  const o={...structuredClone(template),id:row.id,objectRevision:revision,types,atomicUnit,jsonldFile,bindingsFile,admission:'observation'};
  for(const b of [...snapshot.referenceBindings])if(b.ownerKind==='object'&&b.ownerRef===row.id&&b.ownerRevision===previous?.objectRevision)snapshot.referenceBindings.push({...b,ownerRevision:revision});
  row.objectVersion={objectId:row.id,objectRevision:revision,profileId:m.projection};snapshot.objectRecords.push(o);commit(o);select(row.id,revision);return o;
 }
 async function extra(id,type,{atomicUnit:unitOverride,document:documentOverride}={}){const template=snapshot.objectRecords.find(o=>o.types.includes('https://zenith-research.ca/ontology/terms/Artifact')),atomicUnit=unitOverride||{id:'urn:example:unit:'+hash(Buffer.from(id)),revision:1},document=documentOverride||{'@id':id,...(type?{'@type':[type]}:{}),'urn:example:value':[{'@value':'generic retained object'}]},jsonldFile=blob(document,'objects','jsonld'),bindingsFile=blob({schema:'zenith.hub-object-bindings.draft.v4',objectId:id,objectRevision:1,atomicUnit,bindings:[]},'bindings','json'),o={...structuredClone(template),id,objectRevision:1,types:type?[type]:[],atomicUnit,jsonldFile,bindingsFile};delete o.mappingRef;await sealUnit(document,atomicUnit,jsonldFile);snapshot.objectRecords.push(o);commit(o);select(id,1);return o;}
 async function rewrite(o,{document,bindings}={}){if(document)o.jsonldFile=blob(document,'objects','jsonld');if(bindings)o.bindingsFile=blob(bindings,'bindings','json');commit(o);return o;}
 async function anonymous(document){const atomicUnit={id:'urn:example:unit:anonymous',revision:1},file=blob(document,'objects','jsonld');await sealUnit(document,atomicUnit,file);snapshot.selectedUnits.push(atomicUnit);}
 return {publish,extra,rewrite,anonymous,reference,readObject,committedVersions,committedAtomicUnits,select};
}
