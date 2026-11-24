/** Logical app records over the chosen SQL tables. All writes occur within HubRepository's transaction. */
export const recordGroups={Host:'hosts',SoftwareDescriptor:'softwareDescriptors',SoftwareSourceSnapshot:'sourceSnapshots',SoftwareBuild:'builds',SoftwareInstallationRecord:'installations',ConfigurationProfile:'profiles',HermesConfigurationProfile:'profiles',ServiceInstance:'services'};
const normalize=kind=>kind==='HermesConfigurationProfile'?'ConfigurationProfile':kind;
const tables={HubSettings:['hub_settings',{label:'label',localHostRef:'local_host_id',selectedGuideProfileRef:'selected_guide_profile_id',enteredAt:'entered_at'}],SoftwareCatalogEntry:['hub_catalog_entries',{catalogId:'catalog_id',key:'catalog_key',softwareRef:'software_id',adapterRef:'adapter_ref',supportedModes:'supported_modes_json'}],Connection:['hub_connections',{label:'label',targetRef:'target_id',targetScope:'target_scope',adapterRef:'adapter_ref',endpoint:'endpoint',enabled:'enabled',credentialRef:'credential_ref',endpointPolicyRef:'endpoint_policy_ref'}],SetupOperation:['hub_operations',{action:'action',state:'state',outcome:'outcome',targetRefs:'target_refs_json',expectedTargets:'expected_targets_json',planArtifactRef:'plan_artifact_id',receiptRefs:'receipt_refs_json',error:'error_json',createdAt:'created_at',updatedAt:'updated_at'}]};
export function readApplicationRows(db) {
  const rows=[];
  for(const p of db.prepare('SELECT p.*,h.revision FROM hub_projections p JOIN hub_record_heads h ON h.kind=p.kind AND h.id=p.object_id').all()){
    const {types,...value}=JSON.parse(p.projected_json);Object.assign(value,{revision:p.revision,objectVersion:{objectId:p.object_id,objectRevision:p.object_revision,profileId:p.profile_id}});
    if(p.kind==='SoftwareInstallationRecord'){const state=db.prepare('SELECT * FROM hub_installation_state WHERE object_id=?').get(p.object_id);if(!state)throw Error('application_state_missing');Object.assign(value,{management:state.management,presence:JSON.parse(state.presence_json),compatibility:JSON.parse(state.compatibility_json)});const refs=JSON.parse(state.receipt_refs_json);if(refs.length)value.receiptRefs=refs;}
    if(p.kind==='ServiceInstance'){const state=db.prepare('SELECT * FROM hub_service_state WHERE object_id=?').get(p.object_id);if(!state)throw Error('application_state_missing');Object.assign(value,{management:state.management,desiredState:state.desired_state});if(state.runtime_json)value.runtime=JSON.parse(state.runtime_json);}
    rows.push({kind:p.kind==='ConfigurationProfile'&&value.profileKind==='hermes'?'HermesConfigurationProfile':p.kind,value});
  }
  for(const [kind,[table,columns]]of Object.entries(tables))for(const row of db.prepare('SELECT t.*,h.revision FROM '+table+' t JOIN hub_record_heads h ON h.id=t.id AND h.kind=t.kind').all()){
    const value={id:row.id,revision:row.revision};for(const [field,column]of Object.entries(columns))if(row[column]!==null){value[field]=column.endsWith('_json')?JSON.parse(row[column]):field==='enabled'?row[column]===1:row[column];}rows.push({kind,value});
  }
  return rows;
}
export function persistApplicationRow(db,{kind:inputKind,value},ownership) {
  const kind=normalize(inputKind);db.prepare('INSERT INTO hub_record_heads VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision').run(kind,value.id,value.revision);
  if(recordGroups[inputKind]){
    const m=ownership.records[inputKind],projection={};for(const [field,rule]of Object.entries(m.fields))if(rule.owner!=='operational'&&Object.hasOwn(value,field))projection[field]=value[field];
    // The selected validated profile value supplies the exact type metadata; never synthesize it from the row name.
    const binding=db.prepare('SELECT value_json FROM hub_profile_values WHERE object_id=? AND object_revision=? AND profile_id=?').get(value.id,value.objectVersion.objectRevision,value.objectVersion.profileId);projection.types=JSON.parse(binding.value_json).types;
    db.prepare('INSERT INTO hub_projections VALUES(?,?,?,?,?) ON CONFLICT(kind,object_id) DO UPDATE SET object_revision=excluded.object_revision,profile_id=excluded.profile_id,projected_json=excluded.projected_json').run(kind,value.id,value.objectVersion.objectRevision,value.objectVersion.profileId,JSON.stringify(projection));
    if(kind==='SoftwareInstallationRecord')db.prepare('INSERT INTO hub_installation_state VALUES(?,?,?,?,?,?,?) ON CONFLICT(object_id) DO UPDATE SET management=excluded.management,presence_json=excluded.presence_json,compatibility_json=excluded.compatibility_json,latest_inspection_id=excluded.latest_inspection_id,receipt_refs_json=excluded.receipt_refs_json').run(value.id,kind,value.management,JSON.stringify(value.presence),JSON.stringify(value.compatibility),value.presence.inspectionId||null,JSON.stringify(value.receiptRefs||[]));
    if(kind==='ServiceInstance')db.prepare('INSERT INTO hub_service_state VALUES(?,?,?,?,?) ON CONFLICT(object_id) DO UPDATE SET management=excluded.management,desired_state=excluded.desired_state,runtime_json=excluded.runtime_json').run(value.id,kind,value.management,value.desiredState,value.runtime?JSON.stringify(value.runtime):null);
    return;
  }
  const [table,columns]=tables[kind],names=['id','kind',...Object.values(columns)],values=[value.id,kind,...Object.entries(columns).map(([field,column])=>{const v=value[field];return v===undefined?(field==='expectedTargets'||field==='receiptRefs'?'[]':null):column.endsWith('_json')?JSON.stringify(v):field==='enabled'?Number(v):v;})];
  db.prepare('INSERT INTO '+table+'('+names.join(',')+') VALUES('+names.map(()=>'?').join(',')+') ON CONFLICT(id) DO UPDATE SET '+names.filter(n=>n!=='id').map(n=>n+'=excluded.'+n).join(',')).run(...values);
}
