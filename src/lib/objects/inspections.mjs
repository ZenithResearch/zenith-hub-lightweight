/** Server-issued, short-lived inspection evidence. Public JSON cannot manufacture an authorized write. */
import {randomBytes,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {closed,reject,sha256} from './registry.mjs';
import {stableJSON} from './bundle.mjs';
export function inspectionAuthority({lookup,inspectSoftware,validateProof,adapterDigest,localHostRef,clock=Date.now,monotonic=()=>performance.now(),bootId=randomUUID()}) {
  if(inspectSoftware&&typeof localHostRef!=='string')reject('inspection_host_binding_required',503);
  if(inspectSoftware&&!/^[a-f0-9]{64}$/.test(adapterDigest||''))reject('inspection_adapter_pin_required',503);
  const issued=new Map(),permits=new WeakMap();
  const fail=code=>reject(code,409);
  async function inspect(input) {
    closed(input,['softwareRef','hostRef'],['installationRef','candidateHandle','scopeHandle']);
    for(const key of ['candidateHandle','scopeHandle'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>512))reject('invalid_inspection_handle',400);
    if(!inspectSoftware)reject('inspection_unavailable',503);if(input.hostRef!==localHostRef)reject('local_inspection_host_mismatch',403);
    const software=await lookup(input.softwareRef,'SoftwareDescriptor'),host=await lookup(input.hostRef,'Host');
    const installation=input.installationRef?await lookup(input.installationRef,'SoftwareInstallationRecord'):null;
    if(installation&&(installation.value.softwareRef!==input.softwareRef||installation.value.hostRef!==input.hostRef))reject('inspection_subject_mismatch',422);
    let facts;
    try{facts=await inspectSoftware(structuredClone({software,host,installation,candidateHandle:input.candidateHandle,scopeHandle:input.scopeHandle}));}
    catch{facts={state:'unknown',scope:{key:input.scopeHandle||'configured',complete:false},fingerprint:{kind:'unavailable',reason:'inspection_failed'},reasons:['inspection_failed'],adapterDigest};}
    const now=clock(),proof={id:'urn:zenith:hub:inspection:'+randomUUID(),softwareVersion:software.version,hostVersion:host.version,
      subject:installation?{kind:'installation',installationVersion:installation.version}:{kind:'candidate',candidateId:'urn:zenith:hub:candidate:'+randomUUID()},
      fingerprint:facts.fingerprint,scope:facts.scope,observedAt:new Date(now).toISOString(),validUntil:new Date(now+30000).toISOString(),bootId,
      adapterDigest,state:facts.state,reasons:facts.reasons||[]};
    if(facts.copyIdentity)proof.subject.copyIdentity=facts.copyIdentity;for(const field of ['sourceVersion','buildVersion'])if(facts[field])proof[field]=facts[field];
    for(const [field,role]of [['sourceVersion','SoftwareSourceSnapshot'],['buildVersion','SoftwareBuild']])if(proof[field])await lookup(proof[field].objectId,role,proof[field].objectRevision);
    if(!validateProof(proof)||proof.state==='absent'&&!proof.scope.complete)reject('invalid_inspection_result',422);
    if(stableJSON((await lookup(input.softwareRef,'SoftwareDescriptor')).version)!==stableJSON(software.version)||stableJSON((await lookup(input.hostRef,'Host')).version)!==stableJSON(host.version))fail('inspection_subject_changed');
    const handle=randomBytes(32).toString('base64url');issued.set(handle,{proof:structuredClone(proof),at:monotonic()});
    for(const [key,value]of issued)if(monotonic()-value.at>=30000)issued.delete(key);
    return {inspectionHandle:handle,proof,persisted:false};
  }
  function write(handle,association) {
    const source=issued.get(handle);if(!source)fail('inspection_handle_unknown');
    const value={proof:structuredClone(source.proof),...(association?{association:structuredClone(association)}:{})};
    permits.set(value,{handle,digest:sha256(stableJSON(value))});return value;
  }
  function authorize(value) {
    const permit=permits.get(value),source=permit&&issued.get(permit.handle);
    if(!source||permit.digest!==sha256(stableJSON(value)))fail('inspection_authority_required');
    const age=monotonic()-source.at,now=clock(),start=Date.parse(source.proof.observedAt),until=Date.parse(source.proof.validUntil);
    if(age<0||age>=30000||now<start-5000||now>=until)fail('inspection_expired');
  }
  return {facade:{inspect,write},authorize};
}
export function validateInspectionRecords(records,entries,fail=code=>reject(code,422),referenceBindings=[]) {
  const byVersion=new Map(entries.map(e=>[JSON.stringify([e.id,e.objectRevision]),e]));
  const role=(ref,name)=>{const e=byVersion.get(JSON.stringify([ref.objectId,ref.objectRevision])),view=e?.views.get(name)?.value;if(!view)fail('inspection_version_mismatch');return view;};
  const ids=new Set(),copies=new Map();
  for(const {proof,association}of records){if(ids.has(proof.id))fail('duplicate_inspection');ids.add(proof.id);
    role(proof.softwareVersion,'SoftwareDescriptor');role(proof.hostVersion,'Host');if(proof.sourceVersion&&role(proof.sourceVersion,'SoftwareSourceSnapshot').softwareRef!==proof.softwareVersion.objectId)fail('inspection_provenance_mismatch');if(proof.buildVersion&&role(proof.buildVersion,'SoftwareBuild').softwareRef!==proof.softwareVersion.objectId)fail('inspection_provenance_mismatch');
    if(proof.state==='absent'&&!proof.scope.complete)fail('absence_requires_complete_inspection');
    if(proof.subject.kind==='installation'){const i=role(proof.subject.installationVersion,'SoftwareInstallationRecord');if(i.softwareRef!==proof.softwareVersion.objectId||i.hostRef!==proof.hostVersion.objectId)fail('inspection_subject_mismatch');}
    if(association){const i=role(association,'SoftwareInstallationRecord');if(proof.state==='present')for(const [field,proofField]of [['sourceSnapshotRef','sourceVersion'],['buildRef','buildVersion']])if(i[field]){const pin=referenceBindings.find(b=>b.ownerKind==='object'&&b.ownerRef===association.objectId&&b.ownerRevision===association.objectRevision&&b.field==='/'+field&&b.targetRef===i[field]);if(!pin||proof[proofField]?.objectId!==pin.targetRef||proof[proofField]?.objectRevision!==pin.objectRevision)fail('inspection_provenance_mismatch');}if(i.softwareRef!==proof.softwareVersion.objectId||i.hostRef!==proof.hostVersion.objectId)fail('inspection_subject_mismatch');
      if(proof.subject.copyIdentity){const prior=copies.get(association.objectId);if(prior&&prior!==proof.subject.copyIdentity)fail('installation_copy_identity_changed');copies.set(association.objectId,proof.subject.copyIdentity);}
      if(proof.subject.kind==='candidate'&&proof.state!=='present')fail('registration_requires_verified_copy');
      if(proof.subject.kind==='installation'&&proof.subject.installationVersion.objectId!==association.objectId)fail('inspection_subject_mismatch');
    }
  }
}

export function presenceFromProof(proof){return {state:proof.state,observedAt:proof.observedAt,method:'inspection:'+proof.id,inspectionId:proof.id,...(proof.reasons.length?{reason:proof.reasons.join('; ').slice(0,512)}:{})};}
export function validatePresenceOverlays(snapshot,fail=code=>reject(code,422)) {
 for(const i of snapshot.installations){const id=i.presence.inspectionId;if(!id){if(i.presence.state!=='unknown')fail('inspection_evidence_required');continue;}const record=snapshot.inspectionRecords.find(r=>r.proof.id===id&&r.association?.objectId===i.id&&r.association.objectRevision===i.objectVersion.objectRevision);if(!record||stableJSON(i.presence)!==stableJSON(presenceFromProof(record.proof)))fail('presence_evidence_mismatch');}
}
