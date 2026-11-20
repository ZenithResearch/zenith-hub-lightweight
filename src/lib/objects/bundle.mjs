/** Portable interchange: RDF meaning plus explicit profile bindings, never source revisions. */
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import bundleSchema from '../../../profiles/object-store/object-bundle.schema.json' with {type:'json'};
import {processDataset} from './codec.mjs';
import {closed,reject,sha256} from './registry.mjs';
const ajv=addFormats(new Ajv2020({strict:true,allowUnionTypes:true}));
const validateShape=ajv.compile(bundleSchema);
export const BUNDLE='zenith.hub-object-bundle.v1';
// Deterministic transport metadata checksum; this is NOT RDF canonicalization or a signature.
export const stableJSON=value=>JSON.stringify(value && typeof value==='object' ? Array.isArray(value)?value.map(v=>JSON.parse(stableJSON(v))):
  Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stableJSON(value[k]))])):value);
export function sealBundle(value) {const {integrity,...payload}=value;return {...payload,integrity:{algorithm:'sha256-stable-json-v1',sha256:sha256(stableJSON(payload))}};}
function schemaPin(registry,id) {
  const profile=registry.profiles.get(id);if(!profile)reject('unregistered_schema_profile');
  const {validate,...descriptor}=profile;
  return {id,documentSha256:registry.hashes[id.split('#')[0]],profileSha256:sha256(stableJSON(descriptor))};
}
function requirements(registry,interpreted,projections,admissions) {
  const moduleIds=new Set(),profileIds=new Set();
  for(const f of interpreted.fragments)for(const node of f.recordNodes) {
    for(const type of node['@type']||[]) {const owner=registry.moduleGraph.owners.get(type);if(owner)for(const id of registry.moduleGraph.closure(owner))moduleIds.add(id);}
    for(const p of registry.profiles.values())if(p.representation==='expanded-node'&&registry.matches(p,node['@type']||[])&&(!p.admissionOnly||p.admissionOnly===(admissions[node['@id']]||'observation')))profileIds.add(p.id);
  }
  for(const bindings of Object.values(projections))for(const binding of bindings)profileIds.add(binding.profile);
  const modules=[...moduleIds].sort().map(id=>{const m=registry.moduleGraph.modules.get(id);return {ontologyId:m.ontologyId,versionIri:m.versionIri,version:m.version,sha256:m.sha256};});
  const packageIds=new Set([...moduleIds].map(id=>registry.moduleGraph.modules.get(id).package));
  const packages=registry.packages.filter(p=>packageIds.has(p.ontologyId)).map(p=>({ontologyId:p.ontologyId,version:p.version,manifestSha256:p.manifestSha256})).sort((a,b)=>a.ontologyId.localeCompare(b.ontologyId));
  // A known pinned contract is a required resource. An unknown external reference remains unresolved.
  const resources=[];
  for(const bindings of Object.values(projections))for(const binding of bindings) {
    const ref=binding.value?.invocationContract;
    if(ref&&registry.hashes[ref.id]) {
      profileIds.add('https://zenith-research.ca/ontology/normalized/v0.1.0/schemas/core.schema.json#/$defs/InvocationContract');
      if(!resources.some(r=>r.id===ref.id))resources.push({id:ref.id,sha256:registry.hashes[ref.id]});
    }
  }
  const schemas=[...profileIds].sort().map(id=>schemaPin(registry,id));
  return {modules,packages,schemas,resources:resources.sort((a,b)=>a.id.localeCompare(b.id))};
}
function checkPins(registry,refs) {
  closed(refs,['modules','packages','schemas','resources']);
  for(const [kind,rows]of Object.entries(refs)) {
    if(!Array.isArray(rows)||rows.length>2048)reject('invalid_bundle_requirements');
    const seen=new Set();
    for(const row of rows) {
      const key=row.id||row.versionIri||row.ontologyId;if(seen.has(key))reject('duplicate_bundle_requirement');seen.add(key);
      if(kind==='modules') {
        const m=registry.moduleGraph.modules.get(row.versionIri);
        if(!m||row.ontologyId!==m.ontologyId||row.version!==m.version||row.sha256!==m.sha256)reject('bundle_module_mismatch',422,{module:row.versionIri});
      }else if(kind==='packages') {
        if(!registry.packages.some(p=>p.ontologyId===row.ontologyId&&p.version===row.version&&p.manifestSha256===row.manifestSha256))reject('bundle_package_mismatch',422,{package:row.ontologyId});
      }else if(kind==='schemas') {
        const actual=schemaPin(registry,row.id);if(stableJSON(actual)!==stableJSON(row))reject('bundle_schema_mismatch',422,{profile:row.id});
      }else if(registry.hashes[row.id]!==row.sha256)reject('bundle_resource_mismatch',422,{id:row.id});
    }
  }
}
export async function exportBundle(store,selection={}) {
  const dataset=await store.exportDocument(selection), interpreted=await processDataset('interpret',{document:dataset},store.registry);
  const ids=interpreted.fragments.flatMap(f=>f.ids),projections={},admissions={};
  for(const id of ids) {
    const record=store.row(id);if(!record)reject('bundle_selection_incomplete');
    projections[id]=JSON.parse(record.profiles);admissions[id]=store.admission(id);
  }
  const bundle=sealBundle({schema:BUNDLE,dataset,datasetDigest:{algorithm:'RDFC-1.0',sha256:sha256(interpreted.nquads)},
    requirements:requirements(store.registry,interpreted,projections,admissions),projections,admissions});
  await validateBundle(store.registry,bundle);
  return bundle;
}
export async function validateBundle(registry,bundle) {
  if(!validateShape(bundle))reject('invalid_bundle_schema',422,{errors:validateShape.errors.map(e=>({path:e.instancePath,keyword:e.keyword}))});
  closed(bundle,['schema','dataset','datasetDigest','requirements','projections','admissions','integrity']);
  if(bundle.schema!==BUNDLE||bundle.integrity?.algorithm!=='sha256-stable-json-v1'||bundle.integrity.sha256!==sealBundle(bundle).integrity.sha256)reject('bundle_integrity_mismatch');
  checkPins(registry,bundle.requirements);
  const interpreted=await processDataset('interpret',{document:bundle.dataset},registry);
  if(bundle.datasetDigest?.algorithm!=='RDFC-1.0'||bundle.datasetDigest.sha256!==sha256(interpreted.nquads))reject('bundle_dataset_mismatch');
  const ids=interpreted.fragments.flatMap(f=>f.ids).sort();
  for(const map of [bundle.projections,bundle.admissions])if(!map||typeof map!=='object'||Array.isArray(map)||stableJSON(Object.keys(map).sort())!==stableJSON(ids))reject('incomplete_bundle_bindings');
  for(const f of interpreted.fragments)for(const id of f.ids) {
    const mode=bundle.admissions[id];if(mode!=='observation'&&!registry.policies.has(mode))reject('unknown_admission_policy');
    const node=f.recordNodes.find(n=>n['@id']===id);
    registry.validateProjections(id,node?.['@type']||[],bundle.projections[id],mode);
    registry.validateNode(node,mode);registry.contractStatus(id,bundle.projections[id]);
  }
  const required=requirements(registry,interpreted,bundle.projections,bundle.admissions);
  for(const [kind,rows]of Object.entries(required))for(const row of rows)if(!bundle.requirements[kind].some(v=>stableJSON(v)===stableJSON(row)))reject('bundle_missing_requirement',422,{kind,id:row.id||row.versionIri||row.ontologyId});
  return bundle;
}
export async function importBundle(store,bundle,options) {
  const {expectedBundleSha256,...importOptions}=options;
  if(expectedBundleSha256!==undefined&&(!/^[a-f0-9]{64}$/.test(expectedBundleSha256)||expectedBundleSha256!==bundle.integrity?.sha256))reject('bundle_integrity_mismatch');
  await validateBundle(store.registry,bundle);
  return store.importDocument(bundle.dataset,{...importOptions,projections:bundle.projections,admissions:bundle.admissions});
}
