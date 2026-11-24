/** Bounded RDF unit interpretation and projection reconstruction. */
import {createHash} from 'node:crypto';
import {processDataset} from './codec.mjs';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const unitKey = unit => JSON.stringify([unit.id,unit.revision]);
export const stable = value => JSON.stringify(value && typeof value==='object' ? Array.isArray(value) ? value.map(v=>JSON.parse(stable(v))) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable(value[k]))])) : value);
const cache=new WeakMap();
export async function inspectUnit(document,registry) {
 const identity=digest(stable(document));let entries=cache.get(registry);if(!entries){entries=new Map();cache.set(registry,entries);}if(entries.has(identity))return structuredClone(entries.get(identity));
 const result=await processDataset('interpret',{document},registry);
 if(result.fragments.length!==1)throw Error('rdf_unit_not_atomic');
 const fragment=result.fragments[0];
 const value={canonical:fragment.nquads,semanticSha256:digest(fragment.nquads),members:fragment.ids,nodes:fragment.recordNodes};entries.set(identity,value);return structuredClone(value);
}
export function projectedValue(entry,mapping,binding,types,id) {
 const parts=entry.nodes.filter(n=>n['@id']===id),node={'@id':id};
 for(const part of parts)for(const [predicate,values]of Object.entries(part))if(predicate!=='@id')node[predicate]=[...new Map([...(node[predicate]||[]),...(Array.isArray(values)?values:[values])].map(v=>[stable(v),v])).values()];
 const result={types};
 for(const [field,rule]of Object.entries(mapping.fields))if(rule.owner!=='operational') {
  if(rule.owner!=='rdf'){if(Object.hasOwn(binding.value,field))result[field]=binding.value[field];continue;}
  if(rule.predicate==='@id'){result[field]=id;continue;}
  const facts=node[rule.predicate];if(!facts?.length)continue;
  if(rule.valueKind==='iri-set') {if(!facts.every(v=>typeof v['@id']==='string'))throw Error('invalid_rdf_reference');result[field]=facts.map(v=>v['@id']).sort();}
  else if(facts.length!==1)throw Error('ambiguous_rdf_projection');
  else if(rule.valueKind==='iri') {if(typeof facts[0]['@id']!=='string')throw Error('invalid_rdf_reference');result[field]=facts[0]['@id'];}
  else {if(typeof facts[0]['@value']!=='string'||facts[0]['@language']||facts[0]['@type']&&facts[0]['@type']!=='http://www.w3.org/2001/XMLSchema#string')throw Error('unsupported_rdf_projection_literal');result[field]=facts[0]['@value'];}
 }
 return result;
}
