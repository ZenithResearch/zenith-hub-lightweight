/** Identity-defining facts are stable across revisions; references carry exact historical versions. */
import {stableJSON} from './bundle.mjs';
export function repositoryIdentity(value) {
  const url=new URL(value);
  if(url.hostname.toLowerCase()==='github.com')return 'github.com/'+url.pathname.replace(/^\/+|\/+$/g,'').replace(/\.git$/i,'').toLowerCase();
  url.hash='';return url.href.replace(/\/$/,'');
}
export function validateProvenance(entries,referenceBindings,fail=code=>{throw Error(code);}) {
  const byVersion=new Map(entries.map(e=>[JSON.stringify([e.id,e.objectRevision]),e]));
  const anchors=new Map();
  const view=(entry,name)=>entry.views instanceof Map?entry.views.get(name)?.value:entry.views[name];
  function pin(entry,field,target) {
    if(!target)return null;
    const binding=referenceBindings.find(b=>b.ownerKind==='object'&&b.ownerRef===entry.id&&b.ownerRevision===entry.objectRevision&&b.field==='/'+field&&b.targetRef===target);
    if(binding?.mode!=='object-version')fail('provenance_version_required');
    const targetEntry=byVersion.get(JSON.stringify([target,binding.objectRevision]));
    if(!targetEntry)fail('reference_version_missing');
    return {objectId:target,objectRevision:binding.objectRevision,entry:targetEntry};
  }
  const tuple=p=>p?{objectId:p.objectId,objectRevision:p.objectRevision}:null;
  for(const entry of [...entries].sort((a,b)=>a.objectRevision-b.objectRevision)) {
    const source=view(entry,'SoftwareSourceSnapshot'),build=view(entry,'SoftwareBuild'),installation=view(entry,'SoftwareInstallationRecord');
    const facts=[];
    if(source)facts.push(['SoftwareSourceSnapshot',{softwareRef:source.softwareRef,repository:repositoryIdentity(source.repository),commit:source.commit}]);
    if(build){const p=pin(entry,'sourceSnapshotRef',build.sourceSnapshotRef);if(p){const s=view(p.entry,'SoftwareSourceSnapshot');if(!s||s.softwareRef!==build.softwareRef)fail('installation_provenance_mismatch');}facts.push(['SoftwareBuild',{softwareRef:build.softwareRef,content:{id:build.content.id,sha256:build.content.sha256,byteLength:build.content.byteLength,...(build.content.revisionId?{revisionId:build.content.revisionId}:{})},source:tuple(p),platform:build.platform??null}]);}
    if(installation){const s=pin(entry,'sourceSnapshotRef',installation.sourceSnapshotRef),b=pin(entry,'buildRef',installation.buildRef);
      if(s){const sv=view(s.entry,'SoftwareSourceSnapshot');if(!sv||sv.softwareRef!==installation.softwareRef)fail('installation_provenance_mismatch');}
      if(b){const bv=view(b.entry,'SoftwareBuild');if(!bv||bv.softwareRef!==installation.softwareRef)fail('installation_provenance_mismatch');if(s){const bs=pin(b.entry,'sourceSnapshotRef',bv.sourceSnapshotRef);if(stableJSON(tuple(bs))!==stableJSON(tuple(s)))fail('installation_provenance_mismatch');}}
      facts.push(['SoftwareInstallationRecord',{softwareRef:installation.softwareRef,hostRef:installation.hostRef,source:tuple(s),build:tuple(b)}]);
    }
    for(const role of ['SoftwareSourceSnapshot','SoftwareBuild','SoftwareInstallationRecord']){const k=JSON.stringify([entry.id,role]),fact=facts.find(([name])=>name===role)?.[1];if(anchors.has(k)&&!fact)fail('identity_profile_required');if(fact){if(anchors.has(k)&&stableJSON(anchors.get(k))!==stableJSON(fact))fail('identity_facts_changed');anchors.set(k,fact);}}
  }
  return anchors;
}
