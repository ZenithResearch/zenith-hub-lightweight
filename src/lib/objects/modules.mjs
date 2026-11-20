/** Verified offline module graph. Availability in a loader is not proof of an import. */
import {reject, absoluteIRI} from './registry.mjs';
const OWL='http://www.w3.org/2002/07/owl#',RDFS='http://www.w3.org/2000/01/rdf-schema#';
const values=(node,key)=>node[key]||[];
export async function verifyModules(resources, loader, processor) {
  const modules=new Map(), aliases=new Map(), types=new Map(), parents=new Map(), owners=new Map();
  for(const resource of resources) {
    const quads=await processor.toRDF(resource.document,{documentLoader:loader,safe:true,base:null});
    const nodeMap=new Map(),factSets=new Map();
    const spelling=t=>t.termType==='BlankNode'?'_:'+t.value:t.value;
    for(const q of quads) {
      const id=spelling(q.subject);if(!nodeMap.has(id))nodeMap.set(id,{'@id':id});
      const node=nodeMap.get(id),key=q.predicate.value;
      const value=q.object.termType==='Literal'?{'@value':q.object.value}: {'@id':spelling(q.object)};
      const fingerprint=id+'\n'+key+'\n'+JSON.stringify(value);
      if(factSets.has(fingerprint))continue;factSets.set(fingerprint,true);
      if(key==='http://www.w3.org/1999/02/22-rdf-syntax-ns#type'&&q.object.termType==='NamedNode')(node['@type']??=[]).push(q.object.value);
      else (node[key]??=[]).push(value);
    }
    const nodes=[...nodeMap.values()];
    const ontology=nodes.find(n=>n['@id']===resource.declaration.ontologyId && n['@type']?.includes(OWL+'Ontology'));
    if(nodes.filter(n=>n['@type']?.includes(OWL+'Ontology')).length!==1 || !ontology || values(ontology,OWL+'versionIRI').length!==1 || values(ontology,OWL+'versionIRI')[0]['@id']!==resource.declaration.versionIri ||
       values(ontology,OWL+'versionInfo').length!==1 || values(ontology,OWL+'versionInfo')[0]['@value']!==resource.version)
      reject('module_identity_or_version_mismatch',503,{module:resource.declaration.versionIri});
    const id=resource.declaration.versionIri;
    if(modules.has(id))reject('conflicting_module',503,{module:id});
    const imports=values(ontology,OWL+'imports').map(v=>v['@id']);
    if(imports.some(v=>!absoluteIRI(v)))reject('invalid_module_import',503,{module:id});
    modules.set(id,{ontologyId:ontology['@id'],versionIri:id,version:resource.version,sha256:resource.sha256,package:resource.package,imports,manifest:resource.manifest});
    for(const alias of [ontology['@id'],id]) {
      if(aliases.has(alias)&&aliases.get(alias)!==id)reject('conflicting_module_identity',503,{module:alias});
      aliases.set(alias,id);
    }
    for(const n of nodes)if(Array.isArray(n['@type'])&&n['@type'].some(t=>[OWL+'Class',RDFS+'Class'].includes(t))) {
      if(!absoluteIRI(n['@id']))reject('unsupported_class_identity',503);
      if(owners.has(n['@id'])&&owners.get(n['@id'])!==id)reject('conflicting_class_declaration',503,{type:n['@id']});
      owners.set(n['@id'],id);types.set(n['@id'],{package:resource.package,version:resource.version,module:id});
      const edges=values(n,RDFS+'subClassOf').map(v=>v['@id']);
      if(edges.some(v=>!absoluteIRI(v)))reject('unsupported_parent_expression',503,{type:n['@id']});
      parents.set(n['@id'],new Set(edges));
    }
  }
  const closure=id=>{
    const seen=new Set(),queue=[id];
    while(queue.length){const item=queue.shift();if(seen.has(item))continue;if(seen.size>=1024)reject('module_closure_limit',503);seen.add(item);
      const m=modules.get(item);if(!m)reject('missing_module_import',503,{module:item});
      for(const target of m.imports){const resolved=aliases.get(target);if(!resolved)reject('missing_module_import',503,{module:item,import:target});queue.push(resolved);}
    }return seen;
  };
  for(const m of modules.values()) {
    const available=closure(m.versionIri);
    for(const [child,edges] of parents) if(owners.get(child)===m.versionIri) for(const parent of edges) {
      if(parent===OWL+'Thing')continue;
      if(!types.has(parent))reject('missing_superclass',503,{type:child,parent});
      if(!available.has(owners.get(parent)))reject('unimported_superclass',503,{type:child,parent});
    }
    for(const dependency of m.manifest.dependencies||[]) {
      const resolved=aliases.get(dependency.versionIri),actual=modules.get(resolved);
      if(!actual || actual.ontologyId!==dependency.ontologyId || actual.version!==dependency.version || actual.sha256!==dependency.sha256 ||
          actual.manifest.__manifestSha256!==dependency.manifestSha256 || !available.has(actual.versionIri))
        reject('module_dependency_mismatch',503,{module:m.versionIri,dependency:dependency.versionIri});
    }
    for(const [child,owner]of owners)if(owner===m.versionIri)for(const parent of parents.get(child)) {
      if(parent===OWL+'Thing')continue;
      if(!owners.has(parent))reject('missing_superclass',503,{type:child,parent});
      if(!available.has(owners.get(parent)))reject('superclass_outside_import_closure',503,{type:child,parent,module:m.versionIri});
    }
  }
  const isSubclassOf=(child,parent)=>{
    const seen=new Set(),queue=[child];
    while(queue.length){const next=queue.shift();if(next===parent)return true;if(seen.has(next))continue;
      if(seen.size>=1024)reject('subclass_closure_limit',503);seen.add(next);queue.push(...(parents.get(next)||[]));
    }return false;
  };
  return {modules,types,parents,owners,isSubclassOf,closure,
    descendants:type=>[...types.keys()].filter(child=>isSubclassOf(child,type)).sort(),
    describe:()=>[...modules.values()].map(({manifest,...m})=>m).sort((a,b)=>a.versionIri.localeCompare(b.versionIri))};
}
