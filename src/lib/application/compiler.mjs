/** Compile authoritative semantic/profile edits and private compatibility bindings into one commit. */
import {sha256, reject} from '../objects/registry.mjs';
import {stableJSON} from '../objects/bundle.mjs';
import {inspectUnit, unitKey} from '../objects/rdf-unit.mjs';
import {processDataset} from '../objects/codec.mjs';
import {recordGroups} from '../objects/application-rows.mjs';

export const identity = (scope, key) => 'urn:zenith:hub:' + scope + ':' + sha256(key);
export const softwareId = key => 'urn:zenith:software:' + key;
export const timestamp = () => new Date().toISOString();
export const unknown = reason => ({state:'unknown', observedAt:timestamp(), method:'repository', reason});
const same = (a,b) => stableJSON(a) === stableJSON(b);
const noMetadata = ({revision,objectVersion,...value}) => value;

export class ApplicationCompiler {
  constructor(repository,read) {
    this.repository=repository; this.read=read; this.groups=new Map(); this.desired=[];
    this.batch={schema:repository.definitions.commitSchema.properties.schema.const,
      idempotencyKey:'application-'+sha256(String(Math.random())+Date.now()),expectedGeneration:read.state.generation,
      definitionSetId:repository.definitionSetId,unitWrites:[],retireUnits:[],objectWrites:[],appWrites:[],referenceBindings:[],inspectionWrites:[],documentWrites:[]};
  }
  document(key,kind,value) {
    const old=this.read.state.documents.find(d=>d.key===key);
    if(old&&same(old.value,value)&&old.kind===kind)return;
    this.batch.documentWrites.push({key,kind,value,expectedRevision:old?.revision||0,revision:(old?.revision||0)+1});
  }
  async typed(role,value,{references=[],persistRow=true}={}) {
    value=JSON.parse(JSON.stringify(value));
    const m=this.repository.definitions.ownership.records[role]||this.repository.definitions.extensions?.ownership.records[role];if(!m)reject('unknown_application_role',422);
    const selected=this.read.validation.selected.get(value.id),old=selected&&this.read.validation.entries.get(selected);
    if(old?.object.legacyReadOnly)reject('legacy_read_only',409);
    const types=old?.object.types||[m.appliesTo],projection={types};
    for(const [name,rule] of Object.entries(m.fields))if(rule.owner!=='operational'&&Object.hasOwn(value,name))projection[name]=value[name];
    const previous=old?.file.bindings.find(b=>b.profile===m.projection);
    const changed=!previous||!same(previous.value,projection);
    if(changed){
      const unit=old?.object.atomicUnit||{id:identity('unit',value.id),revision:0};let group=this.groups.get(unit.id);
      if(!group){
        const document=old?await processDataset('export',{nquads:old.canonical},this.repository.registry):[];
        group={unit,document,old,members:new Map()};this.groups.set(unit.id,group);
      }
      const updated=[];
      const visit=list=>{for(const node of list){if(node['@id']===value.id){for(const rule of Object.values(m.fields))if(rule.owner==='rdf'&&rule.predicate!=='@id')delete node[rule.predicate];for(const [name,rule]of Object.entries(m.fields))if(rule.owner==='rdf'&&rule.predicate!=='@id'&&Object.hasOwn(value,name))node[rule.predicate]=rule.valueKind==='iri'?[{'@id':value[name]}]:rule.valueKind==='iri-set'?value[name].map(id=>({'@id':id})):[{'@value':value[name]}];updated.push(node);}if(node['@graph'])visit(node['@graph']);}};
      const nodes=Array.isArray(group.document)?group.document:[group.document];visit(nodes);
      if(!updated.length){const node={'@id':value.id,'@type':types};nodes.push(node);visit([node]);}group.document=nodes;
      const applicationProfiles=new Set(Object.values(this.repository.definitions.ownership.records).filter(x=>role.endsWith('ConfigurationProfile')?x.projection.includes('ConfigurationProfile'):x.projection===m.projection).map(x=>x.projection));applicationProfiles.add(m.projection);
      const priorMember=group.members.get(value.id);const bindings=[...(priorMember?.bindings||old?.file.bindings||[]).filter(b=>!applicationProfiles.has(b.profile)),{profile:m.projection,value:projection}];
      group.members.set(value.id,{old,bindings,types,references:[...(priorMember?.references||[]),...references]});
    }
    const rows=this.read.snapshot[recordGroups[role]]||[];const prior=rows.find(r=>r.id===value.id);
    if(persistRow)this.desired.push({role,value,prior,profileId:m.projection});return value.id;
  }
  app(kind,value,{references=[]}={}) {this.desired.push({role:kind,value,references,prior:this.read.state.rows.find(r=>r.kind===kind&&r.value.id===value.id)?.value});}
  async finish() {
    for(const group of this.groups.values()){
      const info=await inspectUnit(group.document,this.repository.registry),rdfChanged=!group.old||info.semanticSha256!==group.old.semanticSha256;
      const atomicUnit={id:group.unit.id,revision:group.unit.revision+(rdfChanged?1:0)};
      if(rdfChanged){this.batch.unitWrites.push({...atomicUnit,expectedRevision:group.unit.revision,members:info.members,document:group.document});
        for(const member of info.members)if(!group.members.has(member)){
          const prior=this.read.validation.entries.get(this.read.validation.selected.get(member));if(!prior)reject('unit_incomplete',422);
          group.members.set(member,{old:prior,bindings:prior.file.bindings,types:prior.object.types,references:[]});
        }
      }
      for(const [id,member]of group.members){const revision=(member.old?.object.objectRevision||0)+1;
        this.batch.objectWrites.push({id,expectedRevision:revision-1,objectRevision:revision,atomicUnit,types:member.types,
          admission:'observation',definitionSetId:this.repository.definitionSetId,
          bindings:{schema:this.repository.definitions.schema.$defs.ProfileBindingsFile.properties.schema.const,objectId:id,objectRevision:revision,atomicUnit,bindings:member.bindings}});
        const oldRefs=this.read.state.referenceBindings.filter(b=>b.ownerKind==='object'&&b.ownerRef===id&&b.ownerRevision===revision-1);
        for(const ref of [...oldRefs,...member.references]){
          const candidate={...ref,ownerKind:'object',ownerRef:id,ownerRevision:revision};
          const explicit=member.references.find(r=>r.field===candidate.field&&r.targetRef===candidate.targetRef);
          if(explicit&&ref!==explicit)continue;
          if(!this.batch.referenceBindings.some(r=>same(r,candidate)))this.batch.referenceBindings.push(candidate);
        }
      }
    }
    for(const {role,value,prior,profileId,references=[]}of this.desired){
      const write=this.batch.objectWrites.find(w=>w.id===value.id),objectRevision=write?.objectRevision||this.read.state.selectedObjects.find(o=>o.objectId===value.id)?.objectRevision;
      const record={...value,...(role==='SetupOperation'?{expectedTargets:value.expectedTargets||[],receiptRefs:value.receiptRefs||[]}:{}),...(profileId?{objectVersion:{objectId:value.id,objectRevision,profileId}}:{})};
      if(role==='SoftwareInstallationRecord'&&prior&&write)record.presence=unknown('Installation binding revision changed; fresh inspection required.');
      const compare=({...record,revision:prior?.revision||1});
      if(prior&&same(prior,compare))continue;
      record.revision=(prior?.revision||0)+1;this.batch.appWrites.push({kind:role,expectedRevision:record.revision-1,value:record});
      for(const b of references)this.batch.referenceBindings.push({...b,ownerKind:'application',ownerRef:value.id,ownerRevision:record.revision});
      // Operational owner revisions retain their explicit documentary selectors.
      for(const b of this.read.state.referenceBindings.filter(b=>b.ownerKind==='application'&&b.ownerRef===value.id&&b.ownerRevision===prior?.revision))if(!references.some(r=>r.field===b.field&&r.targetRef===b.targetRef))this.batch.referenceBindings.push({...b,ownerRevision:record.revision});
    }
    return this.batch;
  }
}
