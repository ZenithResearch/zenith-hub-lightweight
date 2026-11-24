/** In-memory synthetic publisher for adversarial draft checks. Not a runtime API. */
import {createHash} from 'node:crypto';
export function probePublisher({snapshot,commits,ownership,stored}){
 const committedVersions=new Map(commits),files=new Map(),hash=b=>createHash('sha256').update(b).digest('hex');
 const blob=(data,folder,extension)=>{const bytes=Buffer.from(JSON.stringify(data,null,2)+'\n'),sha=hash(bytes),storageKey=folder+'/'+sha+'.'+extension;files.set(storageKey,bytes);return {storageKey,artifact:{id:'urn:sha256:'+sha,sha256:sha,byteLength:bytes.length,mediaType:extension==='jsonld'?'application/ld+json':'application/json'}};};
 const readObject=async ref=>{if(!files.has(ref.storageKey))return stored(ref);const b=files.get(ref.storageKey);if(hash(b)!==ref.artifact.sha256||b.length!==ref.artifact.byteLength||ref.artifact.id!=='urn:sha256:'+hash(b))throw Error('probe_file_integrity_mismatch');return JSON.parse(b);};
 function select(id,revision){snapshot.selectedObjects=snapshot.selectedObjects.filter(v=>v.objectId!==id);snapshot.selectedObjects.push({objectId:id,objectRevision:revision});}
 async function publish(row,name,{revision,atomicUnit,document}={}){
  const m=ownership.records[name],previous=snapshot.objectRecords.find(o=>o.id===row.id&&o.objectRevision===row.objectVersion?.objectRevision),template=previous||snapshot.objectRecords.find(o=>o.definitions.some(d=>d.id===m.projection));
  if(!template)throw Error('probe_missing_type_template');revision??=(previous?.objectRevision||0)+1;atomicUnit??={id:previous?.atomicUnit.id||'urn:example:unit:'+hash(Buffer.from(row.id)),revision:(previous?.atomicUnit.revision||0)+1};
  const types=[m.appliesTo],value={types},node={'@id':row.id,'@type':types};
  for(const [field,rule]of Object.entries(m.fields))if(rule.owner!=='operational'&&Object.hasOwn(row,field)){
   value[field]=row[field];if(rule.owner==='rdf'&&rule.predicate!=='@id')node[rule.predicate]=rule.valueKind==='iri-set'?row[field].map(id=>({'@id':id})):rule.valueKind==='iri'?[{'@id':row[field]}]:[{'@value':row[field]}];
  }
  const jsonldFile=blob(document||node,'objects','jsonld'),bindingsFile=blob({schema:'zenith.hub-object-bindings.draft.v3',objectId:row.id,objectRevision:revision,atomicUnit,bindings:[{profile:m.projection,value}]},'bindings','json');
  const o={...structuredClone(template),id:row.id,objectRevision:revision,types,atomicUnit,jsonldFile,bindingsFile,admission:'observation'};
  row.objectVersion={objectId:row.id,objectRevision:revision,profileId:m.projection};snapshot.objectRecords.push(o);select(row.id,revision);
  committedVersions.set(row.id+'|'+revision,{id:row.id,objectRevision:revision,admission:'observation',atomicUnit,jsonldSha256:jsonldFile.artifact.sha256,bindingsSha256:bindingsFile.artifact.sha256});return o;
 }
 async function extra(id,type){const template=snapshot.objectRecords.find(o=>o.types.includes('https://zenith-research.ca/ontology/terms/Artifact')),atomicUnit={id:'urn:example:unit:'+hash(Buffer.from(id)),revision:1},document={'@id':id,'@type':[type]},jsonldFile=blob(document,'objects','jsonld'),bindingsFile=blob({schema:'zenith.hub-object-bindings.draft.v3',objectId:id,objectRevision:1,atomicUnit,bindings:[]},'bindings','json'),o={...structuredClone(template),id,objectRevision:1,types:[type],atomicUnit,jsonldFile,bindingsFile};snapshot.objectRecords.push(o);select(id,1);committedVersions.set(id+'|1',{id,objectRevision:1,admission:'observation',atomicUnit,jsonldSha256:jsonldFile.artifact.sha256,bindingsSha256:bindingsFile.artifact.sha256});return o;}
 return {publish,extra,readObject,committedVersions,select};
}
