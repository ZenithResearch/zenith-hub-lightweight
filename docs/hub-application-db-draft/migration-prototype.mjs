/** Pure planning prototype. Input is synthetic JSON; no source paths, secrets or databases are opened. */
import {digest,stable} from './rdf-contract.mjs';
export function planLegacy(input) {
 if(input.schema!=='zenith.hub-legacy-example.synthetic.v1')throw Error('synthetic_fixture_only');
 const identity=(kind,key)=>'urn:zenith:hub:'+kind+':'+digest(input.repositoryId+'|'+key),seen=new Set(),aliases=[],installations=[];
 for(const instance of input.setup.instances){if(seen.has(instance.instanceId))throw Error('legacy_identity_conflict');seen.add(instance.instanceId);if(instance.mode==='connect')continue;
  const receipt=input.receipts.find(r=>r.instanceId===instance.instanceId),id=identity('installation',instance.instanceId+'|'+(receipt?.source?.commit||'unverified'));
  installations.push({id,componentKey:instance.componentId,presence:'unknown',management:'external',claimedManagement:receipt?.installed===true&&!instance.partial?'hub-managed':'unknown',partial:instance.partial===true,needsInspection:true});aliases.push({namespace:'legacy-instance',key:instance.instanceId,targetId:id});
 }
 return {schema:'zenith.hub-migration-plan.synthetic.v1',sourceDigest:digest(stable(input)),repositoryId:input.repositoryId,aliases,installations,
  descriptors:input.catalog.map(c=>({id:c.softwareRef,key:c.key})),profiles:input.nativeProfiles.map(p=>({id:identity('profile',p.nativeKey),nativeKey:p.nativeKey,name:p.name,credentialHandle:p.credentialHandle,historyOwner:p.historyOwner,mode:'describe-only'})),
  connections:input.connections.map(c=>({...c,processControl:false,localInstallationRef:null})),ordinaryObjects:input.ordinaryObjects,legacyObservations:input.legacyProjectionObjects,
  retainedSetup:input.setup,services:[],blockers:[],warnings:['No fresh installation inspection performed','Legacy service/deployment assertions retained without operational promotion']};
}
export function applySyntheticPlan(state,plan){if(state.sourceDigest===plan.sourceDigest)return {...state,replayed:true};if(state.sourceDigest)throw Error('migration_delta_requires_review');return {...state,sourceDigest:plan.sourceDigest,ordinaryObjects:plan.ordinaryObjects,legacyObservations:plan.legacyObservations,retainedSetup:plan.retainedSetup,aliases:plan.aliases,installations:plan.installations,profiles:plan.profiles,connections:plan.connections,replayed:false};}
